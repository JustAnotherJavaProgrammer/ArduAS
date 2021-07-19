import type { Spinner } from "https://deno.land/x/wait@0.1.11/mod.ts";
import { toposortReverse } from "https://raw.githubusercontent.com/n1ru4l/toposort/main/src/toposort.ts";
const regLimit = 34;

export default class Assembler {
    getAssembly: (filename: string) => Promise<string>;
    filepathNormalizer: (path: string) => string;
    grammar: Grammar;
    spinner: Spinner;
    constructor(getAssembly: (filename: string) => Promise<string>, filepathNormalizer: (path: string) => string, grammar: string, spinner: Spinner) {
        this.getAssembly = getAssembly;
        this.filepathNormalizer = filepathNormalizer;
        this.spinner = spinner;
        spinner.text = "Parsing grammar...";
        spinner.color = "yellow";
        spinner.start();
        this.grammar = this.parseGrammar(grammar);
        spinner.succeed();
    }

    protected parseGrammar(gramTxt: string): Grammar {
        const lines = gramTxt.split("\n").map(val => val.trim()).filter(line => line.length > 0);
        const grammar: Grammar = new Map<string, Instruction>();
        for (const instrDef of lines) {
            const fields = instrDef.split("\t").map(field => field.trim());
            const instr: Omit<Instruction, "parser"> = { id: parseInt(fields[0]), mnemonic: fields[1].toUpperCase(), args: fields[2]?.split(/(\s|,)+/gm).map(arg => arg.trim()).filter((arg, index) => (arg !== undefined && index !== 0 && arg?.length > 0) ?? false) ?? [] };
            grammar.set(instr.mnemonic, this.createInstrParser(instr));
        }
        return grammar;
    }

    protected createInstrParser(instr: Omit<Instruction, "parser">): Instruction {
        const argParsers: ArgParser[] = instr.args.map(arg => this.createArgParser(arg));
        const regularParser = (line: AssemblyLine, sourceFile: AssemblyFile, _labels: Map<string, Label[]>,
            _availableFiles: Map<string, AssemblyFile>, _assemblerOrder: string[]): BinaryGenerator => {
            const args = Assembler.getArgs(line.code);
            if (args.length < argParsers.length)
                throw new Error(`Error at ${line.filename}:${line.lineNo + 1} - Not enough arguments for instruction ${instr.mnemonic}! (${instr.args.length} arguments expected, ${args.length} arguments received)\n${sourceFile.rawLines[line.lineNo]}`);
            if (args.length > argParsers.length)
                throw new Error(`Error at ${line.filename}:${line.lineNo + 1} - Too many arguments for instruction ${instr.mnemonic}! (${args.length} arguments received, ${argParsers.length} arguments expected)\n${sourceFile.rawLines[line.lineNo]}`);
            const results: Uint8Array[] = [];
            for (let i = 0; i < args.length; i++) {
                try {
                    results.push(argParsers[i](args[i], line));
                } catch (e) {
                    throw new Error(`Error at ${line.filename}:${line.lineNo + 1} - ${e.message}\n${sourceFile.rawLines[line.lineNo]}`);
                }
            }
            const result = new Uint8Array(Math.max(results.reduce((acc, val) => acc + val.length, 1), 4));
            if (result.length != 4)
                throw new Error(`Error while parsing ${line.filename}:${line.lineNo + 1} - The length of the resulting Uint8Array is larger than 4! (actual length: ${result.length})\n${sourceFile.rawLines[line.lineNo]}`);
            result[0] = instr.id;
            let currIndex = 1;
            for (const res of results) {
                result.set(res, currIndex);
                currIndex += res.length;
            }
            return Assembler.createSimpleGenerator(result);
        };
        if (Assembler.isAbsoluteBranchInstruction(instr.mnemonic)) {
            return {
                ...instr, parser: (line: AssemblyLine, sourceFile: AssemblyFile, labels: Map<string, Label[]>,
                    availableFiles: Map<string, AssemblyFile>, assemblerOrder: string[]): BinaryGenerator => {
                    const args = Assembler.getArgs(line.code);
                    if (args.length == 0)
                        throw new Error(`Too few arguments provided for instruction at ${line.filename}:${line.lineNo + 1} :\n${sourceFile.rawLines[line.lineNo]}`);
                    if (labels.has(args[0]))
                        return Assembler.createLabelResolveGenerator(instr.id, this.resolveLabelName(args[0], line, labels, availableFiles, assemblerOrder), undefined, undefined, instr.mnemonic === "RJMP" ? ((): number => {
                            let counter = 0;
                            for (const filename of assemblerOrder) {
                                if (filename === line.filename) {
                                    for (const asmLine of sourceFile.code) {
                                        counter++;
                                        if (line.lineNo === asmLine.lineNo)
                                            break;
                                    }
                                    break;
                                } else {
                                    counter += (availableFiles.get(filename) as AssemblyFile).code.length;
                                }
                            }
                            return counter;
                        })() : undefined);
                    this.warn(`Warning at ${line.filename}:${line.lineNo + 1} : Jumping to explicit addresses is discouraged. Use labels instead`);
                    return regularParser(line, sourceFile, labels, availableFiles, assemblerOrder);
                }
            }
        }
        return { ...instr, parser: regularParser };
    }

