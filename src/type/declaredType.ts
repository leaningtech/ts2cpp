import { UnqualifiedType } from "./type.js";
import { Declaration } from "../declaration/declaration.js";
import { Dependency, State, Dependencies } from "../target.js";
import { Writer } from "../writer.js";
import { Namespace } from "../declaration/namespace.js";

// A declared type is one for which we have a declaration.
//
// Don't be fooled by the small implementation of `DeclaredType`, this is
// *the most important* type to make dependency resolution work. If a function
// declaration references `String`, we *must* be able to get the declaration
// of `String` so we can order its generation before the function. All of
// dependency resolution eventually reaches a call to `getDependencies` in this
// type.
export class DeclaredType extends UnqualifiedType {
	private readonly declaration: Declaration;

	private constructor(declaration: Declaration) {
		super();
		this.declaration = declaration;
	}

	public getDeclaration(): Declaration {
		return this.declaration;
	}

	public getDependencies(reason: Dependency, innerState?: State): Dependencies {
		return new Dependencies([[this.declaration, reason]]);
	}

	public write(writer: Writer, namespace?: Namespace): void {
		writer.write(this.declaration.getPath(namespace));
	}

	public key(): string {
		return `D${this.declaration.getId()}`;
	}

	public getName(): string {
		return this.declaration.getName();
	}

	public static create(declaration: Declaration): DeclaredType {
		return new DeclaredType(declaration).intern();
	}
}
