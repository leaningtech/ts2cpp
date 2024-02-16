import { Parser } from "./parser.js";
import { Generics } from "./generics.js";
import { Namespace, Flags } from "../declaration/namespace.js";
import { Class } from "../declaration/class.js";
import { VOID_TYPE } from "../type/namedType.js";
import { getName } from "./name.js";
import { Variable } from "../declaration/variable.js";
import * as ts from "typescript";

export function parseVariable(parser: Parser, declaration: ts.VariableDeclaration | ts.PropertySignature | ts.PropertyDeclaration, generics: Generics, parent?: Namespace): void {
	// 1. If we're not going to emit this declaration anyways, there's no point
	// in parsing it.
	if (!parser.includesDeclaration(declaration)) {
		return;
	}

	const isMember = parent instanceof Class;
	const [interfaceName, escapedName] = getName(declaration);

	// 2. Parse the type of the variable.
	const info = parser.getTypeNodeInfo(declaration.type, generics);

	// 3. If this is an optional property, we mark the type as optional, this
	// may have an effect on the qualifiers or attributes of the final C++
	// type. An example of an optional property:
	// ```
	// declare interface Foo {
	//     bar?: number;
	// }
	// ```
	if (ts.isPropertySignature(declaration) && declaration.questionToken) {
		info.setOptional();
	}

	// 4. Create the variable object.
	const object = new Variable(escapedName, info.asVariableType(isMember));

	// 5. Variables of type `void` are not allowed in C++, we just don't
	// generate them at all. Another option might've beeen to generate them
	// with type `_Any*`.
	if (object.getType() === VOID_TYPE) {
		return;
	}

	// 6. Some post processing:
	// - Mark the variable as coming from the declaration `declaration`.
	// - Add `static` to member variables and `extern` to global variables.
	object.setDeclaration(declaration);
	object.addFlags(isMember ? Flags.Static : Flags.Extern);

	// 7. Add it to the parent declaration.
	parser.addDeclaration(object, parent);
}
