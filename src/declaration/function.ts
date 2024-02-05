import { Declaration, TemplateDeclaration } from "./declaration.js";
import { Namespace, Flags } from "./namespace.js";
import { State, Dependency, Dependencies, ReasonKind, ResolverContext } from "../target.js";
import { Writer } from "../writer.js";
import { Type } from "../type/type.js";

export class Parameter {
	private type: Type;
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

	public setType(type: Type): void {
		this.type = type;
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
	// Function parameters.
	private parameters?: Array<Parameter>;

	// Constructor initializers, mostly used for extensions in
	// "src/extensions.ts".
	private initializers?: Array<Initializer>;

	// We can't track dependencies of the function body, they must be added
	// manually using `addExtraDependency`.
	private extraDependencies?: Dependencies;

	// The return type.
	private type?: Type;

	// The function body. This is mostly used for extensions in
	// "src/extensions.ts", but also for some automatically generated
	// forwarding helper functions.
	private body?: string;

	public constructor(name: string, type?: Type, namespace?: Namespace) {
		super(name, namespace);
		this.type = type;
	}

	public getParameters(): ReadonlyArray<Parameter> {
		return this.parameters ?? [];
	}

	public addParameter(type: Type, name: string, defaultValue?: string): void {
		this.parameters ??= [];
		this.parameters.push(new Parameter(type, name, defaultValue));
	}

	public getInitializers(): ReadonlyArray<Initializer> {
		return this.initializers ?? [];
	}

	public addInitializer(name: string, value: string): void {
		this.initializers ??= [];
		this.initializers.push(new Initializer(name, value));
	}

	public getExtraDependencies(): Dependencies {
		return this.extraDependencies ?? new Dependencies;
	}

	public addExtraDependency(declaration: Declaration, state: State, reason: ReasonKind = ReasonKind.Extra): void {
		this.extraDependencies ??= new Dependencies;
		this.extraDependencies.add(declaration, new Dependency(state, this, reason));
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

	// The dependencies of a function are:
	// - partial for types used in function parameters.
	// - partial for the return type.
	// - extra dependencies added using `addExtraDependency`.
	public getDirectDependencies(state: State): Dependencies {
		const parameterReason = new Dependency(State.Partial, this, ReasonKind.ParameterType);
		const returnReason = new Dependency(State.Partial, this, ReasonKind.ReturnType);

		return new Dependencies(
			this.getParameters()
				.flatMap(parameter => [...parameter.getType().getDependencies(parameterReason)])
				.concat([...this.type?.getDependencies(returnReason) ?? []])
				.concat([...this.extraDependencies ?? []])
		);
	}

	public getDirectReferencedTypes(): ReadonlyArray<Type> {
		return this.getParameters()
			.flatMap(parameter => [...parameter.getType().getReferencedTypes()])
			.concat([...this.type?.getReferencedTypes() ?? []]);
	}

	public write(context: ResolverContext, writer: Writer, state: State, namespace?: Namespace): void {
		// 1. Write the template<...> line, if needed.
		this.writeTemplate(writer);

		// 2. Write the interface name attribute, unless there is a body.
		if (this.body === undefined) {
			this.writeInterfaceName(writer);
		}

		// 3. Write attributes.
		if (this.getAttributes().length > 0) {
			this.writeAttributes(writer);
			writer.writeLine(false);
		}

		// 4. Write modifiers, except const.
		const flags = this.getFlags();

		if (flags & Flags.Explicit) {
			writer.write("explicit");
			writer.writeSpace();
		}

		if (flags & Flags.Static) {
			writer.write("static");
			writer.writeSpace();
		}

		if (flags & Flags.Inline) {
			writer.write("inline");
			writer.writeSpace();
		}

		// 5. Write return type.
		if (this.type) {
			this.type.write(writer, namespace);
			writer.writeSpace();
		}

		// 6. Write function name.
		writer.write(this.getName());
		writer.write("(");

		let first = true;

		// 7. Write function parameters
		for (const parameter of this.getParameters()) {
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

		// 8. Write const modifier.
		if (flags & Flags.Const) {
			writer.writeSpace(false);
			writer.write("const");
		}

		first = true;

		// 9. Write constructor initializers.
		for (const initializer of this.getInitializers()) {
			writer.write(first ? ":" : ",");
			writer.writeSpace(false);
			writer.write(initializer.getName());
			writer.write("(");
			writer.write(initializer.getValue());
			writer.write(")");
			first = false;
		}

		// 10. Write body, if present.
		if (this.body !== undefined) {
			writer.writeBody(this.body);
		} else {
			writer.write(";");
			writer.writeLine(false);
		}
	}

	public key(): string {
		const flags = (this.getFlags() & Flags.Const) ? "C" : "M";
		const parameterKey = this.getParameters()
			.map(parameter => parameter.getType().key()).join("");
		return `F${flags}${this.getPath()};${this.templateKey()};${parameterKey};`;
	}
}
