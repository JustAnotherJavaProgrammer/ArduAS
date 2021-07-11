import { wait } from "https://deno.land/x/wait@0.1.11/mod.ts";
import { normalize, resolve } from "https://deno.land/std@0.100.0/path/mod.ts"

import Assembler from "./assembler.ts";

if (Deno.build.os === "windows") {
    console.log(`If you are experiencing problems with character encoding on Windows, follow the steps in this answer on StackOverflow: 
https://stackoverflow.com/questions/57131654/using-utf-8-encoding-chcp-65001-in-command-prompt-windows-powershell-window/57134096#57134096`);
}

const spinner = wait("Loading grammar...").start();
const grammar = await Deno.readTextFile("./grammar.txt");
spinner.succeed();

const decoder = new TextDecoder();

const assembler = new Assembler(async (filename) => decoder.decode(await Deno.readFile(filename)), path => resolve(normalize(path)), grammar, spinner);
assembler.assemble("grammar.txt")