    async assemble(filename: string): Promise<Uint8Array> {
        let processedFiles: TransformedAssemblyFile[];
        let resolvedLabels: Map<Label, number>;

        {
            this.spinner.text = "Loading source files...";
            this.spinner.color = "cyan";
            this.spinner.start();
            filename = this.filepathNormalizer(filename);
            const sourceFiles = new Map<string, AssemblyFile>();
            try {
                sourceFiles.set(filename, await this.loadAssemblyFile(filename));
                {
                    const dependencyQueue: string[] = [...sourceFiles.get(filename)?.dependencies ?? []];
                    while (dependencyQueue.length > 0) {
                        const dep: string = dependencyQueue.shift() ?? "";
                        if (!sourceFiles.has(dep)) {
                            const assemblyFile = await this.loadAssemblyFile(dep);
                            dependencyQueue.push(...assemblyFile.dependencies);
                            sourceFiles.set(assemblyFile.filename, assemblyFile);
                        }
                    }
                }
            } catch (e) {
                this.spinner.fail();
                throw e;
            }
            this.spinner.succeed(`Loaded ${sourceFiles.size} source file${sourceFiles.size == 1 ? "" : "s"}!`);
            this.spinner.text = "Collecting labels...";
            this.spinner.color = "yellow";
            this.spinner.start();
            const labels = new Map<string, Label[]>();
            for (const [filename, assemblyFile] of sourceFiles) {
                for (const [lineNo, name] of assemblyFile.labels) {
                    if (!labels.has(name))
                        labels.set(name, []);
                    labels.get(name)?.push({ name: name, filename: filename, lineNo: lineNo });
                    this.spinner.text = `Collecting labels: ${labels.size}`;
                }
            }
            this.spinner.succeed(`Collected ${labels.size} label${labels.size == 1 ? "" : "s"}!`);
            this.spinner.text = "Sorting the source files...";
            this.spinner.color = "gray";
            this.spinner.start();
            const sortedSourceFiles: string[] = [];
            {
                const depMap = new Map<string, string[]>();
                for (const [filename, sourceFile] of sourceFiles) {
                    depMap.set(filename, sourceFile.dependencies);
                }
                try {
                    sortedSourceFiles.push(...toposortReverse(depMap).flatMap(elem => Array.from(elem)));
                } catch (_e) {
                    this.spinner.fail();
                    throw new Error(`The source files contain circular dependencies!`);
                }
            }
            this.spinner.succeed(`Sorted ${sortedSourceFiles.length} source file${sortedSourceFiles.length == 1 ? "" : "s"}!`);
            // console.log(sortedSourceFiles);
            this.spinner.color = "blue";
            this.spinner.text = "Processing individual source files...";
            this.spinner.start();
            processedFiles = [];
            for (let i = 0; i < sortedSourceFiles.length; i++) {
                this.spinner.text = `Processing ${sortedSourceFiles[i]} (${i + 1}/${sortedSourceFiles.length})...`;
                try {
                    processedFiles.push(this.transformAssemblyFile(sourceFiles.get(sortedSourceFiles[i]) as AssemblyFile, labels, sourceFiles, sortedSourceFiles));
                } catch (e) {
                    this.spinner.fail();
                    throw e;
                }
            }
            this.spinner.succeed(`Processed ${sortedSourceFiles.length} source file${sortedSourceFiles.length === 1 ? "" : "s"}!`);

            this.spinner.text = "Resolving the exact positions of labels in the final binary...";
            this.spinner.color = "red";
            this.spinner.start();
            resolvedLabels = this.resolveLabels(labels, processedFiles);
            this.spinner.succeed(`Resolved the exact positions of ${resolvedLabels.size} label${resolvedLabels.size == 1 ? "" : "s"}!`);
        }

        this.spinner.text = "Collecting the binary data for all instructions...";
        this.spinner.color = "magenta";
        this.spinner.start();
        const instrTotal = processedFiles.reduce((acc, file) => acc + file.code.length, 0);
        let instrCounter = 0;
        const finalResult = new Uint8Array(17 + instrTotal * 4);
        finalResult.set([65, 114, 100, 117, 79, 83, 32, 98, 121, 116, 101, 99, 111, 100, 101]);
        finalResult.set([0x00, 0x00], 15);
        let currOffset = 17;
        for (let i = 0; i < processedFiles.length; i++) {
            const file = processedFiles[i];
            for (const instr of file.code) {
                this.spinner.text = `Collecting the binary data for all instructions (${instrCounter}/${instrTotal})...`;
                finalResult.set(instr.generator(resolvedLabels), currOffset);
                currOffset += 4;
                instrCounter++;
            }
        }
        this.spinner.succeed(`Collected the binary data for all ${instrTotal} instruction${instrTotal === 1 ? "" : "s"}!`);
        return finalResult;
    }

