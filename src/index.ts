import { Parser } from "./parser/parser.js";
import { catchErrors } from "./error.js";
import { Library } from "./library.js";
import { withTimer, parseOptions, options } from "./utility.js";
import * as ts from "typescript";

// 1. Parse command line options.
const args = parseOptions();

// 2. Add default library files if "--default-lib" is specified.
if (options.isDefaultLib) {
	args.push("node_modules/typescript/lib/lib.es5.d.ts");
	args.push("node_modules/typescript/lib/lib.es2015.d.ts");
	args.push("node_modules/typescript/lib/lib.es2016.d.ts");
	args.push("node_modules/typescript/lib/lib.es2017.d.ts");
	args.push("node_modules/typescript/lib/lib.es2018.d.ts");
	args.push("node_modules/typescript/lib/lib.es2019.d.ts");
	args.push("node_modules/typescript/lib/lib.es2020.d.ts");
	args.push("node_modules/typescript/lib/lib.es2015.core.d.ts");
	args.push("node_modules/typescript/lib/lib.es2015.collection.d.ts");
	args.push("node_modules/typescript/lib/lib.es2015.generator.d.ts");
	args.push("node_modules/typescript/lib/lib.es2015.iterable.d.ts");
	args.push("node_modules/typescript/lib/lib.es2015.promise.d.ts");
	args.push("node_modules/typescript/lib/lib.es2015.proxy.d.ts");
	args.push("node_modules/typescript/lib/lib.es2015.reflect.d.ts");
	args.push("node_modules/typescript/lib/lib.es2015.symbol.d.ts");
	args.push("node_modules/typescript/lib/lib.es2015.symbol.wellknown.d.ts");
	args.push("node_modules/typescript/lib/lib.es2016.array.include.d.ts");
	args.push("node_modules/typescript/lib/lib.es2017.date.d.ts");
	args.push("node_modules/typescript/lib/lib.es2017.object.d.ts");
	args.push("node_modules/typescript/lib/lib.es2017.sharedmemory.d.ts");
	args.push("node_modules/typescript/lib/lib.es2017.string.d.ts");
	args.push("node_modules/typescript/lib/lib.es2017.intl.d.ts");
	args.push("node_modules/typescript/lib/lib.es2017.typedarrays.d.ts");
	args.push("node_modules/typescript/lib/lib.es2018.asyncgenerator.d.ts");
	args.push("node_modules/typescript/lib/lib.es2018.asynciterable.d.ts");
	args.push("node_modules/typescript/lib/lib.es2018.intl.d.ts");
	args.push("node_modules/typescript/lib/lib.es2018.promise.d.ts");
	args.push("node_modules/typescript/lib/lib.es2018.regexp.d.ts");
	args.push("node_modules/typescript/lib/lib.es2019.array.d.ts");
	args.push("node_modules/typescript/lib/lib.es2019.object.d.ts");
	args.push("node_modules/typescript/lib/lib.es2019.string.d.ts");
	args.push("node_modules/typescript/lib/lib.es2019.symbol.d.ts");
	args.push("node_modules/typescript/lib/lib.es2019.intl.d.ts");
	args.push("node_modules/typescript/lib/lib.es2020.bigint.d.ts");
	args.push("node_modules/typescript/lib/lib.es2020.date.d.ts");
	args.push("node_modules/typescript/lib/lib.es2020.promise.d.ts");
	args.push("node_modules/typescript/lib/lib.es2020.sharedmemory.d.ts");
	args.push("node_modules/typescript/lib/lib.es2020.string.d.ts");
	args.push("node_modules/typescript/lib/lib.es2020.symbol.wellknown.d.ts");
	args.push("node_modules/typescript/lib/lib.es2020.intl.d.ts");
	args.push("node_modules/typescript/lib/lib.es2020.number.d.ts");
	args.push("node_modules/typescript/lib/lib.esnext.intl.d.ts");
	args.push("node_modules/typescript/lib/lib.decorators.d.ts");
	args.push("node_modules/typescript/lib/lib.decorators.legacy.d.ts");
	args.push("node_modules/typescript/lib/lib.dom.d.ts");
	args.push("node_modules/typescript/lib/lib.webworker.d.ts");
	args.push("node_modules/typescript/lib/lib.webworker.importscripts.d.ts");
	args.push("node_modules/typescript/lib/lib.scripthost.d.ts");
}

// 3. Parse the typescript declaration files.
const tsProgram = withTimer("create program", () => {
	return ts.createProgram(args, {});
});

// 4. List which files were used if "--list-files" is specified. This could be
// more than only the files which were specified, if they include other files.
if (options.listFiles) {
	for (const sourceFile of tsProgram.getSourceFiles()) {
		console.log(sourceFile.fileName);
	}
}

// 5. Create the library instance.
const library = new Library(options.outputFile ?? "cheerp/clientlib.h", args);

// 6. If this isn't "clientlib.h", add an include for "clientlib.h".
if (!options.isDefaultLib) {
	library.addGlobalInclude("cheerp/clientlib.h", true);
}

// 7. Convert the typescript AST into a C++ AST.
const parser = withTimer("parse", () => {
	return new Parser(tsProgram, library).run(options.isDefaultLib);
});

// 8. Write everything into C++ headers.
catchErrors(() => {
	withTimer("write", () => {
		library.write({ pretty: options.isPretty });
	});
});
