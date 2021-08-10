# ArduAS (assembler for ArduOS)

This repository contains code for an assembler to create executables in the `ArduOS bytecode` format.
___
**DISCLAIMER: The ArduOS project (including ArduOS) is not endorsed, affiliated, associated, or in any way officially connected with Arduino AG. All product and company names are the registered trademarks of their original owners.**
___
## Installation
```
// TODO: complete this readme
// For development purposes, run using:
deno run --allow-read --allow-write --allow-net=deno.land,raw.githubusercontent.com --allow-run --allow-hrtime --unstable arduas.ts .\hello_world.asm
```
___
## CLI usage
The following syntax can be used on the command line to assemble `input.asm` to `OUTPUT.RUN` (replace `[executable]` with the path to your ArduAS executable):
```
>[executable] input.asm OUTPUT.RUN
```
*Note:* The output filename is optional. If none is provided, one will be generated from the name of your input file by converting all letters of the filename to upper-case and replacing the file extension with `.RUN` or appending it to the filename.

*Note:* Due to [implementation details](https://www.arduino.cc/en/Reference/SDCardNotes#toc4), some runtimes (e. g. Arduino UNO) may not be able to run/open files with filenames not conforming to the 8.3 format.
___
## The assembly language
`// TODO: Describe the assembly language in the readme`
### Dependency resolution
`// TODO: Explain this feature in the readme`

**Note:** If your files contain *circular dependencies*, ArduAS will fail with an error indicating circular dependencies *somewhere* in your code. It will not specify any filenames or positions in the code. I will hopefully come around to fixing this in the future. If you are affected by this behavior and believe, it should be changed, feel free to create an issue about it.