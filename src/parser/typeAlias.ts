import { Parser } from "./parser.js";
import { TypeAlias } from "../declaration/typeAlias.js";
import { Generics } from "./generics.js";
import { Namespace } from "../declaration/namespace.js";
import * as ts from "typescript";

export function parseTypeAlias(parser: Parser, declaration: ts.TypeAliasDeclaration, object: TypeAlias, generics: Generics, parent?: Namespace): void {
	parser.generateType(declaration, generics, object, object.isGenericVersion());
	parser.addDeclaration(object, parent);
}
