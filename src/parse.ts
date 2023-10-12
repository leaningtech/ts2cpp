import * as ts from "typescript";
import { File } from "./file.js";
import { Class, Visibility } from "./class.js";
import { Namespace, Flags } from "./namespace.js";
import { Variable } from "./variable.js";
import { Function } from "./function.js";
import { Type, FakeType, DeclaredType } from "./type.js";
import { TemplateDeclaration } from "./declaration.js";

class Node {
	private readonly parent?: Node;
	private readonly children: Map<string, Node> = new Map;
	private readonly interfaceDeclarations: Array<[ts.SourceFile, ts.InterfaceDeclaration]> = new Array;
	private functionDeclaration?: [ts.SourceFile, ts.FunctionDeclaration];
	private variableDeclaration?: [ts.SourceFile, ts.VariableDeclaration];
	private classObject?: Class;

	public constructor(parent?: Node) {
		this.parent = parent;
	}

	public getParent(): Node | undefined {
		return this.parent;
	}
	
	public getChild(name: string): Node {
		let node = this.children.get(name);

		if (!node) {
			node = new Node(this);
			this.children.set(name, node);
		}

		return node;
	}

	public getChildren(): ReadonlyMap<string, Node> {
		return this.children;
	}

	public getInterfaceDeclarations(): ReadonlyArray<[ts.SourceFile, ts.InterfaceDeclaration]> {
		return this.interfaceDeclarations;
	}

	public getFunctionDeclaration(): [ts.SourceFile, ts.FunctionDeclaration] | undefined {
		return this.functionDeclaration;
	}

	public getVariableDeclaration(): [ts.SourceFile, ts.VariableDeclaration] | undefined {
		return this.variableDeclaration;
	}

	public getClassObject(): Class | undefined {
		return this.classObject;
	}

	private findForward(name: string): Node | undefined {
		const index = name.indexOf(".");
		const head = index < 0 ? name : name.substr(0, index);
		const child = this.children.get(head);

		if (child) {
			if (index < 0) {
				return child;
			} else {
				const result = child.findForward(name.substr(index + 1));

				if (result) {
					return result;
				}
			}
		}
	}

	public find(name: string): Node | undefined {
		return this.findForward(name) || this.parent?.find(name);
	}

	public addNodes(sourceFile: ts.SourceFile, parent: ts.Node): void {
		ts.forEachChild(parent, node => {
			if (ts.isInterfaceDeclaration(node)) {
				const name = node.name.getText(sourceFile);
				const child = this.getChild(name);
				child.interfaceDeclarations.push([sourceFile, node]);

				if (!child.classObject) {
					child.classObject = new Class(name);
				}
			} else if (ts.isFunctionDeclaration(node)) {
				const name = node.name!.getText(sourceFile);
				const child = this.getChild(name);
				child.functionDeclaration = [sourceFile, node];
			} else if (ts.isVariableStatement(node)) {
				for (const variableDeclaration of node.declarationList.declarations) {
					const name = variableDeclaration.name.getText(sourceFile);
					const child = this.getChild(name);
					child.variableDeclaration = [sourceFile, variableDeclaration];
				}
			} else if (ts.isModuleDeclaration(node)) {
				const name = node.name.getText(sourceFile);
				const child = this.getChild(name);
				child.addNodes(sourceFile, node.body!);
			}
		});
	}

	public getTypeReference(sourceFile: ts.SourceFile, type: ts.TypeNode): Node | undefined {
		if (ts.isTypeReferenceNode(type)) {
			return this.find(type.typeName.getText(sourceFile));
		} else if (ts.isExpressionWithTypeArguments(type)) {
			return this.find(type.expression.getText(sourceFile));
		}
	}
}

class Parser {
	private readonly file: File = new File;
	private readonly objectType: Type;
	private readonly stringType: Type;
	private readonly bigintType: Type;
	private readonly symbolType: Type;
	private readonly arrayType: Type;

	public constructor(root: Node) {
		const objectClass = root.find("Object")?.getClassObject();
		const stringClass = root.find("String")?.getClassObject();
		const bigintClass = root.find("BigInt")?.getClassObject();
		const symbolClass = root.find("Symbol")?.getClassObject();
		const arrayClass = root.find("Array")?.getClassObject();

		this.objectType = objectClass ? new DeclaredType(objectClass) : new FakeType("client::Object");
		this.stringType = stringClass ? new DeclaredType(stringClass) : new FakeType("client::String");
		this.bigintType = bigintClass ? new DeclaredType(bigintClass) : new FakeType("client::BigInt");
		this.symbolType = symbolClass ? new DeclaredType(symbolClass) : new FakeType("client::Symbol");
		this.arrayType = arrayClass ? new DeclaredType(arrayClass) : new FakeType("client::Array");

		if (objectClass) {
			objectClass.addAttribute("cheerp::client_layout");
		}
	}

