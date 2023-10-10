import { Declaration, TemplateDeclaration } from "./declaration.js";
import { Namespace, Flags } from "./namespace.js";
import { State, Dependency, Dependencies, ReasonKind } from "./target.js";
import { Writer } from "./writer.js";
import { Type } from "./type.js";

export class Argument {
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
	private readonly arguments: Array<Argument> = new Array;
	private readonly type: Type;

	public constructor(name: string, type: Type, namespace?: Namespace) {
		super(name, namespace);
		this.type = type;
	}

	public getArguments(): ReadonlyArray<Argument> {
		return this.arguments;
	}

	public addArgument(type: Type, name: string): void {
		this.arguments.push(new Argument(type, name));
	}

	public getType(): Type {
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
			this.arguments
				.map(argument => [argument.getType().getDeclaration(), ReasonKind.ArgumentType])
				.concat([[this.type.getDeclaration(), ReasonKind.ReturnType]])
				.filter((declaration): declaration is [Declaration, ReasonKind] => !!declaration[0])
				.map(([declaration, reasonKind]) => [declaration, new Dependency(State.Partial, this, reasonKind)])
		);
	}

	public write(writer: Writer, state: State, namespace?: Namespace): void {
		const flags = this.getFlags();
		let first = true;

		if (flags & Flags.Static) {
			writer.write("static");
			writer.writeSpace();
		}

		writer.write(this.type.getPath(namespace));
		writer.writeSpace();
		writer.write(this.getName());
		writer.write("(");

		for (const argument of this.arguments) {
			if (!first) {
				writer.write(",");
				writer.writeSpace(false);
				first = false;
			}

			writer.write(argument.getType().getPath(namespace));
			writer.writeSpace();
			writer.write(argument.getName());
		}

		writer.write(")");

		if (this.getAttributes().length > 0) {
			writer.writeSpace(false);
			this.writeAttributes(writer);
		}

		writer.write(";");
		writer.writeLine(false);
	}
}
