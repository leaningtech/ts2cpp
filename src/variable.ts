import { Declaration } from "./declaration.js";
import { Namespace, Flags } from "./namespace.js";
import { State, Dependencies } from "./target.js";
import { Type } from "./type.js";
import { Writer } from "./writer.js";

export class Variable extends Declaration {
	private readonly type: Type;

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
			[this.type.getDeclaration()]
				.filter((declaration): declaration is Declaration => !!declaration)
				.map(declaration => [declaration, State.Partial])
		);
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

		writer.write(this.type.getPath(namespace));
		writer.writeSpace();
		writer.write(this.getName());
		writer.write(";");
		writer.writeLine(false);
	}
}
