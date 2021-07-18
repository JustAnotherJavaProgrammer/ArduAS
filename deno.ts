import { wait } from "https://deno.land/x/wait@0.1.11/mod.ts";
import { normalize, resolve } from "https://deno.land/std@0.100.0/path/mod.ts"

import Assembler from "./assembler.ts";

if (Deno.build.os === "windows") {
    console.log(`If you are experiencing problems with character encoding on Windows, follow the steps in this answer on StackOverflow: 
https://stackoverflow.com/questions/57131654/using-utf-8-encoding-chcp-65001-in-command-prompt-windows-powershell-window/57134096#57134096`);
}

const spinner = wait("Loading grammar...").start();
const assembler: Assembler = await (async () => {
    const grammar = await Deno.readTextFile("./grammar.txt");
    spinner.succeed();

    const decoder = new TextDecoder();

    return new Assembler(async (filename) => decoder.decode(await Deno.readFile(filename)), path => resolve(normalize(path)), grammar, spinner);
})();

const sourceFile = "hello_world.asm";
const outputFile = "HELLO.RUN";
spinner.text = `Assembling ${sourceFile} ...`; spinner.color = "magenta";
spinner.start();
spinner.info();
spinner.indent = 1;
try {
    const binaryData = await assembler.assemble(sourceFile);
    spinner.indent = 0;
    spinner.succeed(`Assembly complete!`);
    spinner.color = "green";
    spinner.text = `Writing ${outputFile} ...`;
    spinner.start();
    await Deno.writeFile(outputFile, binaryData);
    spinner.succeed();
    spinner.succeed("Done!");
    spinner.info(`Binary size: ${binaryData.length} bytes`);
} catch (e) {
    spinner.indent = 0;
    spinner.fail(`Compilation failed: ${e.message}`);
}