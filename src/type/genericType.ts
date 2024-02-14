import { UnqualifiedType } from "./type.js";
import { Dependency, State, Dependencies } from "../target.js";
import { Writer } from "../writer.js";
import { Namespace } from "../declaration/namespace.js";

// A `GenericType` is a type that reference a type argument of a template
// declaration.
export class GenericType extends UnqualifiedType {
	private readonly name: string;

	private constructor(name: string) {
		super();
		this.name = name;
	}

	public getName(): string {
		return this.name;
	}

	public getDependencies(reason: Dependency, innerState?: State): Dependencies {
		return new Dependencies;
	}

	public write(writer: Writer, namespace?: Namespace): void {
		writer.write(this.name);
	}
	
	public key(): string {
		return `N${this.name};`;
	}

	public isVoidLike(): boolean {
		return this.name === "void";
	}

	public static create(name: string): GenericType {
		return new GenericType(name).intern();
	}
}

export const ARGS = GenericType.create("_Args");
