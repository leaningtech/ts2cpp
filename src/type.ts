import { Namespace } from "./namespace.js";
import { Declaration } from "./declaration.js";

export interface Type {
	getDeclaration(): Declaration | undefined;
	getPath(namespace?: Namespace): string;
}

export class DeclaredType implements Type {
	private readonly declaration: Declaration;

	public constructor(declaration: Declaration) {
		this.declaration = declaration;
	}

	public getDeclaration(): Declaration {
		return this.declaration;
	}

	public getPath(namespace?: Namespace): string {
		return this.declaration.getPath(namespace);
	}
}
