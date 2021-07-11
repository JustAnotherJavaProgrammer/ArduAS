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

        return new Uint8Array(0);
    }
}

type Grammar = Map<string, Instruction>;

interface Instruction {
    id: number;
    mnemonic: string,
    args: string[]
}