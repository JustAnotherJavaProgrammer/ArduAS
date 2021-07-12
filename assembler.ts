import type { Spinner } from "https://deno.land/x/wait@0.1.11/mod.ts";

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
        sourceFiles.set(filename, await this.loadAssemblyFile(filename));
        {
            const dependencyQueue: string[] = sourceFiles.get(filename)?.dependencies ?? [];
            while (dependencyQueue.length > 0) {
                const dep: string = dependencyQueue.shift() ?? "";
                if (!sourceFiles.has(dep)) {
                    const assemblyFile = await this.loadAssemblyFile(dep);
                    dependencyQueue.push(...assemblyFile.dependencies);
                    sourceFiles.set(assemblyFile.filename, assemblyFile);
                }
            }
        }
        this.spinner.succeed(`Loaded ${sourceFiles.size} source file${sourceFiles.size == 1 ? "" : "s"}!`);
        return new Uint8Array([65, 114, 100, 117, 79, 83, 32, 98, 121, 116, 101, 99, 111, 100, 101]);
    }

    async loadAssemblyFile(filename: string): Promise<AssemblyFile> {
        filename = this.filepathNormalizer(filename);
        this.spinner.text = `Loading source file: ${filename}`;
        const rawLines = await (await this.getAssembly(filename)).split(/(\r\n|\r|\n)/gm).filter(line => line !== "\n" && line !== "\r" && line !== "\r\n");
        const result: AssemblyFile = {
            filename: filename, dependencies: [],
            rawLines: rawLines, lines: rawLines.map(line => line.trim().split(/(?<!'(.))(;|\/\/)(?!(.?)')/gm, 2)[0]),
            labels: new Map<string, number>(),
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
            result.labels.set(splitted[0].trim().substr(0, splitted[0].trim().length - 1), i);
        }
        return result;
    }

    isLineOfCode(line: string): boolean {
        line = line.trim().toUpperCase();
        return [...this.grammar.keys()].some(mnemonic => line.startsWith(mnemonic + " "));
    }
}

type Grammar = Map<string, Instruction>;

type AssemblyLine = { code: string, lineNo: number, filename: string };

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
    labels: Map<string, number>,
    code: AssemblyLine[]
}