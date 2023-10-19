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

export class Include {
	private readonly name: string;
	private readonly system: boolean;

	public constructor(name: string, system: boolean) {
		this.name = name;
		this.system = system;
	}

	public getName(): string {
		return this.name;
	}

	public isSystem(): boolean {
		return this.system;
	}
}

export class File {
	private readonly globals: Array<Global> = new Array;
	private readonly includes: Array<Include> = new Array;

	public addGlobal(declaration: Declaration): void {
		this.globals.push(new Global(declaration));
	}

	public addInclude(name: string, system: boolean) {
		this.includes.push(new Include(name, system));
	}

	public removeDuplicates(): void {
		this.globals.splice(0, this.globals.length, ...removeDuplicates(this.globals));
	}

	public write(writer: Writer): void {
		let namespace: Namespace | undefined = undefined;

		for (const include of this.includes) {
			writer.write("#include");
			writer.writeSpace(false);

			if (include.isSystem()) {
				writer.write("<");
				writer.write(include.getName());
				writer.write(">");
			} else {
				writer.write("\"");
				writer.write(include.getName());
				writer.write("\"");
			}

			writer.writeLine();
		}

		resolveDependencies(this.globals, (global, state) => {
			const newNamespace = global.getDeclaration().getNamespace();
			Namespace.writeChange(writer, namespace, newNamespace);
			namespace = newNamespace;
			global.getDeclaration().write(writer, state, namespace);
		});

		Namespace.writeChange(writer, namespace, undefined);
	}
}
