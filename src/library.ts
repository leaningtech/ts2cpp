import { Declaration } from "./declaration/declaration.js";
import { State, Target, ResolverContext, resolveDependencies, removeDuplicateDeclarations } from "./target.js";
import { Options, StreamWriter } from "./writer.js";
import { Namespace } from "./declaration/namespace.js";
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

// A `Global` is any declaration whose definition need not be nested.
//
// Examples of globals:
// - freestanding functions
// - extern variables
// - all classes
//
// Note that even a nested class is considered global, because its definition
// *can* appear outside of its parent class:
// ```
// class Parent {
//     class Inner;
// };
// class Parent::Inner {};
// ```
//
// Examples of non-globals:
// - instance methods
// - static methods
// - class variables
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

// A `Library` is a collection of declarations that will be written to one or
// more `File`s.
export class Library {
	// The files that are part of this library.
	private readonly files: Map<string, File> = new Map;

	// The default file, when a declaration does not belong in any specific
	// file, it will be written to the default file. When "--default-lib" is
	// set, this is a file named "cheerp/clientlib.h".
	private readonly defaultFile: File;

	// The declarations that are part of this library.
	private readonly globals: Array<Global> = new Array;

	// Global includes are added to every file.
	private readonly globalIncludes: Array<Include> = new Array;

	// A filter for which typescript files to generate declarations from. This
	// is especially useful when generating headers from custom typescript
	// declaration files and you want to filter out the standard library types.
	private readonly typescriptFiles: Set<string>;

	public constructor(defaultName: string, typescriptFiles: ReadonlyArray<string>) {
		this.defaultFile = new File(defaultName);
		this.typescriptFiles = new Set(typescriptFiles.map(realpath));
		this.files.set(defaultName, this.defaultFile);
	}

	public getFiles(): IterableIterator<File> {
		return this.files.values();
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
		return this.typescriptFiles.has(realpath(file));
	}

	public removeDuplicates(): void {
		this.globals.splice(0, this.globals.length, ...removeDuplicateDeclarations(this.globals));
	}

	public write(options?: Partial<Options>): void {
		new LibraryWriter(this, options).write();
	}
}

// This class is the main entry point for converting the parsed declarations
// into C++ headers. Most of the implementation is fairly straight-forward, but
// there is one tricky detail that we must handle carefully.
//
// We use the `resolveDependencies` function to ensure that all declarations
// are generated in the correct order (see comments in "src/target.ts" for more
// about how that works). `resolveDependencies` simply gives us an ordered
// stream of declarations where if we make sure they appear in that order then
// everything will be fine. But we may have more than one file, and when
// writing the dependencies of a declaration in a different file than the
// declaration itself then we cannot be sure that they appear in the correct
// order.
//
// For example, `Object` in "cheerp/jsobject.h" depends on the forward
// declaration of `String`, but `String` belongs in "cheerp/types.h", which is
// not included from "cheerp/jsobject.h".
//
// Let's say we modify the dependency resolver to include information about
// *where* a declaration is needed, so that we can correctly forward declare
// `String` in "cheerp/jsobject.h". This still does not solve the issue because
// the dependency resolver is designed to only ever output a declaration once.
//
// For example, `Array` in "cheerp/types.h" also depends on the forward
// declaration of `String`, the modified dependency resolver would tell us that
// `String` needs to be forward declared because of a declaration in
// "cheerp/types.h" and so the forward declaration is also generated in
// "cheerp/types.h". Now when we get to the generation of `Object`, the
// dependency resolver will see that `String` has already been forward
// declared, and `Object` will not compile because we lack a declaration of
// `String` in "cheerp/jsobject.h".
//
// Another attempt might involve tracking dependency resolution for each file
// separately. This would not only require a big change in the code, but it
// also comes with its own issues. For example, there must still be some shared
// state when tracking dependencies in separate files, otherwise we risk
// duplicating the same complete declaration in multiple files. Also we might
// unecessarily forward declare a class in one file even though it was already
// forward declared in a file that we include.
//
// There is a better way!!!
//
// Even though we have multiple files, these files themselves have an order to
// them. We reorder declarations so that those in included files are generated
// before the file that includes them. This way, we never encounter the
// example above where `Array` is generated before `Object`, because
// "cheerp/types.h" includes "cheerp/jsobject" and so all declarations in
// "cheerp/jsobject.h" must be generated first. We must still pass all
// declarations to `resolveDependencies` in one go, this is a requirement for
// it to properly generate forward declarations when needed.
//
// So we order files so that included files appear before the files that
// include them, then we sort all declarations such that they match the order
// of the files. `resolveDependencies` gives us back a stream of declarations.
// We start by writing all declarations to the first file in the order, until
// that file has all declarations that belong there, at which point we move on
// to the next file, and so on.
//
// Because the order of declarations passed to `resolveDependencies` matches
// that of the files, and because `resolveDependencies` will only reorder
// declarations when it needs to, and because we move on to the next file
// immediately after a file has all the declarations it needs, declarations
// will still (mostly) appear in the file that they belong in. The only case
// where a declaration might appear in the wrong file is when it absolutely
// needed to be moved there as not to cause dependency errors.
//
// While quite fragile, this solution works, is fast, and does not require many
// changes to existing code.
export class LibraryWriter {
	private readonly library: Library;

