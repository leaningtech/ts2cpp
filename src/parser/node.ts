import { getName } from "./name.js";
import { Class, Visibility } from "../declaration/class.js";
import { TypeAlias } from "../declaration/typeAlias.js";
import { Parser } from "./parser.js";
import { VOID_TYPE } from "../type/namedType.js";
import { DeclaredType } from "../type/declaredType.js";
import * as ts from "typescript";

export type ClassDeclaration = ts.InterfaceDeclaration | ts.ClassDeclaration;
export type FunctionDeclaration = ts.SignatureDeclarationBase;

export class Node {
	private children?: Map<string, Child>;

	public getChildren(): Iterable<Child> {
		return this.children?.values() ?? [];
	}

	public getChild(name: string): Child | undefined {
		return this.children?.get(name);
	}

	public getSize(): number {
		return this.children?.size ?? 0;
	}

	private getOrInsert(declaration: ts.NamedDeclaration): Child {
		const [_, name] = getName(declaration);
		let node = this.getChild(name);

		if (!node) {
			node = new Child(name);
			this.children ??= new Map;
			this.children.set(name, node);
		}

		return node;
	}

	public discover(parser: Parser, parent: ts.Node): void {
		ts.forEachChild(parent, node => {
			if (ts.isInterfaceDeclaration(node)) {
				const child = this.getOrInsert(node);
				child.interfaceDeclarations ??= [];
				child.interfaceDeclarations.push(node);
				child.discoverClass(parser, node);
			} else if (ts.isFunctionDeclaration(node)) {
				const child = this.getOrInsert(node);
				child.functionDeclarations ??= [];
				child.functionDeclarations.push(node);
			} else if (ts.isVariableStatement(node)) {
				if (parser.includesDeclaration(node)) {
					for (const declaration of node.declarationList.declarations) {
						const child = this.getOrInsert(declaration);
						child.variableDeclaration = declaration;
					}
				}
			} else if (ts.isTypeAliasDeclaration(node)) {
				const child = this.getOrInsert(node);
				child.typeAliasDeclaration = node;
				child.basicTypeAlias = new TypeAlias(child.getName(), VOID_TYPE);

				if (node.typeParameters && node.typeParameters.length > 0) {
					child.genericTypeAlias = new TypeAlias(`T${child.getName()}`, VOID_TYPE);
					child.genericTypeAlias.setBasicVersion(child.basicTypeAlias);
				}
			} else if (ts.isModuleDeclaration(node)) {
				if (node.name.text === "global") {
					parser.getRootNode().discover(parser, node.body!);
				} else {
					const child = this.getOrInsert(node);
					child.moduleDeclaration = node;
					child.discover(parser, node.body!);
				}
			} else if (ts.isClassDeclaration(node)) {
				const child = this.getOrInsert(node);
				child.classDeclaration = node;
				child.discoverClass(parser, node);
			}

			// other possible nodes:
			//   ts.SyntaxKind.EndOfFileToken
			//   ts.SyntaxKind.ExportDeclaration
			//   ts.SyntaxKind.ImportDeclaration
			//   ts.SyntaxKind.ExportAssignment
			//   ts.SyntaxKind.ImportEqualsDeclaration
		});
	}
}

export class Child extends Node {
	private readonly name: string;
	public interfaceDeclarations?: Array<ts.InterfaceDeclaration>;
	public functionDeclarations?: Array<ts.FunctionDeclaration>;
	public moduleDeclaration?: ts.ModuleDeclaration;
	public classDeclaration?: ts.ClassDeclaration;
	public variableDeclaration?: ts.VariableDeclaration;
	public typeAliasDeclaration?: ts.TypeAliasDeclaration;
	public basicClass?: Class;
	public genericClass?: Class;
	public basicTypeAlias?: TypeAlias;
	public genericTypeAlias?: TypeAlias;

	public constructor(name: string) {
		super();
		this.name = name;
	}

	public getName(): string {
		return this.name;
	}

	public getClassDeclarations(): ReadonlyArray<ClassDeclaration> {
		if (this.classDeclaration) {
			return [this.classDeclaration, ...this.interfaceDeclarations ?? []];
		} else {
			return this.interfaceDeclarations ?? [];
		}
	}

	public getFunctionDeclarations(): ReadonlyArray<FunctionDeclaration> {
		return this.functionDeclarations ?? [];
	}

	public discoverClass(parser: Parser, node: ts.Node): void {
		if (!this.basicClass) {
			const type = parser.getTypeAtLocation(node) as ts.InterfaceType;
			this.basicClass = new Class(this.name);
			const basicType = DeclaredType.create(this.basicClass);
			parser.addBasicDeclaredClass(type, basicType);

			if (type.typeParameters && type.typeParameters.length > 0) {
				this.genericClass = new Class(`T${this.name}`);
				this.genericClass.setBasicVersion(this.basicClass);
				this.genericClass.addBase(basicType, Visibility.Public);
				parser.addGenericDeclaredClass(type, DeclaredType.create(this.genericClass));
			}
		}
	}
}