    async loadAssemblyFile(filename: string): Promise<AssemblyFile> {
        filename = this.filepathNormalizer(filename);
        this.spinner.text = `Loading source file: ${filename}`;
        const rawLines = (await this.getAssembly(filename)).split(/(\r\n|\r|\n)/gm).filter(line => line !== "\n" && line !== "\r" && line !== "\r\n");
        const result: AssemblyFile = {
            filename: filename, dependencies: [],
            rawLines: rawLines, lines: rawLines.map(line => line.trim().split(/(?<!'(.))(;|\/\/)(?!(.?)')/gm, 2)[0]),
            labels: new Map<number, string>(),
            code: []
        };
        for (const line of result.lines) {
            if (this.isLineOfCode(line))
                break;
            if (!line.toLowerCase().startsWith("#include"))
                continue;
            result.dependencies.push(this.filepathNormalizer(line.substr(line.indexOf("<") + 1, line.indexOf(">") - line.indexOf("<") - 1)));
        }
        for (let i = 0; i < result.lines.length; i++) {
            const line = result.lines[i];
            if (this.isLineOfCode(line)) {
                result.code.push({ code: line, lineNo: i, filename: result.filename });
            }
            const splitted = line.split(/(\s)+/g, 2);
            if (splitted.length < 1)
                continue;
            splitted[0] = splitted[0].trim();
            if (!splitted[0].endsWith(":"))
                continue;
            result.labels.set(i, splitted[0].trim().substr(0, splitted[0].trim().length - 1));
        }
        return result;
    }

    isLineOfCode(line: string): boolean {
        line = line.trim().toUpperCase();
        return [...this.grammar.keys()].some(mnemonic => line.startsWith(mnemonic + " "));
    }

    transformAssemblyFile(sourceFile: AssemblyFile, labels: Map<string, Label[]>, availableFiles: Map<string, AssemblyFile>, assemblerOrder: string[]): TransformedAssemblyFile {
        for (const line of sourceFile.code) {
            const mnemonic = line.code.split(/\s/g, 2)[0].trim().toUpperCase();
            if (this.grammar.get(mnemonic) === undefined)
                throw new Error(`Error at ${line.filename}:${line.lineNo + 1} - Unknown mnemonic: ${mnemonic}\n${sourceFile.rawLines[line.lineNo]}`);
            (line as TransformedAssemblyLine).generator = (this.grammar.get(mnemonic) as Instruction).parser(line, sourceFile, labels, availableFiles, assemblerOrder);
        }
        return sourceFile as TransformedAssemblyFile;
    }

