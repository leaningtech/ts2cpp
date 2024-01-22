import { Type } from "./type.js";
import { Dependency, State, Dependencies } from "../target.js";
import { Writer } from "../writer.js";
import { Namespace } from "../declaration/namespace.js";
import { Expression } from "./expression.js";

export enum TypeQualifier {
	Pointer = 1,
	Reference = 2,
	Const = 4,
	Variadic = 8,
	RValueReference = 16,
	ConstPointer = Const | Pointer,
	ConstReference = Const | Reference,
}

// A `QualifiedType` is a type that may have type qualifiers.
//
// Note that in C++, pointers are *not* considered qualified, they are a
// completely distinct type in the type system. But for us it is easier to
// represent it as a qualifier anyways.
//
// There is also a `Variadic` qualifier, used when expanding variadic template
// arguments, such as `T...` in the following example:
//
// ```
// template<class... T>
// void foo(T... args);
// ```
//
// Multiple qualifiers can be combined, in this case the order in which they
// are applied is as follows:
// - const
// - pointer
// - reference
// - rvalue reference
// - variadic
export class QualifiedType extends Type {
	private readonly inner: Type;
	private readonly qualifier: TypeQualifier;

	public constructor(inner: Type, qualifier: TypeQualifier) {
		super();
		this.inner = inner;
		this.qualifier = qualifier;
	}

	public getInner(): Type {
		return this.inner;
	}

	public getQualifier(): TypeQualifier {
		return this.qualifier;
	}

	// The dependencies of a qualified type are:
	// - the inner type.
	//
	// The required state depends on if the type is pointer, reference, or
	// rvalue-reference qualified, and whether `innerState` is set to
	// `Complete`. See "src/type/expression.ts" for a description of
	// `innerState`.
	public getDependencies(reason: Dependency, innerState?: State): Dependencies {
		if (this.qualifier & (TypeQualifier.Pointer | TypeQualifier.Reference | TypeQualifier.RValueReference)) {
			return this.inner.getDependencies(reason.withState(innerState ?? State.Partial), innerState);
		} else {
			return this.inner.getDependencies(reason);
		}
	}
	
	public getReferencedTypes(): ReadonlyArray<Type> {
		return [this, ...this.inner.getReferencedTypes()];
	}

	public write(writer: Writer, namespace?: Namespace): void {
		if (this.qualifier & TypeQualifier.Const) {
			writer.write("const");
			writer.writeSpace();
		}

		this.getInner().write(writer, namespace);

		if (this.qualifier & TypeQualifier.Pointer) {
			writer.write("*");
		}

		if (this.qualifier & TypeQualifier.Reference) {
			writer.write("&");
		}

		if (this.qualifier & TypeQualifier.RValueReference) {
			writer.write("&&");
		}

		if (this.qualifier & TypeQualifier.Variadic) {
			writer.write("...");
		}
	}
	
	public key(): string {
		return `Q${this.qualifier}${this.inner.key()}`;
	}

	// Remove all qualifiers, except when this type is variadic.
	//
	// This implementation is questionable. Should other qualifiers still be
	// removed if the type is variadic? Why not remove variadic in the first
	// place? I don't think this function is ever called on a variadic type.
	// I don't have a good reason for any of this, but I'm not changing it
	// until something breaks.
	public removeQualifiers(): Expression {
		if (!(this.qualifier & TypeQualifier.Variadic)) {
			return this.inner.removeQualifiers();
		} else {
			return this;
		}
	}
}
