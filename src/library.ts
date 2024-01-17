import { Declaration } from "./declaration.js";
import { State, Target, ResolverContext, resolveDependencies, removeDuplicates } from "./target.js";
import { Options, StreamWriter } from "./writer.js";
import { Namespace } from "./namespace.js";
import * as fs from "fs";

const REALPATH_CACHE = new Map;

function realpath(file: string): string {
	let result = REALPATH_CACHE.get(file);

	if (!result) {
		result = fs.realpathSync(file);
		REALPATH_CACHE.set(file, result);
	}

	return result;
}

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
	private readonly name: string;
	private readonly includes: Array<Include> = new Array;
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
	private namespace?: Namespace;
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

	public setNamespace(namespace?: Namespace): void {
		Namespace.writeChange(this.writer, this.namespace, namespace);
		this.namespace = namespace;
	}
}

export class Library {
	private readonly files: Map<string, File> = new Map;
	private readonly defaultFile: File;
	private readonly globals: Array<Global> = new Array;
	private readonly globalIncludes: Array<Include> = new Array;
	private readonly typescriptFiles: Array<string> = new Array;

	public constructor(defaultName: string, typescriptFiles: ReadonlyArray<string>) {
		this.defaultFile = new File(defaultName);
		this.typescriptFiles = typescriptFiles.map(realpath);
		this.files.set(defaultName, this.defaultFile);
	}

	public getFiles(): ReadonlyMap<string, File> {
		return this.files;
	}

	public getFile(name: string): File | undefined {
		return this.files.get(name);
	}

	public getDefaultFile(): File {
		return this.defaultFile;
	}

	public addFile(name: string): File {
		const file = new File(name);
		this.files.set(name, file);
		return file;
	}

	public getGlobals(): ReadonlyArray<Global> {
		return this.globals;
	}

	public addGlobal(declaration: Declaration): void {
		this.globals.push(new Global(declaration));
	}

	public getGlobalIncludes(): ReadonlyArray<Include> {
		return this.globalIncludes;
	}

	public addGlobalInclude(name: string, system: boolean, file?: File) {
		this.globalIncludes.push(new Include(name, system, file));
	}

	public hasFile(file: string): boolean {
		return this.typescriptFiles.includes(realpath(file));
	}

	public removeDuplicates(): void {
		this.globals.splice(0, this.globals.length, ...removeDuplicates(this.globals));
	}

	public write(options?: Partial<Options>): void {
		new LibraryWriter(this, options).write();
	}
}

export class LibraryWriter {
	private readonly library: Library;
	private readonly writerMap: Map<Declaration, FileWriter> = new Map;
	private readonly writers: Array<FileWriter> = new Array;
	private readonly globals: Array<Global> = new Array;
	private defaultWriter?: FileWriter;

	public constructor(library: Library, options?: Partial<Options>) {
		this.library = library;
		this.globals = [...library.getGlobals()];

		for (const [name, file] of library.getFiles()) {
			this.addFile(file);
		}
		
		this.globals.sort((a, b) => {
			const aIdx = this.writers.indexOf(this.getWriter(a));
			const bIdx = this.writers.indexOf(this.getWriter(b));
			return aIdx - bIdx;
		});

		for (const global of this.globals) {
			this.getWriter(global).incrementTarget();
		}
	}

	private addFile(file: File): void {
		if (!this.writers.some(writer => writer.getFile() === file)) {
			for (const include of file.getIncludes()) {
				const includeFile = include.getFile();

				if (includeFile) {
					this.addFile(includeFile);
				}
			}

			if (!this.writers.some(writer => writer.getFile() === file)) {
				const writer = new StreamWriter(file.getName());
				const fileWriter = new FileWriter(file, writer);
				this.writers.push(fileWriter);

				for (const declaration of file.getDeclarations()) {
					this.writerMap.set(declaration, fileWriter);
				}

				if (file === this.library.getDefaultFile()) {
					this.defaultWriter = fileWriter;
				}
			}
		}
	}

	private getWriter(global: Global): FileWriter {
		return this.writerMap.get(global.getDeclaration()) ?? this.defaultWriter!;
	}

	public write() {
		let index = 0;

		for (const fileWriter of this.writers) {
			const writer = fileWriter.getWriter();
			const file = fileWriter.getFile();
			const includes = file.getIncludes()
				.concat(this.library.getGlobalIncludes());
			const guard = file.getName()
				.replace(/[\/\.]/g, "_")
				.toUpperCase();

			writer.write("#ifndef");
			writer.writeSpace();
			writer.write(guard);
			writer.writeLine();
			writer.write("#define");
			writer.writeSpace();
			writer.write(guard);
			writer.writeLine();

			for (const include of includes) {
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
		}

		resolveDependencies(new ResolverContext, this.globals, (context, global, state) => {
			while (this.writers[index].isDone()) {
				index += 1;
			}

			const fileWriter = this.writers[index];
			const declaration = global.getDeclaration();
			const namespace = declaration.getNamespace();
			const file = declaration.getFile();
			
			if (!file || this.library.hasFile(file)) {
				fileWriter.setNamespace(namespace);
				declaration.write(context, fileWriter.getWriter(), state, namespace);
			}

			if (state >= global.getTargetState()) {
				this.getWriter(global).decrementTarget();
			}
		});

		for (const fileWriter of this.writers) {
			const writer = fileWriter.getWriter();
			fileWriter.setNamespace(undefined);
			writer.writeLineStart();
			writer.write("#endif");
			writer.writeLine();
		}
	}
}
