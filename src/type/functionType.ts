import { Expression } from "./expression.js";
import { Type } from "./type.js";
import { PlaceholderType } from "./placeholderType.js";
import { Dependency, State, Dependencies } from "../target.js";
import { Writer } from "../writer.js";
import { Namespace } from "../declaration/namespace.js";

// A C-style function type of the form "int(const char*)" (a function taking a
// const char* and returning an int). This is used, for example, as a type
// parameter to `_Function<T>`.
export class FunctionType extends Type {
	private readonly returnType: Type;
	private parameters?: Array<Type>;

	private constructor(returnType: Type) {
		super();
		this.returnType = returnType;
	}

	public getReturnType(): Type {
		return this.returnType;
	}

	public getParameters(): ReadonlyArray<Type> {
		return this.parameters ?? [];
	}

	// The dependencies of a function type are:
	// - partial for the parameter types.
	// - partial for the return type.
	public getDependencies(reason: Dependency, innerState?: State): Dependencies {
		const partialReason = reason.withState(State.Partial);

		return new Dependencies(
			this.getParameters()
				.flatMap(typeParameter => [...typeParameter.getDependencies(partialReason)])
				.concat([...this.returnType.getDependencies(partialReason)])
		);
	}

	public getReferencedTypes(): ReadonlyArray<Type> {
		return this.getParameters()
			.flatMap(parameter => [...parameter.getReferencedTypes()])
			.concat([this, ...this.returnType.getReferencedTypes()]);
	}

	public write(writer: Writer, namespace?: Namespace): void {
		let first = true;
		this.returnType.write(writer, namespace);
		writer.write("(");

		for (const parameter of this.getParameters()) {
			if (!first) {
				writer.write(",");
				writer.writeSpace(false);
			}

			parameter.write(writer, namespace);
			first = false;
		}

		writer.write(")");
	}

	public key(): string {
		const parameters = this.getParameters()
			.map(parameter => parameter.key()).join("");

		return `f${this.returnType.key()}${parameters};`;
	}
	
	public fix(placeholder: PlaceholderType, type: Expression): any {
		return FunctionType.create(
			this.returnType.fix(placeholder, type),
			...this.getParameters().map(parameter => parameter.fix(placeholder, type))
		);
	}

	public static create(returnType: Type, ...parameters: ReadonlyArray<Type>): FunctionType {
		const result = new FunctionType(returnType);
		
		if (parameters.length > 0) {
			result.parameters = [...parameters];
		}

		return result.intern();
	}
}
