import { Declaration } from "./declaration.js";
import { State, Target, resolveDependencies, removeDuplicates } from "./target.js";
import { Options, Writer } from "./writer.js";
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
	private readonly names: Array<string> = new Array;

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

	public getNames(): ReadonlyArray<string> {
		return this.names;
	}

	public addName(name: string): void {
		this.names.push(name);
	}
}

export class FileWriter {
	private readonly file: File;
	private readonly writer: Writer;
	private namespace?: Namespace;
	private targetCount: number = 0;
	private resolveCount: number = 0;

	public constructor(file: File, writer: Writer) {
		this.file = file;
		this.writer = writer;
	}

	public getFile(): File {
		return this.file;
	}

	public getWriter(): Writer {
		return this.writer;
	}

	public incrementTarget(): void {
		this.targetCount += 1;
	}

	public incrementResolve(): void {
		this.resolveCount += 1;
	}

	public isDone(): boolean {
		return this.resolveCount >= this.targetCount;
	}

	public writeNamespaceChange(namespace?: Namespace): void {
		Namespace.writeChange(this.writer, this.namespace, namespace);
		this.namespace = namespace;
	}
}

export class Library {
	private readonly files: Map<string, File> = new Map;
	private defaultFile: File;
	private readonly globals: Array<Global> = new Array;
	private globalIncludes: Array<Include> = new Array;

	public constructor(defaultName: string) {
		this.defaultFile = new File(defaultName);
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

	public removeDuplicates(): void {
		this.globals.splice(0, this.globals.length, ...removeDuplicates(this.globals));
	}

	private static getFileOrder(files: Array<File>, file: File): void {
		if (!files.includes(file)) {
			for (const include of file.getIncludes()) {
				const includeFile = include.getFile();

				if (includeFile) {
					Library.getFileOrder(files, includeFile);
				}
			}

			if (!files.includes(file)) {
				files.push(file);
			}
		}
	}

	public write(options?: Partial<Options>): void {
		new LibraryWriter(this, options).write();
	}
}

export class LibraryWriter {
	private readonly library: Library;
	private readonly writerMap: Map<string, FileWriter> = new Map;
	private readonly writers: Array<FileWriter> = new Array;
	private readonly defaultWriter: FileWriter;
	private readonly globals: Array<Global> = new Array;
	private readonly fileOrder: Array<File> = new Array;

	public constructor(library: Library, options?: Partial<Options>) {
		const defaultFile = library.getDefaultFile();
		let defaultWriter: FileWriter | undefined;

		for (const [name, file] of library.getFiles()) {
			const writer = new Writer(name, options);
			const fileWriter = new FileWriter(file, writer);
			this.writers.push(fileWriter);

			for (const declarationName of file.getNames()) {
				this.writerMap.set(declarationName, fileWriter);
			}

			if (file === defaultFile) {
				defaultWriter = fileWriter;
			}
		}

		this.library = library;
		this.defaultWriter = defaultWriter!;
		this.globals = [...library.getGlobals()];

		for (const [name, file] of library.getFiles()) {
			this.computeFileOrder(file);
		}

		this.writers.sort((a, b) => {
			const aIdx = this.fileOrder.indexOf(a.getFile());
			const bIdx = this.fileOrder.indexOf(b.getFile());
			return aIdx - bIdx;
		});

		this.globals.sort((a, b) => {
			const aIdx = this.fileOrder.indexOf(this.getWriter(a).getFile());
			const bIdx = this.fileOrder.indexOf(this.getWriter(b).getFile());
			return aIdx - bIdx;
		});

		for (const global of library.getGlobals()) {
			this.getWriter(global).incrementTarget();
		}
	}

	private computeFileOrder(file: File): void {
		if (!this.fileOrder.includes(file)) {
			for (const include of file.getIncludes()) {
				const includeFile = include.getFile();

				if (includeFile) {
					this.computeFileOrder(includeFile);
				}
			}

			if (!this.fileOrder.includes(file)) {
				this.fileOrder.push(file);
			}
		}
	}

	private getWriter(global: Global): FileWriter {
		return this.writerMap.get(global.getDeclaration().getPath()) ?? this.defaultWriter;
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

		resolveDependencies(this.globals, (global, state) => {
			while (this.writers[index].isDone()) {
				index += 1;
			}

			const fileWriter = this.writers[index];
			const declaration = global.getDeclaration();
			const namespace = declaration.getNamespace();
			fileWriter.writeNamespaceChange(namespace);
			declaration.write(fileWriter.getWriter(), state, namespace);
			
			if (state >= global.getTargetState()) {
				this.getWriter(global).incrementResolve();
			}
		});

		for (const fileWriter of this.writers) {
			const writer = fileWriter.getWriter();
			fileWriter.writeNamespaceChange(undefined);
			writer.write("#endif");
			writer.writeLine();
		}
	}
}
