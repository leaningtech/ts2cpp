import { Parser } from "./parser.js";
import { TypeAlias } from "../declaration/typeAlias.js";
import { Generics } from "./generics.js";
import { Namespace } from "../declaration/namespace.js";
import { TemplateType } from "../type/templateType.js";
import * as ts from "typescript";

export function parseTypeAlias(parser: Parser, declaration: ts.TypeAliasDeclaration, object: TypeAlias, generics: Generics, parent?: Namespace): void {
	if (!parser.includesDeclaration(declaration)) {
		return;
	}

	generics = generics.clone();
	
	if (object.isGenericVersion()) {
		const [parameters, constraints] = generics.createParameters(parser, [declaration]);
		parameters.forEach(parameter => object.addTypeParameter(parameter.getName()));
		const info = parser.getTypeNodeInfo(declaration.type, generics);
		object.setType(TemplateType.makeConstraint(info.asTypeAlias(), constraints));
	} else {
		generics.createConstraints(parser, [declaration]);
		const info = parser.getTypeNodeInfo(declaration.type, generics);
		object.setType(info.asTypeAlias());
	}

	object.setDeclaration(declaration);
	object.removeUnusedTypeParameters();
	parser.addDeclaration(object, parent);
}
