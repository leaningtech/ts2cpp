import * as ts from "typescript";
import { File } from "./file.js";
import { Class } from "./class.js";
import { Namespace } from "./namespace.js";

class Node {
	private readonly children: Map<string, Node> = new Map;
	private readonly interfaceDeclarations: Array<ts.InterfaceDeclaration> = new Array;
	private functionDeclaration?: ts.FunctionDeclaration;
	private variableDeclaration?: ts.VariableDeclaration;
	private classObject?: Class;
	
	public getChild(name: string): Node {
		let node = this.children.get(name);

		if (!node) {
			node = new Node;
			this.children.set(name, node);
		}

		return node;
	}

	public getChildren(): ReadonlyMap<string, Node> {
		return this.children;
	}

	public getInterfaceDeclarations(): ReadonlyArray<ts.InterfaceDeclaration> {
		return this.interfaceDeclarations;
	}

	public getFunctionDeclaration(): ts.FunctionDeclaration | undefined {
		return this.functionDeclaration;
	}

	public getVariableDeclaration(): ts.VariableDeclaration | undefined {
		return this.variableDeclaration;
	}

	public getClassObject(): Class | undefined {
		return this.classObject;
	}

	public addNodes(sourceFile: ts.SourceFile, parent: ts.Node): void {
		ts.forEachChild(parent, node => {
			if (ts.isInterfaceDeclaration(node)) {
				const name = node.name.getText(sourceFile);
				const child = this.getChild(name);
				child.interfaceDeclarations.push(node);

				if (!child.classObject) {
					child.classObject = new Class(name);
				}
			} else if (ts.isFunctionDeclaration(node)) {
				const name = node.name!.getText(sourceFile);
				const child = this.getChild(name);
				child.functionDeclaration = node;
			} else if (ts.isVariableStatement(node)) {
				for (const variableDeclaration of node.declarationList.declarations) {
					const name = variableDeclaration.name.getText(sourceFile);
					const child = this.getChild(name);
					child.variableDeclaration = variableDeclaration;
				}
			} else if (ts.isModuleDeclaration(node)) {
				const name = node.name.getText(sourceFile);
				const child = this.getChild(name);
				child.addNodes(sourceFile, node.body!);
			}
		});
	}
}

class Parser {
	private readonly file: File = new File;

	public addNode(name: string, node: Node, namespace?: Namespace): void {
		const interfaceDeclarations = node.getInterfaceDeclarations();
		const functionDeclaration = node.getFunctionDeclaration();
		const variableDeclaration = node.getVariableDeclaration();
		const classObject = node.getClassObject();

		if (classObject) {
			this.file.addGlobal(classObject);

			for (const interfaceDeclaration of interfaceDeclarations) {
				// TODO: members
			}

			for (const [name, child] of node.getChildren()) {
				// TODO: static members and inner classes
			}

			if (variableDeclaration) {
				// TODO: static members (constructor object)
			}

			classObject.setParent(namespace);
			classObject.computeReferences();
		} else if (functionDeclaration) {
			// TODO: global function
		} else if (variableDeclaration) {
			// TODO: global variable
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
	namespace.addAttribute("genericjs");

	for (const [name, node] of root.getChildren()) {
		parser.addNode(name, node, namespace);
	}

	return parser.getFile();
}
