import { Declaration } from "./declaration.js";
import { Namespace, Flags } from "./namespace.js";
import { State, Dependency, Dependencies, ReasonKind } from "./target.js";
import { Type } from "./type.js";
import { Writer } from "./writer.js";

export class Variable extends Declaration {
	private type: Type;

	public constructor(name: string, type: Type, namespace?: Namespace) {
		super(name, namespace);
		this.type = type;
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
			this.type.getDeclarations()
				.filter((declaration): declaration is Declaration => !!declaration)
				.map(declaration => [declaration, new Dependency(State.Partial, this, ReasonKind.VariableType)])
		);
	}

	public getDirectNamedTypes(): ReadonlySet<string> {
		return this.type.getNamedTypes();
	}

	public write(writer: Writer, state: State, namespace?: Namespace): void {
		const flags = this.getFlags();

		if (flags & Flags.Extern) {
			writer.write("extern");
			writer.writeSpace();
		}

		if (flags & Flags.Static) {
			writer.write("static");
			writer.writeSpace();
		}

		this.type.write(writer, namespace);
		writer.writeSpace();
		writer.write(this.getName());
		writer.write(";");
		writer.writeLine(false);
	}

	public equals(other: Declaration): boolean {
		return other instanceof Variable && this.getName() === other.getName();
	}
}
