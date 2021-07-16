import type { Spinner } from "https://deno.land/x/wait@0.1.11/mod.ts";
import { toposortReverse } from "https://raw.githubusercontent.com/n1ru4l/toposort/main/src/toposort.ts";

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
            const instr: Omit<Instruction, "parser"> = { id: parseInt(fields[0]), mnemonic: fields[1], args: fields[2]?.split(/(\s|,)+/gm).map(arg => arg.trim()).filter((arg, index) => (arg !== undefined && index !== 0 && arg?.length > 0) ?? false) ?? [] };
            grammar.set(instr.mnemonic, this.createInstrParser(instr));
        }
        return grammar;
    }

    protected createInstrParser(instr: Omit<Instruction, "parser">): Instruction {
        if (Assembler.isAbsoluteBranchInstruction(instr.mnemonic)) {
            return {
                ...instr, parser: (line: AssemblyLine, sourceFile: AssemblyFile, labels: Map<string, Label[]>,
                    availableFiles: Map<string, AssemblyFile>, assemblerOrder: string[]) => {
                    const args = line.code.split(/s/g).map(e => e.trim()).filter((_e, i) => i > 0);
                    if (args.length == 0)
                        throw new Error(`Too few arguments provided for instruction at ${line.filename}:${line.lineNo + 1} :\n${sourceFile.rawLines[line.lineNo]}`);
                    if (labels.has(args[0]))
                        return Assembler.createLabelResolveGenerator(instr.id, this.resolveLabelName(args[0], line, labels, availableFiles, assemblerOrder));
                    this.warn(`Warning at ${line.filename}:${line.lineNo + 1} : Jumping to explicit addresses is discouraged. Use labels instead`);
                }
            }
        }
        return instr as Instruction;
    }

    async assemble(filename: string): Promise<Uint8Array> {
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
        this.spinner.succeed(`Collected ${labels.size} label${labels.size == 1 ? "" : "s"}`);
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
        console.log(sortedSourceFiles);
        return new Uint8Array([65, 114, 100, 117, 79, 83, 32, 98, 121, 116, 101, 99, 111, 100, 101]);
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

    // transformAssemblyFile(sourceFile: AssemblyFile, labels: Map<string, Label[]>, availableFiles: Map<string, AssemblyFile>, assemblerOrder: string[]): TransformedAssemblyFile {
    //     const generatorArr: BinaryGenerator = [];
    //     for (const line of sourceFile.code) {
    //         const codeSplit = line.code.split(/\s/g).map(e => e.trim()).filter(e => e.length > 0);
    //         const mnemonic = codeSplit[0];

    //     }
    //     // TODO: implement
    // }

    static createSimpleGenerator(result: Uint8Array): BinaryGenerator {
        return () => result;
    }

    static createLabelResolveGenerator(instrID: number, target: Label, startingAtByteNo = 0, howLong = 3): BinaryGenerator {
        return (labels: Map<Label, number>) => {
            const targetNo = labels.get(target);
            if (targetNo === undefined)
                throw new Error(`Label ${target.name} from file ${target.filename}:${target.lineNo + 1} could not be located!`);
            const res = new Uint8Array(4);
            const baseShift = startingAtByteNo * 8;
            res[0] = instrID;
            for (let i = 0; i < howLong; i++) {
                res[i + 1] = targetNo >>> (baseShift + (i * 8));
            }
            return res;
        };
    }

    static isAbsoluteBranchInstruction(mnemonic: string): boolean {
        mnemonic = mnemonic.trim().toUpperCase();
        // TODO: add labels for RJMP
        return mnemonic.startsWith("BR") || mnemonic === "CALLI" || mnemonic === "JMPI";
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