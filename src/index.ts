import { Parser } from "./parser.js";
import { catchErrors } from "./error.js";
import { Library } from "./library.js";
import { addExtensions } from "./extensions.js";
import { program } from "commander";
import { Timer, options, parseOptions } from "./options.js";
import * as ts from "typescript";

// TODO: generate function types for classes that only have a call signature

const DEFAULTLIB_FILES = [
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es5.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2015.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2016.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2017.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2018.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2019.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2020.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2015.core.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2015.collection.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2015.generator.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2015.iterable.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2015.promise.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2015.proxy.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2015.reflect.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2015.symbol.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2015.symbol.wellknown.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2016.array.include.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2017.date.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2017.object.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2017.sharedmemory.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2017.string.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2017.intl.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2017.typedarrays.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2018.asyncgenerator.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2018.asynciterable.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2018.intl.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2018.promise.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2018.regexp.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2019.array.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2019.object.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2019.string.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2019.symbol.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2019.intl.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2020.bigint.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2020.date.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2020.promise.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2020.sharedmemory.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2020.string.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2020.symbol.wellknown.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2020.intl.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.es2020.number.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.esnext.intl.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.decorators.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.decorators.legacy.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.dom.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.webworker.importscripts.d.ts",
	"/home/user/ts2cpp/node_modules/typescript/lib/lib.scripthost.d.ts",
];

parseOptions();

if (options.defaultLib) {
	program.args.push(...DEFAULTLIB_FILES);
}

const createProgramTimer = new Timer("create program");
const tsProgram = ts.createProgram(program.args, {});
createProgramTimer.end();

const library = new Library(options.O ?? "cheerp/clientlib.h", program.args);

if (options.listFiles) {
	for (const sourceFile of tsProgram.getSourceFiles()) {
		console.log(sourceFile.fileName);
	}
}

let writerOptions = {
	pretty: options.pretty,
};

if (options.defaultLib) {
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
} else {
	library.addGlobalInclude("cheerp/clientlib.h", true);
}

const parseTimer = new Timer("parse");
const parser = new Parser(tsProgram, library);
parseTimer.end();

if (options.defaultLib) {
	addExtensions(parser);
}

catchErrors(() => {
	const writeTimer = new Timer("write");
	library.write(writerOptions);
	writeTimer.end();
});