    protected resolveLabels(labels: Map<string, Label[]>, sourceFiles: TransformedAssemblyFile[]): Map<Label, number> {
        const result = new Map<Label, number>();
        for (const list of labels.values()) {
            for (const individualLabel of list) {
                result.set(individualLabel, ((): number => {
                    const startingPosition = sourceFiles.findIndex(file => file.filename === individualLabel.filename);
                    const offset = sourceFiles.reduce((acc, val, index) => index < startingPosition ? acc + val.code.length : acc, 0);
                    for (const [index, line] of sourceFiles[startingPosition].code.entries()) {
                        if (line.lineNo > individualLabel.lineNo) {
                            return offset + index;
                        }
                    }
                    return offset + sourceFiles[startingPosition].code.length;
                })());
            }
        }
        return result;
    }

    static createSimpleGenerator(result: Uint8Array): BinaryGenerator {
        return () => result;
    }

    static createLabelResolveGenerator(instrID: number, target: Label, startingAtByteNo = 0, howLong = 3, relativeTo = 0): BinaryGenerator {
        return (labels: Map<Label, number>) => {
            let targetNo = labels.get(target);
            if (targetNo === undefined)
                throw new Error(`Label ${target.name} from file ${target.filename}:${target.lineNo + 1} could not be located!`);
            targetNo -= relativeTo;
            const res = new Uint8Array(4);
            const baseShift = startingAtByteNo * 8;
            res[0] = instrID;
            if (instrID === 0x2F) { // RJMP
                // FIXME: might contain bugs, needs to be tested!
                const isNegative = targetNo >>> 31;
                const cutTarget = (targetNo << 9) >>> 9;
                targetNo = isNegative << 23 + cutTarget;
            }
            for (let i = 0; i < howLong; i++) {
                res[i + 1] = targetNo >>> (baseShift + (i * 8));
            }
            return res;
        };
    }

    static isAbsoluteBranchInstruction(mnemonic: string): boolean {
        mnemonic = mnemonic.trim().toUpperCase();
        return mnemonic.startsWith("BR") || mnemonic === "CALLI" || mnemonic === "JMPI" || mnemonic === "RJMP";
    }

