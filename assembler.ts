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
            const instr: Instruction = { id: parseInt(fields[0]), mnemonic: fields[1], args: fields[2]?.split(/(\s|,)+/gm).map(arg => arg.trim()).filter((arg, index) => (arg !== undefined && index !== 0 && arg?.length > 0) ?? false) ?? [] };
            grammar.set(instr.mnemonic, instr);
        }
        return grammar;
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

    transformAssemblyFile(sourceFile: AssemblyFile, labels: Map<string, Label[]>, availableFiles: Map<string, AssemblyFile>, assemblerOrder: string[]): TransformedAssemblyFile {
        const generatorArr:BinaryGenerator = [];
        for(const line of sourceFile.code) {
            const codeSplit = line.code.split(/\s/g).map(e => e.trim()).filter(e => e.length > 0);
            const mnemonic = codeSplit[0];
            
        }
        // TODO: implement
    }

    static createSimpleGenerator(result: Uint8Array): BinaryGenerator {
        return () => result;
    }

    static createLabelResolveGenerator(instrID: number, target: Label, startingAtByteNo = 0, howLong = 3): BinaryGenerator {
        return (labels: Map<Label, number>) => {
            const targetNo = labels.get(target);
            if (targetNo === undefined)
                throw new Error(`Label ${target.name} from file ${target.filename}:${target.lineNo+1} could not be located!`);
            const res = new Uint8Array(4);
            const baseShift = startingAtByteNo * 8;
            res[0] = instrID;
            for(let i = 0; i < howLong; i++) {
                res[i+1] = targetNo >>> (baseShift + (i*8)); 
            }
            return res;
        };
    }

    static isAbsoluteBranchInstruction(mnemonic: string): boolean {
        mnemonic = mnemonic.trim().toUpperCase();
        return mnemonic.startsWith("BR") || mnemonic === "CALLI" || mnemonic === "JMPI";
    }
}

type Grammar = Map<string, Instruction>;

type AssemblyLine = { code: string, lineNo: number, filename: string };

type TransformedAssemblyLine = AssemblyLine & { generator: BinaryGenerator };

type BinaryGenerator = (labels: Map<Label, number>) => Uint8Array;

interface Label {
    name: string;
    lineNo: number;
    filename: string;
}

interface Instruction {
    id: number;
    mnemonic: string,
    args: string[]
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