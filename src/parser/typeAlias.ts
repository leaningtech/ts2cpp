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
	
	if (object.isGenericVersion()) {
		// 2.1. If this is the generic version of this type alias, use
		// `createParameters` to parse the type parameters.
		const [parameters, constraints] = generics.createParameters(parser, [declaration]);

		// 2.2. Add the type parameters to the type alias.
		parameters.forEach(parameter => object.addTypeParameter(parameter.getName()));

		// 2.3. Parse and set the aliased type of the type alias, possibly
		// making an `std::enable_if_t` template using constraints returned
		// from `createParameters`.
		const info = parser.getTypeNodeInfo(declaration.type, generics);
		object.setType(TemplateType.makeConstraint(info.asTypeAlias(), constraints));
	} else {
		// 3.1. If this is the basic version of this type alias, use
		// `createConstraints` to parse the type parameters.
		generics.createConstraints(parser, [declaration]);

		// 3.2. Parse and set the aliased type of the type alias.
		const info = parser.getTypeNodeInfo(declaration.type, generics);
		object.setType(info.asTypeAlias());
	}

	// 4. Some post processing:
	// - mark the type alias as coming from the declaration `declaration`.
	// - remove unused type parameters.
	object.setDeclaration(declaration);
	object.removeUnusedTypeParameters();

	// 5. Add it to the parent declaration.
	parser.addDeclaration(object, parent);
}
