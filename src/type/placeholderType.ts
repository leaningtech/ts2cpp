import { Type, UnqualifiedType } from "./type.js";
import { Dependency, State, Dependencies } from "../target.js";
import { Writer } from "../writer.js";
import { Namespace } from "../declaration/namespace.js";

// `PlaceholderType` is a helper type to parse recursive types. When the type
// parser encounters a type that it has already seen before, but not yet fully
// parsed, it will place a placeholder type. After the type has been fully
// parsed, all placeholder types are replaced with real types.
export class PlaceholderType extends UnqualifiedType {
	private static count: number = 0;
	private readonly index: number = PlaceholderType.count++;

	public getDependencies(reason: Dependency, innerState?: State): Dependencies {
		throw "cannot call `getDependencies` on placeholder type";
	}

	public getReferencedTypes(): ReadonlyArray<Type> {
		throw "cannot call `getReferencedTypes` on placeholder type";
	}

	public write(writer: Writer, namespace?: Namespace): void {
		throw "cannot call `write` on placeholder type";
	}

	public key(): string {
		return `P${this.index};`;
	}
}
