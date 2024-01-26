import { Parser } from "./parser.js";
import { Generics } from "./generics.js";
import { Namespace, Flags } from "../declaration/namespace.js";
import { Class } from "../declaration/class.js";
import { VOID_TYPE } from "../type/namedType.js";
import * as ts from "typescript";

export function parseVariable(parser: Parser, declaration: ts.VariableDeclaration | ts.PropertySignature | ts.PropertyDeclaration, generics: Generics, parent?: Namespace): void {
	const variable = parser.createVar(declaration, generics, parent instanceof Class);

	if (variable.getType() !== VOID_TYPE) {
		if (parent instanceof Class) {
			variable.addFlags(Flags.Static);
		} else {
			variable.addFlags(Flags.Extern);
		}
	}

	parser.addDeclaration(variable, parent);
}
