import { Parser } from "./parser.js";
import { catchErrors } from "./error.js";
import { Library } from "./library.js";
import { program } from "commander";
import { Timer, options, parseOptions } from "./options.js";
import * as ts from "typescript";

// TODO: generate function types for classes that only have a call signature

const DEFAULTLIB_FILES = [
	"node_modules/typescript/lib/lib.es5.d.ts",
	"node_modules/typescript/lib/lib.es2015.d.ts",
	"node_modules/typescript/lib/lib.es2016.d.ts",
	"node_modules/typescript/lib/lib.es2017.d.ts",
	"node_modules/typescript/lib/lib.es2018.d.ts",
	"node_modules/typescript/lib/lib.es2019.d.ts",
	"node_modules/typescript/lib/lib.es2020.d.ts",
	"node_modules/typescript/lib/lib.es2015.core.d.ts",
	"node_modules/typescript/lib/lib.es2015.collection.d.ts",
	"node_modules/typescript/lib/lib.es2015.generator.d.ts",
	"node_modules/typescript/lib/lib.es2015.iterable.d.ts",
	"node_modules/typescript/lib/lib.es2015.promise.d.ts",
	"node_modules/typescript/lib/lib.es2015.proxy.d.ts",
	"node_modules/typescript/lib/lib.es2015.reflect.d.ts",
	"node_modules/typescript/lib/lib.es2015.symbol.d.ts",
	"node_modules/typescript/lib/lib.es2015.symbol.wellknown.d.ts",
	"node_modules/typescript/lib/lib.es2016.array.include.d.ts",
	"node_modules/typescript/lib/lib.es2017.date.d.ts",
	"node_modules/typescript/lib/lib.es2017.object.d.ts",
	"node_modules/typescript/lib/lib.es2017.sharedmemory.d.ts",
	"node_modules/typescript/lib/lib.es2017.string.d.ts",
	"node_modules/typescript/lib/lib.es2017.intl.d.ts",
	"node_modules/typescript/lib/lib.es2017.typedarrays.d.ts",
	"node_modules/typescript/lib/lib.es2018.asyncgenerator.d.ts",
	"node_modules/typescript/lib/lib.es2018.asynciterable.d.ts",
	"node_modules/typescript/lib/lib.es2018.intl.d.ts",
	"node_modules/typescript/lib/lib.es2018.promise.d.ts",
	"node_modules/typescript/lib/lib.es2018.regexp.d.ts",
	"node_modules/typescript/lib/lib.es2019.array.d.ts",
	"node_modules/typescript/lib/lib.es2019.object.d.ts",
	"node_modules/typescript/lib/lib.es2019.string.d.ts",
	"node_modules/typescript/lib/lib.es2019.symbol.d.ts",
	"node_modules/typescript/lib/lib.es2019.intl.d.ts",
	"node_modules/typescript/lib/lib.es2020.bigint.d.ts",
	"node_modules/typescript/lib/lib.es2020.date.d.ts",
	"node_modules/typescript/lib/lib.es2020.promise.d.ts",
	"node_modules/typescript/lib/lib.es2020.sharedmemory.d.ts",
	"node_modules/typescript/lib/lib.es2020.string.d.ts",
	"node_modules/typescript/lib/lib.es2020.symbol.wellknown.d.ts",
	"node_modules/typescript/lib/lib.es2020.intl.d.ts",
	"node_modules/typescript/lib/lib.es2020.number.d.ts",
	"node_modules/typescript/lib/lib.esnext.intl.d.ts",
	"node_modules/typescript/lib/lib.decorators.d.ts",
	"node_modules/typescript/lib/lib.decorators.legacy.d.ts",
	"node_modules/typescript/lib/lib.dom.d.ts",
	"node_modules/typescript/lib/lib.webworker.importscripts.d.ts",
	"node_modules/typescript/lib/lib.scripthost.d.ts",
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
	typesFile.addName("cheerp::makeString");
	typesFile.addInclude("jsobject.h", false, jsobjectFile);
	clientlibFile.addInclude("types.h", false, typesFile);
	clientlibFile.addInclude("function.h", false, typesFile);
	library.addGlobalInclude("jshelper.h", false);
} else {
	library.addGlobalInclude("cheerp/clientlib.h", true);
}

const parseTimer = new Timer("parse");
const parser = new Parser(tsProgram, library, options.defaultLib);
parseTimer.end();

catchErrors(() => {
	const writeTimer = new Timer("write");
	library.write(writerOptions);
	writeTimer.end();
});
