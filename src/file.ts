import { Declaration } from "./declaration.js";
import { State, Target, resolveDependencies, removeDuplicates } from "./target.js";
import { Writer } from "./writer.js";
import { Namespace } from "./namespace.js";

export class Global implements Target {
	private readonly declaration: Declaration;

	public constructor(declaration: Declaration) {
		this.declaration = declaration;
	}

	public getDeclaration(): Declaration {
		return this.declaration;
	}

	public getTargetState(): State {
		return this.declaration.maxState();
	}
}

export class File {
	private readonly globals: Array<Global> = new Array;

	public addGlobal(declaration: Declaration): void {
		this.globals.push(new Global(declaration));
	}

	public removeDuplicates(): void {
		this.globals.splice(0, this.globals.length, ...removeDuplicates(this.globals));
	}

	public write(writer: Writer): void {
		let namespace: Namespace | undefined = undefined;

		resolveDependencies(this.globals, (global, state) => {
			const newNamespace = global.getDeclaration().getNamespace();
			Namespace.writeChange(writer, namespace, newNamespace);
			namespace = newNamespace;
			global.getDeclaration().write(writer, state, namespace);
		});

		Namespace.writeChange(writer, namespace, undefined);
	}
}
