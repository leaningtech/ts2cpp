import * as ts from "typescript";
import { File } from "./file.js";
import { Class, Visibility } from "./class.js";
import { Namespace, Flags } from "./namespace.js";
import { Variable } from "./variable.js";
import { Function } from "./function.js";
import { Type, FakeType, DeclaredType } from "./type.js";

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

	public find(name: string): Node | undefined {
		const index = name.indexOf(".");
		const head = index < 0 ? name : name.substr(0, index);
		const child = this.children.get(head);

		if (child) {
			if (index < 0) {
				return child;
			} else {
				const result = child.find(name.substr(index + 1));

				if (result) {
					return result;
				}
			}
		}

		return this.parent?.find(name);
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
}

function findTypeReference(node: Node, sourceFile: ts.SourceFile, type: ts.TypeNode): Node | undefined {
	if (ts.isTypeReferenceNode(type)) {
		const name = type.typeName.getText(sourceFile);
		return node.find(name);
	} else if (ts.isExpressionWithTypeArguments(type)) {
		const name = type.expression.getText(sourceFile);
		return node.find(name);
	}
}

function getType(node: Node, sourceFile: ts.SourceFile, type: ts.TypeNode): Type {
	const typeReference = findTypeReference(node, sourceFile, type);
	const classObject = typeReference?.getClassObject();
	return classObject ? new DeclaredType(classObject) : new FakeType("client::Object");
}

class Parser {
	private readonly file: File = new File;

	public addClass(name: string, node: Node, classObject: Class): void {
		const interfaceDeclarations = node.getInterfaceDeclarations();
		const functionDeclaration = node.getFunctionDeclaration();
		const variableDeclaration = node.getVariableDeclaration();
		
		this.file.addGlobal(classObject);

		for (const [sourceFile, interfaceDecl] of interfaceDeclarations) {
			for (const member of interfaceDecl.members) {
				if (ts.isMethodSignature(member)) {
					const name = member.name.getText(sourceFile);
					const type = getType(node, sourceFile, member.type!);
					const functionObject = new Function(name, type.pointer());
					classObject.addMember(functionObject, Visibility.Public);
				}
			}

			if (interfaceDecl.heritageClauses) {
				for (const heritageClause of interfaceDecl.heritageClauses) {
					for (const type of heritageClause.types) {
						const typeReference = findTypeReference(node, sourceFile, type);
						const baseClassObject = typeReference?.getClassObject();

						if (baseClassObject) {
							classObject.addBase(new DeclaredType(baseClassObject), Visibility.Public);
						}
					}
				}
			}
		}

		for (const [name, child] of node.getChildren()) {
			const interfaceDeclarations = child.getInterfaceDeclarations();
			const functionDeclaration = child.getFunctionDeclaration();
			const variableDeclaration = child.getVariableDeclaration();
			const childClassObject = child.getClassObject();
			
			if (childClassObject) {
				this.addClass(name, child, childClassObject);
				classObject.addMember(childClassObject, Visibility.Public);
			} else if (functionDeclaration) {
				const [sourceFile, functionDecl] = functionDeclaration;
				const type = getType(node, sourceFile, functionDecl.type!);
				const functionObject = new Function(name, type.pointer());
				functionObject.addFlags(Flags.Static);
				classObject.addMember(functionObject, Visibility.Public);
			} else if (variableDeclaration) {
				const [sourceFile, variableDecl] = variableDeclaration;
				const type = getType(node, sourceFile, variableDecl.type!);
				const variableObject = new Variable(name, type.pointer());
				variableObject.addFlags(Flags.Static);
				classObject.addMember(variableObject, Visibility.Public);
			} else {
				const newClassObject = new Class(name);
				classObject.addMember(newClassObject, Visibility.Public);

				for (const [name, child] of node.getChildren()) {
					this.addClass(name, child, newClassObject);
				}
			}
		}

		if (variableDeclaration) {
			const [sourceFile, variableDecl] = variableDeclaration;
			const type = findTypeReference(node, sourceFile, variableDecl.type!);

			if (type) {
				const interfaceDeclarations = type.getInterfaceDeclarations();

				for (const [sourceFile, interfaceDecl] of interfaceDeclarations) {
					for (const member of interfaceDecl.members) {
						if (ts.isMethodSignature(member)) {
							const name = member.name.getText(sourceFile);
							const type = getType(node, sourceFile, member.type!);
							const functionObject = new Function(name, type.pointer());
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
			this.addClass(name, node, classObject);
			classObject.setParent(namespace);
			classObject.computeReferences();
		} else if (functionDeclaration) {
			const [sourceFile, functionDecl] = functionDeclaration;
			const type = getType(node, sourceFile, functionDecl.type!);
			const functionObject = new Function(name, type.pointer(), namespace);
			this.file.addGlobal(functionObject);
		} else if (variableDeclaration) {
			const [sourceFile, variableDecl] = variableDeclaration;
			const type = getType(node, sourceFile, variableDecl.type!);
			const variableObject = new Variable(name, type.pointer(), namespace);
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
	const parser = new Parser;
	const namespace = new Namespace("client");
	namespace.addAttribute("cheerp::genericjs");

	for (const [name, node] of root.getChildren()) {
		parser.addNode(name, node, namespace);
	}

	return parser.getFile();
}
