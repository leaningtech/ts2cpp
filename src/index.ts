import { Parser } from "./parser.js";
import { catchErrors } from "./error.js";
import { Library } from "./library.js";
import { addExtensions } from "./extensions.js";
import { setIgnoreErrors } from "./target.js";
import { program } from "commander";
import { JSHELPER_SOURCE } from "./jshelper.js";
import { Writer } from "./writer.js";
import * as ts from "typescript";

// TODO:
// strict function types
// arguments by value/reference
// return value of Int8Array.fill
// reinterpret_cast for Any::cast

program
	.option("--pretty")
	.option("--default-lib")
	.option("--out, -o <file>")
	.option("--ignore-errors");

program.parse();

const options = program.opts();

const tsProgram = ts.createProgram(program.args, {});

const library = new Library(options.O ?? "cheerp/clientlib.h", options.defaultLib);

let writerOptions = {
	pretty: options.pretty,
};

if (options.defaultLib) {
	const jshelperWriter = new Writer("cheerp/jshelper.h", writerOptions);
	const jsobjectFile = library.addFile("cheerp/jsobject.h");
	const typesFile = library.addFile("cheerp/types.h");
	const clientlibFile = library.getDefaultFile();
	jsobjectFile.addName("client::Object");
	typesFile.addName("client::String");
	typesFile.addName("client::Array");
	typesFile.addName("client::Map");
	typesFile.addName("client::Number");
	typesFile.addName("client::Function");
	typesFile.addInclude("jsobject.h", false, jsobjectFile);
	clientlibFile.addInclude("types.h", false, typesFile);
	library.addGlobalInclude("jshelper.h", false);
	jshelperWriter.writeText(JSHELPER_SOURCE);
} else {
	library.addGlobalInclude("cheerp/clientlib.h", true);
}

const parser = new Parser(tsProgram, library);

if (options.defaultLib) {
	addExtensions(parser);
}

setIgnoreErrors(options.ignoreErrors);

catchErrors(() => {
	library.write(writerOptions);
});
