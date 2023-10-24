import { Declaration, TemplateDeclaration } from "./declaration.js";
import { Namespace } from "./namespace.js";
import { Type } from "./type.js";
import { State, Dependencies, ReasonKind, Dependency } from "./target.js";
import { Writer } from "./writer.js";

export class TypeAlias extends TemplateDeclaration {
	private type: Type;

	public constructor(name: string, type: Type, namespace?: Namespace) {
		super(name, namespace);
		this.type = type;
	}

	public getType(): Type {
		return this.type;
	}

	public setType(type: Type): void {
		this.type = type;
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
		this.writeTemplate(writer);
		writer.write("using");
		writer.writeSpace();
		writer.write(this.getName());
		writer.writeSpace(false);
		writer.write("=");
		writer.writeSpace(false);
		this.type.write(writer, namespace);
		writer.write(";");
		writer.writeLine(false);
	}

	public equals(other: Declaration): boolean {
		return other instanceof TypeAlias && this.getName() === other.getName();
	}
}
