import { Namespace } from "../declaration/namespace.js";
import { Declaration } from "../declaration/declaration.js";
import { Class, Visibility } from "../declaration/class.js";
import { Function } from "../declaration/function.js";
import { Library } from "../library.js";
import { Type } from "../type/type.js";
import { NamedType, ANY_TYPE } from "../type/namedType.js";
import { DeclaredType } from "../type/declaredType.js";
import { TemplateType } from "../type/templateType.js";
import { TypeInfo } from "./typeInfo.js";
import { withTimer, options } from "../utility.js";
import { addExtensions } from "../extensions.js";
import { Node, Child } from "./node.js";
import { TypeParser } from "./typeParser.js";
import { Generics } from "./generics.js";
import { parseLibrary } from "./library.js";
import * as ts from "typescript";

export class Parser {
	private readonly program: ts.Program;
	private readonly typeChecker: ts.TypeChecker;
	private readonly library: Library;
	private readonly root: Node = new Node;
	private readonly namespace?: Namespace;
	private readonly basicDeclaredTypes: Map<ts.Type, DeclaredType> = new Map;
	private readonly genericDeclaredTypes: Map<ts.Type, DeclaredType> = new Map;
	private readonly classes: Array<Class> = new Array;
	private readonly functions: Array<Function> = new Array;
	private target: number = 0;
	private progress: number = 0;

	public constructor(program: ts.Program, library: Library) {
		this.program = program;
		this.typeChecker = program.getTypeChecker();
		this.library = library;
		this.library.addGlobalInclude("type_traits", true);
		this.namespace = new Namespace("client");
		this.namespace.addAttribute("cheerp::genericjs");
	}

	public run(defaultLib: boolean): void {
		withTimer("discover", () => {
			this.program.getSourceFiles().forEach(sourceFile => this.root.discover(this, sourceFile));
		});

		withTimer("generate", () => {
			if (options.namespace) {
				parseLibrary(this, this.root, new Namespace(options.namespace, this.namespace));
			} else {
				parseLibrary(this, this.root, this.namespace);
			}
		});

		withTimer("remove duplicates", () => {
			this.library.removeDuplicates();
			this.classes.forEach(declaration => declaration.removeDuplicates());
		});

		if (defaultLib) {
			addExtensions(this);
		}

		withTimer("compute virtual base classes", () => {
			this.classes.forEach(declaration => declaration.computeVirtualBaseClasses());
		});

		withTimer("use base members", () => {
			this.classes.forEach(declaration => declaration.useBaseMembers());
		});

		const objectClass = this.getRootClass("Object");

		if (objectClass) {
			objectClass.addAttribute("cheerp::client_layout");
		}

		const parameterTypesMap = new Map;
		const basicArray = this.getRootClass("Array");
		const genericArray = this.getGenericRootClass("Array");
		const basicMap = this.getRootClass("Map");
		const genericMap = this.getGenericRootClass("Map");

		if (basicArray && genericArray) {
			const anyArray = TemplateType.create(DeclaredType.create(genericArray), ANY_TYPE.pointer());
			parameterTypesMap.set(anyArray.pointer(), DeclaredType.create(basicArray).pointer());
			parameterTypesMap.set(anyArray.constPointer(), DeclaredType.create(basicArray).constPointer());
		}

		if (basicMap && genericMap) {
			const anyMap = TemplateType.create(DeclaredType.create(genericMap), ANY_TYPE.pointer(), ANY_TYPE.pointer());
			parameterTypesMap.set(anyMap.pointer(), DeclaredType.create(basicMap).pointer());
			parameterTypesMap.set(anyMap.constPointer(), DeclaredType.create(basicMap).constPointer());
		}

		withTimer("rewrite parameter types", () => {
			this.functions.forEach(declaration => declaration.rewriteParameterTypes(parameterTypesMap));
		});
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

	public getRootClass(name: string): Class | undefined {
		return this.root.getChild(name)?.basicClass;
	}

	public getGenericRootClass(name: string): Class | undefined {
		return this.root.getChild(name)?.genericClass;
	}

	public getRootType(name: string): Type {
		const declaration = this.getRootClass(name);

		if (declaration) {
			return DeclaredType.create(declaration);
		} else {
			return NamedType.create(`client::${name}`);
		}
	}

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

	public includesDeclaration(node: ts.Node): boolean {
		return this.library.hasFile(node.getSourceFile().fileName);
	}

	public getTypeInfo(type: ts.Type, generics: Generics): TypeInfo {
		return new TypeParser(this, generics.getTypes()).getInfo(type);
	}

	public getTypeNodeInfo(node: ts.TypeNode | undefined, generics: Generics): TypeInfo {
		return new TypeParser(this, generics.getTypes()).getNodeInfo(node);
	}

	public getSymbol(type: ts.Type, generics: Generics): [ts.Symbol | undefined, Map<ts.Type, Type>] {
		return new TypeParser(this, generics.getTypes()).getSymbol(type);
	}

	public incrementTarget(count: number): void {
		this.target += count;
	}

	public incrementProgress(child: Child): void {
		this.progress += 1;

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
