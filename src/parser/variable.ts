import { Parser } from "./parser.js";
import { Generics } from "./generics.js";
import { Namespace, Flags } from "../declaration/namespace.js";
import { Class } from "../declaration/class.js";
import { VOID_TYPE } from "../type/namedType.js";
import { getName } from "./name.js";
import { Variable } from "../declaration/variable.js";
import * as ts from "typescript";

export function parseVariable(parser: Parser, declaration: ts.VariableDeclaration | ts.PropertySignature | ts.PropertyDeclaration, generics: Generics, parent?: Namespace): void {
	if (!parser.includesDeclaration(declaration)) {
		return;
	}

	const member = parent instanceof Class;
	const [interfaceName, escapedName] = getName(declaration);
	const info = parser.getTypeNodeInfo(declaration.type, generics);

	if (ts.isPropertySignature(declaration) && declaration.questionToken) {
		info.setOptional();
	}

	const object = new Variable(escapedName, info.asVariableType(member));

	if (object.getType() !== VOID_TYPE) {
		object.addFlags(member ? Flags.Static : Flags.Extern);
		object.setDeclaration(declaration);
		parser.addDeclaration(object, parent);
	}
}
