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

		if (this.qualifier & TypeQualifier.Variadic) {
			writer.write("...");
		}

		if (this.qualifier & TypeQualifier.RValueReference) {
			writer.write("&&");
		}
	}
	
	public key(): string {
		return `Q${this.qualifier}${this.inner.key()}`;
	}

	public removeQualifiers(): Expression {
		if (!(this.qualifier & TypeQualifier.Variadic)) {
			return this.inner.removeQualifiers();
		} else {
			return this;
		}
	}
}