    protected resolveLabelName(labelName: string, line: AssemblyLine, labels: Map<string, Label[]>, availableFiles: Map<string, AssemblyFile>, compilationOrder: string[]): Label {
        let candidates = labels.get(labelName) ?? [];
        if (candidates.length == 0)
            throw new Error(`Label "${labelName}" at ${line.filename}:${line.lineNo + 1} could not be resolved!\n${availableFiles.get(line.filename)?.rawLines[line.lineNo]}`);
        if (candidates.length == 1)
            return candidates[0];
        let result = candidates[0];
        if (candidates.some(c => c.filename === line.filename)) { // First, look for candidates in the same file
            candidates = candidates.filter(c => c.filename === line.filename);
            if (candidates.length == 1) {
                result = candidates[0];
            } else {
                const before = candidates.filter(c => c.lineNo < line.lineNo);
                const after = candidates.filter(c => c.lineNo > line.lineNo);
                if (before.length > 0) // Choose the closest candidate, preferrably before the line
                    result = before[before.length - 1];
                else if (after.length > 0)
                    result = after[0];
                else
                    // This should never happen, but if it does, we'll throw an error to stop any unexpected behavior or incompatibilities caused by an updated version not choosing the first candidate by default
                    throw new Error(`Total confusion! There are label candidates in the same file, but neither before nor after the specified line. Labels on the same line as instructions are forbidden by language design.
This is the position of the line, where it happened: ${line.filename}:${line.lineNo + 1} - This is the label name: "${labelName}"
These are the candidates for the label, supposedly all in the same file:
${candidates}`);
            }
        } else { // Then, look for candidates in other files
            {
                const toBeChecked: string[] = [line.filename];
                const alreadyChecked: string[] = [];
                for (const fileCandidate of toBeChecked) { // Going through all dependencies, level by level
                    if (candidates.some(c => c.filename === fileCandidate)) {
                        candidates = candidates.filter(c => c.filename === fileCandidate);
                        result = candidates[candidates.length - 1];
                        break;
                    }
                    alreadyChecked.push(fileCandidate);
                    toBeChecked.push(...(availableFiles.get(fileCandidate)?.dependencies ?? []).filter(e => !alreadyChecked.includes(e)).reverse());
                }
            }
            // Otherwise, choose the closest candidate in all assembled files, preferrably before the line
            const ownCompOrderIndex = compilationOrder.indexOf(line.filename);
            const before = compilationOrder.filter((_e, i) => i < ownCompOrderIndex).filter(e => candidates.some(c => c.filename === e));
            const after = compilationOrder.filter((_e, i) => i > ownCompOrderIndex).filter(e => candidates.some(c => c.filename === e));
            if (before.length > 0) {
                candidates = candidates.filter(c => c.filename === before[before.length - 1]);
                result = candidates[candidates.length - 1];
            } else if (after.length > 0) {
                candidates = candidates.filter(c => c.filename === after[0]);
                result = candidates[0];
            }
            // If nothing works, choose the first candidate
        }
        this.warn(`Multiple candidates for label "${labelName}" at ${line.filename}:${line.lineNo + 1} - Choosing candidate at ${result.filename}:${result.lineNo + 1}`);
        return result;
    }

