import { Type, UnqualifiedType } from "./type.js";
import { Dependency, State, Dependencies } from "../target.js";
import { Writer } from "../writer.js";
import { Namespace } from "../declaration/namespace.js";

// A member type (sometimes also called an associated type) is an inner type of
// a class, such as "typename Container::iterator".
//
// A class that contains a member type looks like this:
// ```
// class Container {
//     using iterator = int*;
// };
// ```
export class MemberType extends UnqualifiedType {
	private readonly inner: Type;
	private readonly name: string;

	public constructor(inner: Type, name: string) {
		super();
		this.inner = inner;
		this.name = name;
	}

	public getInner(): Type {
		return this.inner;
	}

	public getName(): string {
		return this.name;
	}

	public getDependencies(reason: Dependency, innerState?: State): Dependencies {
		return this.inner.getDependencies(reason.withState(State.Complete));
	}
	
	public getReferencedTypes(): ReadonlyArray<Type> {
		return [this, ...this.inner.getReferencedTypes()];
	}

	public write(writer: Writer, namespace?: Namespace): void {
		// We must write "typename" in case `inner` is a dependent type.
		// Thanks C++ :D :D :D
		writer.write("typename");
		writer.writeSpace();
		this.inner.write(writer, namespace);
		writer.write("::");
		writer.write(this.name);
	}

	public key(): string {
		return `Y${this.inner.key()}${this.name};`;
	};
}