	// Which writer should we prefer when writing a declaration? Not that
	// because of the algorithm explained above, this does not always match the
	// writer that we will actually use.
	private readonly writerMap: Map<Declaration, FileWriter> = new Map;

	// A `FileWriter` for every file in the library, these are ordered such
	// that included files appear before the file that includes them.
	private readonly writers: Array<FileWriter> = new Array;

	// All declarations in the library, these are sorted to match the order of
	// the file writers.
	private readonly globals: Array<Global> = new Array;

	// The default writer to use when a declaration does not have a specific
	// file assigned.
	private defaultWriter?: FileWriter;

	public constructor(library: Library, options?: Partial<Options>) {
		this.library = library;
		this.globals = [...library.getGlobals()];

		// 1. Add all the files.
		for (const file of library.getFiles()) {
			this.addFile(file, options);
		}
		
		// 2. Sort declarations to match the files.
		this.globals.sort((a, b) => {
			const aIdx = this.writers.indexOf(this.getWriter(a));
			const bIdx = this.writers.indexOf(this.getWriter(b));
			return aIdx - bIdx;
		});

		// 3. Count how many declarations each file has.
		for (const global of this.globals) {
			this.getWriter(global).incrementTarget();
		}
	}

	private addFile(file: File, options?: Partial<Options>): void {
		if (!this.writers.some(writer => writer.getFile() === file)) {
			// 1. Add all included files first, this order is important for the
			// algorithm explained above.
			for (const include of file.getIncludes()) {
				const includeFile = include.getFile();

				if (includeFile) {
					this.addFile(includeFile, options);
				}
			}

			if (!this.writers.some(writer => writer.getFile() === file)) {
				// 2. Add the writer.
				const writer = new StreamWriter(file.getName(), options);
				const fileWriter = new FileWriter(file, writer);
				this.writers.push(fileWriter);

				// 3. Update the preferred writer map with all declarations.
				for (const declaration of file.getDeclarations()) {
					this.writerMap.set(declaration, fileWriter);
				}

				// 4. If this is the default file, set `defaultWriter`.
				if (file === this.library.getDefaultFile()) {
					this.defaultWriter = fileWriter;
				}
			}
		}
	}

	// Returns the preferred writer for a declaration, or the `defaultWriter`
	// if there is no preference.
	private getWriter(global: Global): FileWriter {
		return this.writerMap.get(global.getDeclaration()) ?? this.defaultWriter!;
	}

	public write() {
		let index = 0;

		// 1. Start by writing include guards and file includes for every file
		// in the library.
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

		// 2. Write all of the declarations.
		resolveDependencies(new ResolverContext, this.globals, (context, global, state) => {
			// 2.1. If this file is done, move on to the next one.
			while (this.writers[index].isDone()) {
				index += 1;
			}

			const fileWriter = this.writers[index];
			const declaration = global.getDeclaration();
			const namespace = declaration.getNamespace();
			const file = declaration.getFile();

			// 2.2. Actually write the declaration, unless it's been filtered.
			if (!file || this.library.hasFile(file)) {
				fileWriter.setNamespace(namespace);
				declaration.write(context, fileWriter.getWriter(), state, namespace);
			}

			// 2.3. Decrement the number of declarations that are still to be
			// generated for the file in which this declaration belongs.
			if (state >= global.getTargetState()) {
				this.getWriter(global).decrementTarget();
			}
		});

		// 3. Finish up by closing any open namespaces and closing the include
		// guard.
		for (const fileWriter of this.writers) {
			const writer = fileWriter.getWriter();
			fileWriter.setNamespace(undefined);
			writer.writeLineStart();
			writer.write("#endif");
			writer.writeLine();
		}
	}
}