	private getType(node: Node, sourceFile: ts.SourceFile, type: ts.TypeNode, overrides?: ReadonlyMap<string, Type>): Type {
		if (overrides) {
			let name;

			if (ts.isTypeReferenceNode(type)) {
				name = type.typeName.getText(sourceFile);
			} else if (ts.isExpressionWithTypeArguments(type)) {
				name = type.expression.getText(sourceFile);
			}

			if (name) {
				const type = overrides.get(name);

				if (type) {
					return type;
				}
			}
		}

		switch (type.kind) {
		case ts.SyntaxKind.VoidKeyword:
			return new FakeType("void");
		case ts.SyntaxKind.BooleanKeyword:
		case ts.SyntaxKind.TypePredicate:
			return new FakeType("bool");
		case ts.SyntaxKind.NumberKeyword:
			return new FakeType("double");
		case ts.SyntaxKind.ObjectKeyword:
			return this.objectType.pointer();
		case ts.SyntaxKind.StringKeyword:
			return this.stringType.pointer();
		case ts.SyntaxKind.BigIntKeyword:
			return this.bigintType.pointer();
		case ts.SyntaxKind.SymbolKeyword:
			return this.symbolType.pointer();
		case ts.SyntaxKind.ArrayType:
		case ts.SyntaxKind.TupleType:
			return this.arrayType.pointer();
		default:
			const classObject = node.getTypeReference(sourceFile, type)?.getClassObject();
			return (classObject ? new DeclaredType(classObject) : this.objectType).pointer();
		}
	}

	private setOverrides(sourceFile: ts.SourceFile, overrides: ReadonlyMap<string, Type>, typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration>): ReadonlyMap<string, Type> {
		if (typeParameters) {
			const result = new Map(overrides);

			for (const typeParameter of typeParameters) {
				const name = typeParameter.name.getText(sourceFile);
				result.set(name, new FakeType(name));
			}

			return result;
		} else {
			return overrides;
		}
	}

	private setErasedOverrides(sourceFile: ts.SourceFile, overrides: ReadonlyMap<string, Type>, typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration>): ReadonlyMap<string, Type> {
		if (typeParameters) {
			const result = new Map(overrides);

			for (const typeParameter of typeParameters) {
				const name = typeParameter.name.getText(sourceFile);
				result.set(name, this.objectType.pointer());
			}

			return result;
		} else {
			return overrides;
		}
	}

	private addTypeParameters(sourceFile: ts.SourceFile, declaration: TemplateDeclaration, typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration>): void {
		if (typeParameters) {
			for (const typeParameter of typeParameters) {
				const name = typeParameter.name.getText(sourceFile);
				declaration.addTypeParameter(name);
			}
		}
	}

	private createFunction(name: string, node: Node, declaration: [ts.SourceFile, ts.SignatureDeclarationBase], overrides: ReadonlyMap<string, Type>, namespace?: Namespace): Function {
		const [sourceFile, decl] = declaration;
		overrides = this.setOverrides(sourceFile, overrides, decl.typeParameters);
		const type = this.getType(node, sourceFile, decl.type!, overrides);
		const result = new Function(name, type, namespace);
		this.addTypeParameters(sourceFile, result, decl.typeParameters);

		for (const parameter of decl.parameters) {
			const type = this.getType(node, sourceFile, parameter.type!, overrides);
			const name = parameter.name.getText(sourceFile);

			if (parameter.dotDotDotToken) {
				result.addVariadicTypeParameter("__Args");
				result.addParameter(new FakeType("__Args").expand(), name);
			} else if (name !== "this") {
				result.addParameter(type, name);
			}
		}

		return result;
	}

	private createVariable(name: string, node: Node, declaration: [ts.SourceFile, ts.VariableDeclaration], overrides: ReadonlyMap<string, Type>, namespace?: Namespace): Variable {
		const [sourceFile, decl] = declaration;
		const type = this.getType(node, sourceFile, decl.type!, overrides);
		const result = new Variable(name, type, namespace);
		return result;
	}

