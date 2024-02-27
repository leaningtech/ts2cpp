import { Parser } from "./parser.js";
import { Node } from "./node.js";
import { Namespace } from "../declaration/namespace.js";
import { Generics } from "./generics.js";
import { Class } from "../declaration/class.js";
import { parseClass } from "./class.js";
import { parseTypeAlias } from "./typeAlias.js";
import { parseFunction } from "./function.js";
import { parseVariable } from "./variable.js";

const EMPTY = new Generics;

// Get a list of "global" classes. Global classes are classes that represent
// the global scope in some context. For example, `Window`, or
// `WorkerGlobalScope`.
function getGlobalClasses(parser: Parser): ReadonlyArray<Class> {
	const globalClasses = [];
	globalClasses.push(parser.getRootClass("Window"));
	globalClasses.push(parser.getRootClass("WorkerGlobalScope"));
	return globalClasses.filter((globalClass): globalClass is Class => !!globalClass);
}

// `parseLibrary` is the main entry point for converting the tree structure
// described in "src/parser/node.ts" into an AST of C++ declarations. This
// function recursively calls itself for namespace nodes (nodes that do not
// have any other declaration). For non-namespace nodes, it calls any of the
// following functions:
// - classes: `parseClass` in "src/parser/class.ts"
// - functions: `parseFunction` in "src/parser/function.ts"
// - variables: `parseVariable` in "src/parser/variable.ts"
// - type aliases: `parseTypeAlias` in "src/parser/typeAlias.ts"
export function parseLibrary(parser: Parser, node: Node, parent?: Namespace): void {
	// `incrementTarget` and `incrementProgress` provide some very primitive
	// progress information that is output only in verbose mode.
	parser.incrementTarget(node.getSize());

	for (const child of node.getChildren()) {
		parser.incrementProgress(child);

		const functionDeclarations = child.getFunctionDeclarations();

		if (child.classObject) {
			// Classes are parsed using `parseClass`.
			parseClass(parser, child, child.classObject, EMPTY, parent);
		} else if (functionDeclarations.length > 0 && child.getSize() === 0) {
			// Functions are parsed using `parseFunction`.
			for (const declaration of functionDeclarations) {
				parseFunction(parser, declaration, EMPTY, false, parent);

				// If this is a global function, we also add it to "global"
				// classes. For example, the `eval` function is only declared
				// as a global function, but should still be possible to call
				// `window.eval`. So we need functions like `eval` to be added
				// to the `Window` class.
				if (parent === parser.getRootNamespace()) {
					for (const globalClass of getGlobalClasses(parser)) {
						parseFunction(parser, declaration, EMPTY, false, globalClass);
					}
				}
			}
		} else if (child.variableDeclaration) {
			// Variables are parsed using `parseVariable`.
			parseVariable(parser, child.variableDeclaration, EMPTY, parent);

			// The variable node might also have children, this matches the
			// following typescript declaration:
			// ```
			// declare var Foo: FooConstructor;
			//
			// declare namespace Foo {
			//     function func(): void;
			// }
			// ```
			//
			// The variable is generated as normal, and we also generate a
			// namespace, with an extra "_" at the end of its name. Because of
			// the extra "_", there is currently no way to actually use this
			// namespace.
			//
			// TODO: add an interface name for the namespace
			if (child.getSize() > 0) {
				parseLibrary(parser, child, new Namespace(`${child.getName()}_`, parent));
			}
		} else if (child.typeAliasObject && child.typeAliasDeclaration) {
			// Type aliases are parsed using `parseTypeAlias`.
			parseTypeAlias(parser, child.typeAliasDeclaration, child.typeAliasObject, EMPTY, parent);
		} else {
			// No declarations for this node, this must be a namespace node.
			parseLibrary(parser, child, new Namespace(child.getName(), parent));
		}
	}
}