    static getArgs(code: string): string[] {
        const splits = [];
        {
            // deno-lint-ignore no-empty-character-class
            const singleQuote = Array.from(code.matchAll(/(?<!\\)'/gd)).map(e => e.index);
            // deno-lint-ignore no-empty-character-class
            const rgbPseudoFunction = Array.from(code.matchAll(/rgb\s*\(.*\)/gd)).map(e => ({ pos: e.index as number, len: e[0].length }));
            // console.log(rgbPseudoFunction);
            // deno-lint-ignore no-empty-character-class
            const whitespace = Array.from(code.matchAll(/\s/gd)).map(e => e.index);
            for (const index of singleQuote) {
                if (index === undefined)
                    throw new Error("A matching single quote has no index!");
            }
            for (const index of whitespace) {
                if (index === undefined)
                    throw new Error("A matching whitespace has no index!");
                // Check for an even number of (not escaped) single quotes before the whitespace
                if ((singleQuote as number[]).reduce((acc, val) => val < index ? acc + 1 : acc, 0) % 2 === 0 &&
                    (!rgbPseudoFunction.some(e => index > e.pos && index < e.pos + e.len)))
                    splits.push(index);
            }
        }
        const result: string[] = [];
        for (let i = 0; i < splits.length; i++) {
            result.push(code.substring(splits[i], i < splits.length - 1 ? splits[i + 1] : undefined).trim());
        }
        return result.filter(e => e.length > 0);
    }

    protected createArgParser(argDef: string): ArgParser {
        const type = argDef.toLowerCase().startsWith("byte") ? ArgType.BYTE : ArgType.REGISTER;
        const length = ((): number => {
            if (!argDef.includes("~"))
                return 1;
            const tildePos = argDef.indexOf("~");
            if (type == ArgType.BYTE)
                return (parseInt(argDef[argDef.length - 1]) - parseInt(argDef[tildePos - 1])) + 1;
            // if (type == ArgType.REGISTER)
            const lowerCase = argDef.toLowerCase();
            return (lowerCase.charCodeAt(argDef.length - 1) - lowerCase.charCodeAt(tildePos - 1)) + 1;
        })();
        return (arg: string, line: AssemblyLine): Uint8Array => {
            const result = new Uint8Array(length);
            if (type == ArgType.REGISTER) {
                const individualRegisters = arg.split("~");
                if (individualRegisters.length > length)
                    throw new Error(`Too many registers supplied for definition ${argDef} (${length} registers expected, ${individualRegisters.length} registers supplied)!`);
                else if (individualRegisters.length < length)
                    throw new Error(`Too few registers supplied for definition ${argDef} (${length} registers expected, ${individualRegisters.length} registers supplied)!`);
                for (let i = 0; i < individualRegisters.length; i++) {
                    if (!individualRegisters[i].toLowerCase().startsWith("r"))
                        throw new Error(`${individualRegisters[i]} is not a register! Have you forgotten to prefix the register ID with "r"?`);
                    result[i] = parseInt(individualRegisters[i].substring(1));
                    if (result[i] >= regLimit)
                        this.warn(`Warning at ${line.filename}:${line.lineNo + 1} - There is no register r${result[i]}!`);
                }
            } else /* type == ArgType.BYTE */ {
                if (arg.startsWith("'")) {
                    arg = arg.substring(1, arg.length - 1).replaceAll("\\'", "'");
                    if (arg.length > length)
                        throw new Error(`Too many bytes supplied for definition ${argDef} (${length} bytes expected, ${arg.length} bytes supplied)!`);
                    if (arg.length < length)
                        throw new Error(`Too few bytes supplied for definition ${argDef} (${length} bytes expected, ${arg.length} bytes supplied)!`);
                    for (let i = 0; i < arg.length; i++) {
                        result[length - (i + 1)] = arg.charCodeAt(i);
                    }
                } else {
                    const value: number = ((): number => {
                        // console.log(line.code + ": " + arg + arg.toLowerCase().startsWith("rgb"));
                        if (arg.startsWith("0b")) {
                            return parseInt(arg.substring(2), 2);
                        } else if (arg.toLowerCase().startsWith("rgb")) {
                            arg = arg.substring(arg.indexOf("(") + 1, arg.indexOf(")"));
                            const rgb = arg.split(",").map((e => parseInt(e.trim())));
                            // console.log(line.code + ": " + rgb + " " + (((rgb[0] & 0xF8) << 8) | ((rgb[1] & 0xFC) << 3) | (rgb[2] >>> 3)).toString(2) +
                            //     " " + (((rgb[0] & 0xF8) << 8) | ((rgb[1] & 0xFC) << 3) | (rgb[2] >>> 3)).toString(16));
                            if (rgb.length != 3)
                                throw new Error(`RGB values must be supplied as three comma-separated integers!`); // Thanks for this message, GitHub copilot!
                            return (((rgb[0] & 0xF8) << 8) | ((rgb[1] & 0xFC) << 3) | (rgb[2] >>> 3));
                        }
                        return parseInt(arg);
                    })();
                    for (let i = 0; i < length; i++) {
                        result[i] = value >>> (8 * i);
                    }
                }
            }
            return result;
        };
    }

    warn(warning: string) {
        const oldText = this.spinner.text;
        this.spinner.warn(warning);
        this.spinner.text = oldText;
        this.spinner.start();
    }
}

type Grammar = Map<string, Instruction>;

type AssemblyLine = { code: string, lineNo: number, filename: string };

type TransformedAssemblyLine = AssemblyLine & { generator: BinaryGenerator };

type InstructionParser = (line: AssemblyLine, sourceFile: AssemblyFile, labels: Map<string, Label[]>,
    availableFiles: Map<string, AssemblyFile>, assemblerOrder: string[]) => BinaryGenerator;

type BinaryGenerator = (labels: Map<Label, number>) => Uint8Array;

type ArgParser = (arg: string, line: AssemblyLine) => Uint8Array;

interface Label {
    name: string;
    lineNo: number;
    filename: string;
}

interface Instruction {
    id: number;
    mnemonic: string,
    args: string[],
    parser: InstructionParser
}

interface AssemblyFile {
    filename: string,
    dependencies: string[],
    lines: string[],
    rawLines: string[],
    labels: Map<number, string>,
    code: AssemblyLine[]
}

interface TransformedAssemblyFile extends AssemblyFile {
    code: TransformedAssemblyLine[];
}

enum ArgType {
    BYTE,
    REGISTER
}