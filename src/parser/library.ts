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

function getGlobalClasses(parser: Parser): ReadonlyArray<Class> {
	const globalClasses = [];
	globalClasses.push(parser.getRootClass("Window"));
	globalClasses.push(parser.getRootClass("WorkerGlobalScope"));
	return globalClasses.filter((globalClass): globalClass is Class => !!globalClass);
}

export function parseLibrary(parser: Parser, node: Node, parent?: Namespace): void {
	parser.incrementTarget(node.getSize());

	for (const child of node.getChildren()) {
		parser.incrementProgress(child);

		const functionDeclarations = child.getFunctionDeclarations();

		if (child.basicClass) {
			parseClass(parser, child, child.basicClass, EMPTY, parent);

			if (child.genericClass) {
				parseClass(parser, child, child.genericClass, EMPTY, parent);
			}
		} else if (functionDeclarations.length > 0 && child.getSize() === 0) {
			for (const declaration of functionDeclarations) {
				parseFunction(parser, declaration, EMPTY, false, parent);

				if (parent === parser.getRootNamespace()) {
					for (const globalClass of getGlobalClasses(parser)) {
						parseFunction(parser, declaration, EMPTY, false, globalClass);
					}
				}
			}
		} else if (child.variableDeclaration) {
			parseVariable(parser, child.variableDeclaration, EMPTY, parent);

			if (child.getSize() > 0) {
				parseLibrary(parser, child, new Namespace(`${child.getName()}_`, parent));
			}
		} else if (child.basicTypeAlias && child.typeAliasDeclaration) {
			parseTypeAlias(parser, child.typeAliasDeclaration, child.basicTypeAlias, EMPTY, parent);

			if (child.genericTypeAlias) {
				parseTypeAlias(parser, child.typeAliasDeclaration, child.genericTypeAlias, EMPTY, parent);
			}
		} else {
			parseLibrary(parser, child, new Namespace(child.getName(), parent));
		}
	}
}
