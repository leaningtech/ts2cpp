import { Declaration } from "./declaration.js";
import { TemplateDeclaration } from "./templateDeclaration.js";
import { Namespace } from "./namespace.js";
import { Type } from "../type/type.js";
import { State, Dependencies, ReasonKind, Dependency, ResolverContext } from "../target.js";
import { Writer } from "../writer.js";

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

	// The dependencies of a type alias are:
	// - partial for the target type.
	public getDirectDependencies(state: State): Dependencies {
		return this.type.getDependencies(new Dependency(State.Partial, this, ReasonKind.TypeAliasType));
	}

	public getDirectReferencedTypes(): ReadonlyArray<Type> {
		return this.type.getReferencedTypes();
	}

	public write(context: ResolverContext, writer: Writer, state: State, namespace?: Namespace): void {
		this.writeTemplate(writer, namespace);
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
}
