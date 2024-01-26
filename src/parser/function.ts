import { Parser } from "./parser.js";
import { Generics } from "./generics.js";
import { Namespace, Flags } from "../declaration/namespace.js";
import { Class } from "../declaration/class.js";
import * as ts from "typescript";

export function parseFunction(parser: Parser, declaration: ts.SignatureDeclarationBase, generics: Generics, isStatic: boolean, parent?: Namespace): void {
	const parentClass = parent instanceof Class ? parent : undefined;
	const className = parentClass?.getName();
	const forward = parentClass?.getBasicVersion()?.getName();

	for (const func of parser.createFuncs(declaration, generics, forward, className)) {
		func.setDeclaration(declaration);
		parser.addDeclaration(func, parent);

		if (isStatic && !ts.isConstructSignatureDeclaration(declaration) && !ts.isConstructorDeclaration(declaration)) {
			func.addFlags(Flags.Static);
		} else if (parent instanceof Class && /* TODO: remove */ !ts.isFunctionDeclaration(declaration)) {
			parser.createVariadicHelper(func);
		}
	}
}
