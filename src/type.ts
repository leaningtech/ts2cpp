import { Namespace } from "./namespace.js";
import { Declaration } from "./declaration.js";

export abstract class Type {
	public abstract getDeclaration(): Declaration | undefined;
	public abstract getPath(namespace?: Namespace): string;

	public pointer(): PointerType {
		return new PointerType(this);
	}
}

export class VoidType extends Type {
	public getDeclaration(): undefined {
		return undefined;
	}

	public getPath(namespace?: Namespace): string {
		return "void";
	}
}

export class PointerType extends Type {
	private readonly inner: Type;

	public constructor(inner: Type) {
		super();
		this.inner = inner;
	}

	public getDeclaration(): Declaration | undefined {
		return this.inner.getDeclaration();
	}

	public getPath(namespace?: Namespace): string {
		return this.inner.getPath(namespace) + "*";
	}
}

export class DeclaredType extends Type {
	private readonly declaration: Declaration;

	public constructor(declaration: Declaration) {
		super();
		this.declaration = declaration;
	}

	public getDeclaration(): Declaration {
		return this.declaration;
	}

	public getPath(namespace?: Namespace): string {
		return this.declaration.getPath(namespace);
	}
}
