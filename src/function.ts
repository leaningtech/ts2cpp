import { Declaration, TemplateDeclaration } from "./declaration.js";
import { Namespace, Flags } from "./namespace.js";
import { State, Dependency, Dependencies, ReasonKind } from "./target.js";
import { Writer } from "./writer.js";
import { Type } from "./type.js";

export class Parameter {
	private readonly type: Type;
	private readonly name: string;

	public constructor(type: Type, name: string) {
		this.type = type;
		this.name = name;
	}

	public getType(): Type {
		return this.type;
	}

	public getName(): string {
		return this.name;
	}
}

export class Function extends TemplateDeclaration {
	private readonly parameters: Array<Parameter> = new Array;
	private type?: Type;

	public constructor(name: string, type?: Type, namespace?: Namespace) {
		super(name, namespace);
		this.type = type;
	}

	public getParameters(): ReadonlyArray<Parameter> {
		return this.parameters;
	}

	public addParameter(type: Type, name: string): void {
		this.parameters.push(new Parameter(type, name));
	}

	public getType(): Type | undefined {
		return this.type;
	}

	public maxState(): State {
		return State.Partial;
	}

	public getChildren(): ReadonlyArray<Declaration> {
		return new Array;
	}

	public getDirectDependencies(state: State): Dependencies {
		return new Dependencies(
			this.parameters
				.flatMap(parameter => parameter.getType().getDeclarations().map(declaration => [declaration, ReasonKind.ParameterType]))
				.concat(this.type?.getDeclarations()?.map(declaration => [declaration, ReasonKind.ReturnType]) ?? [])
				.filter((declaration): declaration is [Declaration, ReasonKind] => !!declaration[0])
				.map(([declaration, reasonKind]) => [declaration, new Dependency(State.Partial, this, reasonKind)])
		);
	}

	public write(writer: Writer, state: State, namespace?: Namespace): void {
		const flags = this.getFlags();
		let first = true;
		this.writeTemplate(writer);

		if (flags & Flags.Static) {
			writer.write("static");
			writer.writeSpace();
		}

		if (this.type) {
			this.type.write(writer, namespace);
			writer.writeSpace();
		}

		writer.write(this.getName());
		writer.write("(");

		for (const parameter of this.parameters) {
			if (!first) {
				writer.write(",");
				writer.writeSpace(false);
			}

			parameter.getType().write(writer, namespace);
			writer.writeSpace();
			writer.write(parameter.getName());
			first = false;
		}

		writer.write(")");

		if (this.getAttributes().length > 0) {
			writer.writeSpace(false);
			this.writeAttributes(writer);
		}

		writer.write(";");
		writer.writeLine(false);
	}

	public equals(other: Declaration): boolean {
		if (!(other instanceof Function)) {
			return false;
		}

		if (this.getName() !== other.getName()) {
			return false;
		}

		if (!this.typeParametersEquals(other)) {
			return false;
		}

		if (this.parameters.length !== other.parameters.length) {
			return false;
		}

		for (let i = 0; i < this.parameters.length; i++) {
			if (!this.parameters[i].getType().equals(other.parameters[i].getType())) {
				return false;
			}
		}

		return true;
	}
}