	public addClass(name: string, node: Node, classObject: Class, overrides: ReadonlyMap<string, Type>): void {
		const interfaceDeclarations = node.getInterfaceDeclarations();
		const functionDeclaration = node.getFunctionDeclaration();
		const variableDeclaration = node.getVariableDeclaration();
		this.file.addGlobal(classObject);

		for (const [sourceFile, interfaceDecl] of interfaceDeclarations) {
			const newOverrides = this.setErasedOverrides(sourceFile, overrides, interfaceDecl.typeParameters);

			for (const member of interfaceDecl.members) {
				if (ts.isMethodSignature(member)) {
					const name = member.name.getText(sourceFile);
					const functionObject = this.createFunction(name, node, [sourceFile, member], newOverrides);
					classObject.addMember(functionObject, Visibility.Public);
				}
			}

			if (interfaceDecl.heritageClauses) {
				for (const heritageClause of interfaceDecl.heritageClauses) {
					for (const type of heritageClause.types) {
						const typeReference = node.getTypeReference(sourceFile, type);
						const baseClassObject = typeReference?.getClassObject();

						if (baseClassObject) {
							classObject.addBase(new DeclaredType(baseClassObject), Visibility.Public);
						}
					}
				}
			}
		}


		if (classObject.getBases().length === 0 && this.objectType instanceof DeclaredType && classObject !== this.objectType.getDeclaration()) {
			classObject.addBase(this.objectType, Visibility.Public);
		}

		for (const [name, child] of node.getChildren()) {
			const interfaceDeclarations = child.getInterfaceDeclarations();
			const functionDeclaration = child.getFunctionDeclaration();
			const variableDeclaration = child.getVariableDeclaration();
			const childClassObject = child.getClassObject();
			
			if (childClassObject) {
				this.addClass(name, child, childClassObject, overrides);
				classObject.addMember(childClassObject, Visibility.Public);
			} else if (functionDeclaration) {
				const functionObject = this.createFunction(name, node, functionDeclaration, overrides);
				functionObject.addFlags(Flags.Static);
				classObject.addMember(functionObject, Visibility.Public);
			} else if (variableDeclaration) {
				const variableObject = this.createVariable(name, node, variableDeclaration, overrides);
				variableObject.addFlags(Flags.Static);
				classObject.addMember(variableObject, Visibility.Public);
			} else {
				const newClassObject = new Class(name);
				classObject.addMember(newClassObject, Visibility.Public);
				this.addClass(name, child, newClassObject, overrides);
			}
		}

		if (variableDeclaration) {
			const [sourceFile, variableDecl] = variableDeclaration;
			const type = node.getTypeReference(sourceFile, variableDecl.type!);

			if (type) {
				const interfaceDeclarations = type.getInterfaceDeclarations();

				for (const [sourceFile, interfaceDecl] of interfaceDeclarations) {
					const newOverrides = this.setErasedOverrides(sourceFile, overrides, interfaceDecl.typeParameters);

					for (const member of interfaceDecl.members) {
						if (ts.isMethodSignature(member)) {
							const name = member.name.getText(sourceFile);
							const functionObject = this.createFunction(name, type, [sourceFile, member], newOverrides);
							functionObject.addFlags(Flags.Static);
							classObject.addMember(functionObject, Visibility.Public);
						}
					}
				}
			}
		}

	}

	public addNode(name: string, node: Node, namespace?: Namespace): void {
		const interfaceDeclarations = node.getInterfaceDeclarations();
		const functionDeclaration = node.getFunctionDeclaration();
		const variableDeclaration = node.getVariableDeclaration();
		const classObject = node.getClassObject();

		if (classObject) {
			this.addClass(name, node, classObject, new Map);
			classObject.setParent(namespace);
			classObject.computeReferences();
		} else if (functionDeclaration) {
			const functionObject = this.createFunction(name, node, functionDeclaration, new Map, namespace);
			this.file.addGlobal(functionObject);
		} else if (variableDeclaration) {
			const variableObject = this.createVariable(name, node, variableDeclaration, new Map, namespace);
			variableObject.addFlags(Flags.Extern);
			this.file.addGlobal(variableObject);
		} else {
			const newNamespace = new Namespace(name, namespace);

			for (const [name, child] of node.getChildren()) {
				this.addNode(name, child, newNamespace);
			}
		}
	}

	public getFile(): File {
		return this.file;
	}
}

export function parseNode(names: ReadonlyArray<string>): Node {
	const root = new Node;
	const program = ts.createProgram(names, {});

	for (const sourceFile of program.getSourceFiles()) {
		root.addNodes(sourceFile, sourceFile);
	}

	return root;
}

export function parseFile(root: Node): File {
	const parser = new Parser(root);
	const namespace = new Namespace("client");
	namespace.addAttribute("cheerp::genericjs");

	for (const [name, node] of root.getChildren()) {
		parser.addNode(name, node, namespace);
	}

	return parser.getFile();
}
