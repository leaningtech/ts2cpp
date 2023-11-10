import { Declaration, TemplateDeclaration } from "./declaration.js";
import { Namespace, Flags } from "./namespace.js";
import { State, Dependency, Dependencies, ReasonKind } from "./target.js";
import { Writer } from "./writer.js";
import { Type } from "./type.js";

export class Parameter {
	private readonly type: Type;
	private readonly name: string;
	private readonly defaultValue?: string;

	public constructor(type: Type, name: string, defaultValue?: string) {
		this.type = type;
		this.name = name;
		this.defaultValue = defaultValue;
	}

	public getType(): Type {
		return this.type;
	}

	public getName(): string {
		return this.name;
	}

	public getDefaultValue(): string | undefined {
		return this.defaultValue;
	}
}

export class Initializer {
	private readonly name: string;
	private readonly value: string;

	public constructor(name: string, value: string) {
		this.name = name;
		this.value = value;
	}

	public getName(): string {
		return this.name;
	}

	public getValue(): string {
		return this.value;
	}
}

export class Function extends TemplateDeclaration {
	private readonly parameters: Array<Parameter> = new Array;
	private readonly initializers: Array<Initializer> = new Array;
	private type?: Type;
	private body?: string;

	public constructor(name: string, type?: Type, namespace?: Namespace) {
		super(name, namespace);
		this.type = type;
	}

	public getParameters(): ReadonlyArray<Parameter> {
		return this.parameters;
	}

	public addParameter(type: Type, name: string, defaultValue?: string): void {
		this.parameters.push(new Parameter(type, name, defaultValue));
	}

	public getInitializers(): ReadonlyArray<Initializer> {
		return this.initializers;
	}

	public addInitializer(name: string, value: string): void {
		this.initializers.push(new Initializer(name, value));
	}

	public getType(): Type | undefined {
		return this.type;
	}

	public setType(type: Type | undefined): void {
		this.type = type;
	}

	public getBody(): string | undefined {
		return this.body;
	}

	public setBody(body: string): void {
		this.body = body;
	}

	public maxState(): State {
		return State.Partial;
	}

	public getChildren(): ReadonlyArray<Declaration> {
		return new Array;
	}

	public getDirectDependencies(state: State): Dependencies {
		const parameterReason = new Dependency(State.Partial, this, ReasonKind.ParameterType);
		const returnReason = new Dependency(State.Partial, this, ReasonKind.ReturnType);

		return new Dependencies(
			this.parameters
				.flatMap(parameter => [...parameter.getType().getDependencies(parameterReason)])
				.concat([...this.type?.getDependencies(returnReason) ?? []])
		);
	}

	public getDirectNamedTypes(): ReadonlySet<string> {
		return new Set(
			this.parameters
				.flatMap(parameter => [...parameter.getType().getNamedTypes()])
				.concat([...this.type?.getNamedTypes() ?? []])
		);
	}

	public write(writer: Writer, state: State, namespace?: Namespace): void {
		const flags = this.getFlags();
		let first = true;
		this.writeTemplate(writer);
		this.writeInterfaceName(writer);

		if (flags & Flags.Explicit) {
			writer.write("explicit");
			writer.writeSpace();
		}

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
			const defaultValue = parameter.getDefaultValue();

			if (!first) {
				writer.write(",");
				writer.writeSpace(false);
			}

			parameter.getType().write(writer, namespace);
			writer.writeSpace();
			writer.write(parameter.getName());

			if (defaultValue) {
				writer.writeSpace(false);
				writer.write("=");
				writer.writeSpace(false);
				writer.write(defaultValue);
			}

			first = false;
		}

		writer.write(")");

		if (flags & Flags.Const) {
			writer.writeSpace(false);
			writer.write("const");
		}

		if (this.getAttributes().length > 0) {
			writer.writeSpace(false);
			this.writeAttributes(writer);
		}

		first = true;

		for (const initializer of this.initializers) {
			writer.write(first ? ":" : ",");
			writer.writeSpace(false);
			writer.write(initializer.getName());
			writer.write("(");
			writer.write(initializer.getValue());
			writer.write(")");
			first = false;
		}

		if (this.body !== undefined) {
			writer.writeBody(this.body);
		} else {
			writer.write(";");
			writer.writeLine(false);
		}
	}

	public key(): string {
		const flags = (this.getFlags() & Flags.Const) ? "C" : "M";
		const parameterKey = this.parameters
			.map(parameter => parameter.getType().key()).join("");
		return `F${flags}${this.getPath()};${this.templateKey()};${parameterKey};`;
	}
}
