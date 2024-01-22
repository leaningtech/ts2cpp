import { Expression } from "./expression.js";
import { Dependency, State, Dependencies } from "../target.js";
import { Type } from "./type.js";
import { Writer } from "../writer.js";
import { Namespace } from "../declaration/namespace.js";

// A literal expression is just text. Any dependencies it may have are assumed
// to exist. The token is written literally and should be valid C++.
//
// This is mostly used for simple terminal types like "true" and "false", but
// it can also be used when you want any quick and dirty type and don't need to
// bother with dependency or reference resolution.
export class LiteralExpression extends Expression {
	private readonly token: string;

	private constructor(token: string) {
		super();
		this.token = token;
	}
	
	public getDependencies(reason: Dependency, innerState?: State): Dependencies {
		return new Dependencies;
	}
	
	public getReferencedTypes(): ReadonlyArray<Type> {
		return [];
	}

	public write(writer: Writer, namespace?: Namespace): void {
		writer.write(this.token);
	}

	public key(): string {
		return `L${this.token};`;
	}

	// "true" is always true. We also say "..." is true, this may be a bug, but
	// it hasn't caused any issues yet.
	public isAlwaysTrue(): boolean {
		return this.token === "true" || this.token === "...";
	}

	public static create(token: string): LiteralExpression {
		return new LiteralExpression(token).intern();
	}
}

export const ELLIPSES = LiteralExpression.create("...");
export const TRUE = LiteralExpression.create("true");
export const FALSE = LiteralExpression.create("false");
