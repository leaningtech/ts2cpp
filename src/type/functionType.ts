import { Type } from "./type.js";
import { Dependency, State, Dependencies } from "../target.js";
import { Writer } from "../writer.js";
import { Namespace } from "../declaration/namespace.js";

export class FunctionType extends Type {
	private readonly returnType: Type;
	private readonly parameters: Array<Type> = new Array;

	public constructor(returnType: Type) {
		super();
		this.returnType = returnType;
	}

	public getReturnType(): Type {
		return this.returnType;
	}

	public getParameters(): ReadonlyArray<Type> {
		return this.parameters;
	}

	public addParameter(parameter: Type): void {
		this.parameters.push(parameter);
	}

	public getDependencies(reason: Dependency, innerState?: State): Dependencies {
		const partialReason = reason.withState(State.Partial);

		return new Dependencies(
			this.parameters
				.flatMap(typeParameter => [...typeParameter.getDependencies(partialReason)])
				.concat([...this.returnType.getDependencies(partialReason)])
		);
	}

	public getReferencedTypes(): ReadonlyArray<Type> {
		return this.parameters
			.flatMap(parameter => [...parameter.getReferencedTypes()])
			.concat([this, ...this.returnType.getReferencedTypes()]);
	}

	public write(writer: Writer, namespace?: Namespace): void {
		let first = true;
		this.returnType.write(writer, namespace);
		writer.write("(");

		for (const parameter of this.parameters) {
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
		const parameters = this.parameters
			.map(parameter => parameter.key()).join("");

		return `f${this.returnType.key()}${parameters};`;
	}
}
