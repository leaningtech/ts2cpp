import { Namespace } from "../declaration/namespace.js";
import { Declaration } from "../declaration/declaration.js";
import { Class, Visibility } from "../declaration/class.js";
import { Function } from "../declaration/function.js";
import { Library } from "../library.js";
import { Type } from "../type/type.js";
import { NamedType } from "../type/namedType.js";
import { DeclaredType } from "../type/declaredType.js";
import { TypeInfo } from "./typeInfo.js";
import { withTimer, options } from "../utility.js";
import { addExtensions } from "../extensions.js";
import { Node, Child } from "./node.js";
import { TypeParser } from "./typeParser.js";
import { Generics } from "./generics.js";
import { parseLibrary } from "./library.js";
import * as ts from "typescript";

// `Parser` is the big class that stores all the information about a program
// as it is being parsed. This class is only used to store information and
// state of the parser, and the functions only get or update this state. This
// class does no parsing by itself.
export class Parser {
	// The typescript program.
	private readonly program: ts.Program;

	// Typescript TypeChecker instance from the above program.
	private readonly typeChecker: ts.TypeChecker;

	// All parsed declarations are stored in this `Library` instance.
	private readonly library: Library;

	// The root node where yet unparsed typescript declarations are stored.
	// See "src/parser/node.ts" for more info.
	private readonly root: Node = new Node;

	// The root namespace.
	private readonly namespace?: Namespace;

	// A map of basic and generic declared types, used by `TypeParser` to look
	// up type information when parsing, for example, function return types.
	private readonly basicDeclaredTypes: Map<ts.Type, DeclaredType> = new Map;
	private readonly genericDeclaredTypes: Map<ts.Type, DeclaredType> = new Map;

	// Lists of all class and function declarations. These are used after the
	// main parsing is done to run secondary passes on all classes and
	// functions. For example, to mark virtual base classes, or to remove
	// duplicate declarations.
	private readonly classes: Array<Class> = new Array;
	private readonly functions: Array<Function> = new Array;

	// Primitive progress counters.
	private target: number = 0;
	private progress: number = 0;

	public constructor(program: ts.Program, library: Library) {
		this.program = program;
		this.typeChecker = program.getTypeChecker();
		this.library = library;
		this.namespace = new Namespace("client");
		this.namespace.addAttribute("cheerp::genericjs");
	}

	public run(defaultLib: boolean): void {
		// 1. Populate the `Node` tree `root` with typescript declarations. See
		// "src/parser/node.ts" for a detailed description of why and how.
		withTimer("discover", () => {
			this.program.getSourceFiles().forEach(sourceFile => this.root.discover(this, sourceFile));
		});

		// 2. Convert the typescript declarations in the `Node` tree into C++
		// declarations, the resulting declarations are stored in `library`.
		withTimer("generate", () => {
			if (options.namespace) {
				parseLibrary(this, this.root, new Namespace(options.namespace, this.namespace));
			} else {
				parseLibrary(this, this.root, this.namespace);
			}
		});

		// 3. Remove duplicate declarations.
		withTimer("remove duplicates", () => {
			this.library.removeDuplicates();
			this.classes.forEach(declaration => declaration.removeDuplicates());
		});

		// 4. Add extensions, if this is the default library.
		if (defaultLib) {
			addExtensions(this);
		}

		// 5. Compute virtual base classes.
		withTimer("compute virtual base classes", () => {
			this.classes.forEach(declaration => declaration.computeVirtualBaseClasses());
		});

		// 6. Add `using` declarations for base members that require them.
		withTimer("use base members", () => {
			this.classes.forEach(declaration => declaration.useBaseMembers());
		});

		// 7. Add `cheerp::client_layout` attribute to the `Object` class.
		const objectClass = this.getRootClass("Object");

		if (objectClass) {
			objectClass.addAttribute("cheerp::client_layout");
		}
	}

	public getTypeAtLocation(node: ts.Node): ts.Type {
		return this.typeChecker.getTypeAtLocation(node);
	}

	public getTypeFromTypeNode(node: ts.TypeNode): ts.Type {
		return this.typeChecker.getTypeFromTypeNode(node);
	}

	public getTypeArguments(typeReference: ts.TypeReference): ReadonlyArray<ts.Type> {
		return this.typeChecker.getTypeArguments(typeReference);
	}

	public getLibrary(): Library {
		return this.library;
	}

	public getClasses(): ReadonlyArray<Class> {
		return this.classes;
	}

	public getFunctions(): ReadonlyArray<Function> {
		return this.functions;
	}

	public getRootNode(): Node {
		return this.root;
	}

