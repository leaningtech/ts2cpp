import { Declaration } from "./declaration/declaration.js";
import { StreamWriter } from "./writer.js";
import { Namespace } from "./declaration/namespace.js";

// A reference to a file that should be included
export class Include {
	// The name of the file, this is the exact string that will appear between
	// <> or "" in the include directive.
	private readonly name: string;

	// If the `system` flag is set, we use <> instead of ""
	private readonly system: boolean;

	// A reference to the `File` instance, only set if we are also generating
	// this file. This is used to order the generation of declarations, see the
	// comments on `LibraryWriter` for more info.
	private readonly file?: File;

	public constructor(name: string, system: boolean, file?: File) {
		this.name = name;
		this.system = system;
		this.file = file;
	}

	public getName(): string {
		return this.name;
	}

	public isSystem(): boolean {
		return this.system;
	}

	public getFile(): File | undefined {
		return this.file;
	}
}

export class File {
	// The name of the file, this is the path where it will be output to. It
	// is also used to generate the name for the include guard.
	private readonly name: string;

	// Files that need to be included.
	private readonly includes: Array<Include> = new Array;

	// A list of declarations that belong in this file.
	private readonly declarations: Array<Declaration> = new Array;

	public constructor(name: string) {
		this.name = name;
	}

	public getName(): string {
		return this.name;
	}

	public getIncludes(): ReadonlyArray<Include> {
		return this.includes;
	}

	public addInclude(name: string, system: boolean, file?: File): void {
		this.includes.push(new Include(name, system, file));
	}

	public getDeclarations(): ReadonlyArray<Declaration> {
		return this.declarations;
	}

	public addDeclaration(declaration: Declaration): void {
		this.declarations.push(declaration);
	}
}

export class FileWriter {
	private readonly file: File;
	private readonly writer: StreamWriter;

	// The namespace which the file is currently in.
	private namespace?: Namespace;

	// The number of declarations that still need to be written in this file.
	// This is used to track when to move on to the next file, see the comments
	// on `LibraryWriter` for more info.
	private target: number = 0;

	public constructor(file: File, writer: StreamWriter) {
		this.file = file;
		this.writer = writer;
	}

	public getFile(): File {
		return this.file;
	}

	public getWriter(): StreamWriter {
		return this.writer;
	}

	public incrementTarget(): void {
		this.target += 1;
	}

	public decrementTarget(): void {
		this.target -= 1;
	}

	public isDone(): boolean {
		return this.target === 0;
	}

	// `setNamespace` writes a change in namespace to the file.
	public setNamespace(namespace?: Namespace): void {
		Namespace.writeChange(this.writer, this.namespace, namespace);
		this.namespace = namespace;
	}
}
