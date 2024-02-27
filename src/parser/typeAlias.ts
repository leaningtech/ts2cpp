import { Parser } from "./parser.js";
import { TypeAlias } from "../declaration/typeAlias.js";
import { Generics } from "./generics.js";
import { Namespace } from "../declaration/namespace.js";
import { TemplateType } from "../type/templateType.js";
import * as ts from "typescript";

export function parseTypeAlias(parser: Parser, declaration: ts.TypeAliasDeclaration, object: TypeAlias, generics: Generics, parent?: Namespace): void {
	// 1. If we're not going to emit this declaration anyways, there's no point
	// in parsing it.
	if (!parser.includesDeclaration(declaration)) {
		return;
	}

	generics = generics.clone();
	
	// 2. Parse the type parameters with `createParameters` and add them to the
	// type alias.
	const [parameters, constraints] = generics.createParameters(parser, [declaration]);
	parameters.forEach(([parameter, _]) => object.addTypeParameter(parameter.getName()));

	// 3. Parse and set the aliased type of the type alias, possibly
	// making an `std::enable_if_t` template using constraints returned
	// from `createParameters`.
	const info = parser.getTypeNodeInfo(declaration.type, generics);
	object.setType(TemplateType.makeConstraint(info.asTypeAlias(), constraints));

	// 4. Some post processing:
	// - Mark the type alias as coming from the declaration `declaration`.
	// - Remove unused type parameters.
	object.setDeclaration(declaration);
	object.removeUnusedTypeParameters();

	// 5. Add it to the parent declaration.
	parser.addDeclaration(object, parent);
}