	public getRootNamespace(): Namespace | undefined {
		return this.namespace;
	}

	// A quick and dirty way to get the non-generic version of a class in
	// global scope. This is mostly used in "src/extensions.ts", to modify
	// specific classes that are known to exist.
	public getRootClass(name: string): Class | undefined {
		return this.root.getChild(name)?.basicClass;
	}

	// A quick and dirty way to get the generic version of a class in
	// global scope. This is mostly used in "src/extensions.ts", to modify
	// specific classes that are known to exist.
	public getGenericRootClass(name: string): Class | undefined {
		return this.root.getChild(name)?.genericClass;
	}

	// A quick and dirty way to get a non-generic type in global scope. This is
	// used in "src/extensions.ts" and "src/parser/typeParser.ts" to obtain a
	// reference to a specific class type that is known to exist.
	public getRootType(name: string): Type {
		const declaration = this.getRootClass(name);

		if (declaration) {
			return DeclaredType.create(declaration);
		} else {
			return NamedType.create(`client::${name}`);
		}
	}

	// A quick and dirty way to get a generic type in global scope. This is
	// used in "src/extensions.ts" and "src/parser/typeParser.ts" to obtain a
	// reference to a specific class type that is known to exist.
	public getGenericRootType(name: string): Type {
		const declaration = this.getGenericRootClass(name);

		if (declaration) {
			return DeclaredType.create(declaration);
		} else {
			return NamedType.create(`client::T${name}`);
		}
	}

	public addBasicDeclaredClass(type: ts.Type, declaredType: DeclaredType): void {
		this.basicDeclaredTypes.set(type, declaredType);
	}

	public addGenericDeclaredClass(type: ts.Type, declaredType: DeclaredType): void {
		this.genericDeclaredTypes.set(type, declaredType);
	}

	public getBasicDeclaredClass(type: ts.Type): DeclaredType | undefined {
		return this.basicDeclaredTypes.get(type);
	}

	public getGenericDeclaredClass(type: ts.Type): DeclaredType | undefined {
		return this.genericDeclaredTypes.get(type);
	}

	// Check if a typescript node is to be included in the output file. This
	// check is used to prune declarations from files that are included
	// indirectly but whose declarations we do not want to emit.
	public includesDeclaration(node: ts.Node): boolean {
		return this.library.hasFile(node.getSourceFile().fileName);
	}

	public getTypeInfo(type: ts.Type, generics: Generics): TypeInfo {
		return new TypeParser(this, generics.getTypes()).getInfo(type);
	}

	public getTypeNodeInfo(node: ts.TypeNode | undefined, generics: Generics): TypeInfo {
		return new TypeParser(this, generics.getTypes()).getNodeInfo(node);
	}

	public getSymbol(type: ts.Type, generics: Generics): [ts.Symbol | undefined, Map<ts.Type, TypeInfo>] {
		return new TypeParser(this, generics.getTypes()).getSymbol(type);
	}

	public incrementTarget(count: number): void {
		this.target += count;
	}

	public incrementProgress(child: Child): void {
		this.progress += 1;

		// Output some progress information in verbose mode.
		if (options.isVerboseProgress) {
			console.log(`${this.progress}/${this.target} ${child.getName()}`);
		}
	}

	public registerDeclaration(declaration: Declaration): void {
		if (declaration instanceof Class) {
			this.classes.push(declaration)
		} else if (declaration instanceof Function) {
			this.functions.push(declaration);
		}
	}

	// Instead of manually adding a declaration to the library or parent class,
	// `addDeclaration` should be called for every declaration. This function
	// does a few things:
	// - Update the parent of the declaration.
	// - If the parent is a class, add the declaration as a member of the class
	//   with public visibility.
	// - If the parent is a namespace, or if the declaration is itself a class,
	//   add the global declaration to the *library*. Inner classes are also
	//   added as global declarations so their complete definitions may appear
	//   outside of their parent class, eg. as `class Foo::Bar {};`.
	// - If the declaration is a class in global scope, compute its references.
	//   Computing the references of the global class will also recursive
	//   compute references of all inner classes inside of it.
	// - Register the declaration using `registerDeclaration`.
	public addDeclaration(declaration: Declaration, parent?: Namespace): void {
		declaration.setParent(parent);

		if (parent instanceof Class) {
			if (declaration instanceof Class) {
				this.library.addGlobal(declaration);
			}

			parent.addMember(declaration, Visibility.Public);
		} else {
			if (declaration instanceof Class) {
				declaration.computeReferences();
			}
			
			this.library.addGlobal(declaration);
		}

		this.registerDeclaration(declaration);
	}
}
