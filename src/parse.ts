import * as ts from "typescript";
import { File } from "./file.js";
import { Class, Visibility } from "./class.js";
import { Namespace, Flags } from "./namespace.js";
import { Variable } from "./variable.js";
import { Function } from "./function.js";
import { Type, ExternType, DeclaredType, ParameterType, TemplateType, UnqualifiedType, TypeQualifier } from "./type.js";
import { Declaration, TemplateDeclaration } from "./declaration.js";
import { TypeAlias } from "./typeAlias.js";

function getName(sourceFile: ts.SourceFile, name?: ts.Node): [string, string] {
	return ["", ""]
}

class Node {
	private readonly parent?: Node;
	private readonly children: Map<string, Node> = new Map;
	private readonly interfaceDeclarations: Array<[ts.SourceFile, ts.InterfaceDeclaration]> = new Array;
	private functionDeclaration?: [ts.SourceFile, ts.FunctionDeclaration];
	private variableDeclaration?: [ts.SourceFile, ts.VariableDeclaration];
	private typeAliasDeclaration?: [ts.SourceFile, ts.TypeAliasDeclaration];
	private typeAliasObject?: TypeAlias;
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

	public getTypeAliasDeclaration(): [ts.SourceFile, ts.TypeAliasDeclaration] | undefined {
		return this.typeAliasDeclaration;
	}

	public getTypeAliasObject(): TypeAlias | undefined {
		return this.typeAliasObject;
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
				const [realName, name] = getName(sourceFile, node.name);
				const child = this.getChild(name);
				child.interfaceDeclarations.push([sourceFile, node]);

				if (!child.classObject) {
					child.classObject = new Class(name);
				}
			} else if (ts.isFunctionDeclaration(node)) {
				const [realName, name] = getName(sourceFile, node.name);
				const child = this.getChild(name);
				child.functionDeclaration = [sourceFile, node];
			} else if (ts.isVariableStatement(node)) {
				for (const variableDeclaration of node.declarationList.declarations) {
					const [realName, name] = getName(sourceFile, variableDeclaration.name);
					const child = this.getChild(name);
					child.variableDeclaration = [sourceFile, variableDeclaration];
				}
			} else if (ts.isModuleDeclaration(node)) {
				const [realName, name] = getName(sourceFile, node.name);
				const child = this.getChild(name);
				child.addNodes(sourceFile, node.body!);
			} else if (ts.isTypeAliasDeclaration(node)) {
				const [realName, name] = getName(sourceFile, node.name);
				const child = this.getChild(name);
				child.typeAliasDeclaration = [sourceFile, node];
				child.typeAliasObject = new TypeAlias(name, new ExternType("void"));
			}
		});
	}

	public getTypeReference(sourceFile: ts.SourceFile, type: ts.TypeNode): Node | undefined {
		if (ts.isTypeReferenceNode(type)) {
			return this.find(getName(sourceFile, type.typeName)[1]);
		} else if (ts.isExpressionWithTypeArguments(type)) {
			return this.find(getName(sourceFile, type.expression)[1]);
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

		this.objectType = objectClass ? new DeclaredType(objectClass) : new ExternType("client::Object");
		this.stringType = stringClass ? new DeclaredType(stringClass) : new ExternType("client::String");
		this.bigintType = bigintClass ? new DeclaredType(bigintClass) : new ExternType("client::BigInt");
		this.symbolType = symbolClass ? new DeclaredType(symbolClass) : new ExternType("client::Symbol");
		this.arrayType = arrayClass ? new DeclaredType(arrayClass) : new ExternType("client::Array");

		if (objectClass) {
			objectClass.addAttribute("cheerp::client_layout");
		}
	}

	private createTemplateType(node: Node, sourceFile: ts.SourceFile, type: UnqualifiedType, typeArguments?: ts.NodeArray<ts.TypeNode>, overrides?: ReadonlyMap<string, Type>): Type {
		if (typeArguments && type instanceof DeclaredType && type.getDeclaration() instanceof TypeAlias) {
			const templateType = new TemplateType(type);

			for (const typeArgument of typeArguments) {
				templateType.addTypeParameter(this.getType(node, sourceFile, typeArgument, TypeQualifier.Pointer, overrides));
			}

			return templateType;
		}

		return type;
	}

	private getType(node: Node, sourceFile: ts.SourceFile, type: ts.TypeNode, qualifier: TypeQualifier, overrides?: ReadonlyMap<string, Type>): Type {
		let realName, name;
		let typeArguments;

		if (ts.isTypeReferenceNode(type)) {
			[realName, name] = getName(sourceFile, type.typeName);
			typeArguments = type.typeArguments;
		} else if (ts.isExpressionWithTypeArguments(type)) {
			[realName, name] = getName(sourceFile, type.expression);
			typeArguments = type.typeArguments;
		}

		if (overrides && name) {
			const type = overrides.get(name);

			if (type) {
				return type;
			}
		}

		switch (type.kind) {
		case ts.SyntaxKind.VoidKeyword:
			return new ExternType("void");
		case ts.SyntaxKind.BooleanKeyword:
		case ts.SyntaxKind.TypePredicate:
			return new ExternType("bool");
		case ts.SyntaxKind.NumberKeyword:
			return new ExternType("double");
		case ts.SyntaxKind.ObjectKeyword:
			return this.objectType.qualify(qualifier);
		case ts.SyntaxKind.StringKeyword:
			return this.stringType.qualify(qualifier);
		case ts.SyntaxKind.BigIntKeyword:
			return this.bigintType.qualify(qualifier);
		case ts.SyntaxKind.SymbolKeyword:
			return this.symbolType.qualify(qualifier);
		/*
		case ts.SyntaxKind.ArrayType:
			const arrayType = new TemplateType(this.arrayType);
			arrayType.addTypeParameter(this.getType(node, sourceFile, (type as ts.ArrayTypeNode).elementType, overrides));
			return arrayType.qualify(qualifier);
		case ts.SyntaxKind.TupleType:
			const tupleType = new TemplateType(this.arrayType);
			tupleType.addTypeParameter(this.objectType.qualify(qualifier));
			return tupleType.qualify(qualifier);
		*/
		case ts.SyntaxKind.ArrayType:
		case ts.SyntaxKind.TupleType:
			return this.arrayType.qualify(qualifier);
		default:
			if (name) {
				const typeReference = node.find(name);
				const classObject = typeReference?.getClassObject();
				const typeAliasObject = typeReference?.getTypeAliasObject();

				if (classObject) {
					return this.createTemplateType(node, sourceFile, new DeclaredType(classObject), typeArguments, overrides).qualify(qualifier);
				} else if (typeAliasObject) {
					return this.createTemplateType(node, sourceFile, new DeclaredType(typeAliasObject), typeArguments, overrides);
				}
			}

			return this.objectType.qualify(qualifier);
		}
	}

	private hasUndefinedOrNull(type: ts.TypeNode): boolean {
		if (ts.isUnionTypeNode(type)) {
			for (const member of type.types) {
				if (this.hasUndefinedOrNull(member)) {
					return true;
				}
			}

			return false;
		} else {
			return type.kind === ts.SyntaxKind.UndefinedKeyword || (ts.isLiteralTypeNode(type) && type.literal.kind == ts.SyntaxKind.NullKeyword);
		}
	}

	private getUnionTypesWithQualifier(node: Node, sourceFile: ts.SourceFile, type: ts.TypeNode, qualifier: TypeQualifier, overrides: ReadonlyMap<string, Type>): ReadonlyArray<Type> {
		if (ts.isUnionTypeNode(type)) {
			return type.types.flatMap(type => this.getUnionTypesWithQualifier(node, sourceFile, type, qualifier, overrides));
		} else if (type.kind === ts.SyntaxKind.UndefinedKeyword) {
			return [];
		} else if (ts.isLiteralTypeNode(type) && type.literal.kind === ts.SyntaxKind.NullKeyword) {
			return [];
		} else {
			return [this.getType(node, sourceFile, type, qualifier, overrides)];
		}
	}

	private getUnionTypes(node: Node, sourceFile: ts.SourceFile, type: ts.TypeNode, overrides: ReadonlyMap<string, Type>): ReadonlyArray<Type> {
		if (this.hasUndefinedOrNull(type)) {
			return this.getUnionTypesWithQualifier(node, sourceFile, type, TypeQualifier.Pointer, overrides);
		} else {
			return this.getUnionTypesWithQualifier(node, sourceFile, type, TypeQualifier.ConstReference, overrides);
		}
	}

	private setOverrides(sourceFile: ts.SourceFile, overrides: ReadonlyMap<string, Type>, typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration>): ReadonlyMap<string, Type> {
		if (typeParameters) {
			const result = new Map(overrides);

			for (const typeParameter of typeParameters) {
				const [realName, name] = getName(sourceFile, typeParameter.name);
				result.set(name, new ParameterType(name, result.size));
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
				const [realName, name] = getName(sourceFile, typeParameter.name);
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
				const [realName, name] = getName(sourceFile, typeParameter.name);
				declaration.addTypeParameter(name);
			}
		}
	}

	private createFunctionParameters(node: Node, sourceFile: ts.SourceFile, decl: ts.SignatureDeclarationBase, overrides: ReadonlyMap<string, Type>): ReadonlyArray<ReadonlyArray<[ts.ParameterDeclaration, Type]>> {
		let result: Array<Array<[ts.ParameterDeclaration, Type]>> = [[]];

		for (const parameter of decl.parameters) {
			const types = this.getUnionTypes(node, sourceFile, parameter.type!, overrides);
			const newResult = new Array;

			for (const type of types) {
				for (const parameters of result) {
					newResult.push(parameters.concat([[parameter, type]]));
				}
			}

			result = newResult;
		}

		return result;
	}

	private createFunctions(name: string, node: Node, declaration: [ts.SourceFile, ts.SignatureDeclarationBase], overrides: ReadonlyMap<string, Type>, namespace?: Namespace): ReadonlyArray<Function> {
		const [sourceFile, decl] = declaration;
		overrides = this.setOverrides(sourceFile, overrides, decl.typeParameters);
		const type = ts.isConstructSignatureDeclaration(decl) ? undefined : this.getType(node, sourceFile, decl.type!, TypeQualifier.Pointer, overrides);
		const functions = new Array;

		for (const parameters of this.createFunctionParameters(node, sourceFile, decl, overrides)) {
			const result = new Function(name, type, namespace);
			this.addTypeParameters(sourceFile, result, decl.typeParameters);

			for (const [parameter, type] of parameters) {
				const [realName, name] = getName(sourceFile, parameter.name);

				if (parameter.dotDotDotToken) {
					result.addVariadicTypeParameter("__Args");
					result.addParameter(new ParameterType("__Args", -1).expand(), name);
				} else if (name !== "this") {
					result.addParameter(type, name);
				}
			}

			functions.push(result);
		}

		return functions;
	}

	private createVariable(name: string, node: Node, declaration: [ts.SourceFile, ts.VariableDeclaration | ts.PropertySignature], qualifier: TypeQualifier, overrides: ReadonlyMap<string, Type>, namespace?: Namespace): Variable {
		const [sourceFile, decl] = declaration;
		const type = this.getType(node, sourceFile, decl.type!, qualifier, overrides);
		const result = new Variable(name, type, namespace);
		return result;
	}

	private addTypeAlias(node: Node, declaration: [ts.SourceFile, ts.TypeAliasDeclaration], typeAliasObject: TypeAlias, overrides: ReadonlyMap<string, Type>): void {
		const [sourceFile, decl] = declaration;
		overrides = this.setOverrides(sourceFile, overrides, decl.typeParameters);
		typeAliasObject.setType(this.getType(node, sourceFile, decl.type!, TypeQualifier.Pointer, overrides));
		this.addTypeParameters(sourceFile, typeAliasObject, decl.typeParameters);
	}

	public addClass(node: Node, classObject: Class, overrides: ReadonlyMap<string, Type>): void {
		const interfaceDeclarations = node.getInterfaceDeclarations();
		const variableDeclaration = node.getVariableDeclaration();
		this.file.addGlobal(classObject);

		for (const [sourceFile, interfaceDecl] of interfaceDeclarations) {
			const newOverrides = this.setErasedOverrides(sourceFile, overrides, interfaceDecl.typeParameters);

			for (const member of interfaceDecl.members) {
				if (ts.isMethodSignature(member)) {
					const [realName, name] = getName(sourceFile, member.name);
					for (const functionObject of this.createFunctions(name, node, [sourceFile, member], newOverrides)) {
						classObject.addMember(functionObject, Visibility.Public);
					}
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
			const typeAliasDeclaration = child.getTypeAliasDeclaration();
			const typeAliasObject = child.getTypeAliasObject();
			const childClassObject = child.getClassObject();

			if (childClassObject) {
				this.addClass(child, childClassObject, overrides);
				classObject.addMember(childClassObject, Visibility.Public);
			} else if (functionDeclaration) {
				for (const functionObject of this.createFunctions(name, child, functionDeclaration, overrides)) {
					functionObject.addFlags(Flags.Static);
					classObject.addMember(functionObject, Visibility.Public);
				}
			} else if (typeAliasDeclaration && typeAliasObject) {
				this.addTypeAlias(child, typeAliasDeclaration, typeAliasObject, overrides);
				classObject.addMember(typeAliasObject, Visibility.Public);
			} else if (variableDeclaration) {
				const variableObject = this.createVariable(name, child, variableDeclaration, TypeQualifier.Pointer, overrides);
				variableObject.addFlags(Flags.Static);
				classObject.addMember(variableObject, Visibility.Public);
			} else {
				const newClassObject = new Class(name);
				classObject.addMember(newClassObject, Visibility.Public);
				this.addClass(child, newClassObject, overrides);
			}
		}

		if (variableDeclaration) {
			const [sourceFile, variableDecl] = variableDeclaration;
			let type = node.getTypeReference(sourceFile, variableDecl.type!);

			/*
			while (type) {
				const typeAliasDeclaration = type.getTypeAliasDeclaration();

				if (!typeAliasDeclaration) {
					break;
				}

				const [sourceFile, typeAliasDecl] = typeAliasDeclaration;
				type = node.getTypeReference(sourceFile, typeAliasDecl.type);
			}
			*/

			if (type) {
				const interfaceDeclarations = type.getInterfaceDeclarations();

				for (const [sourceFile, interfaceDecl] of interfaceDeclarations) {
					const newOverrides = this.setErasedOverrides(sourceFile, overrides, interfaceDecl.typeParameters);

					for (const member of interfaceDecl.members) {
						if (ts.isMethodSignature(member)) {
							const [realName, name] = getName(sourceFile, member.name);
							for (const functionObject of this.createFunctions(name, type, [sourceFile, member], newOverrides)) {
								functionObject.addFlags(Flags.Static);
								classObject.addMember(functionObject, Visibility.Public);
							}
						} else if (ts.isPropertySignature(member)) {
							const [realName, name] = getName(sourceFile, member.name);
							const variableObject = this.createVariable(name, type, [sourceFile, member], TypeQualifier.Pointer, newOverrides);
							variableObject.addFlags(Flags.Static);
							classObject.addMember(variableObject, Visibility.Public);
						} else if (ts.isConstructSignatureDeclaration(member)) {
							for (const functionObject of this.createFunctions(classObject.getName(), type, [sourceFile, member], newOverrides)) {
								classObject.addMember(functionObject, Visibility.Public);
							}
						}
					}
				}
			}
		}

		classObject.removeDuplicates();
	}

	public addNode(name: string, node: Node, namespace?: Namespace): void {
		const interfaceDeclarations = node.getInterfaceDeclarations();
		const functionDeclaration = node.getFunctionDeclaration();
		const variableDeclaration = node.getVariableDeclaration();
		const typeAliasDeclaration = node.getTypeAliasDeclaration();
		const typeAliasObject = node.getTypeAliasObject();
		const classObject = node.getClassObject();

		if (classObject) {
			this.addClass(node, classObject, new Map);
			classObject.setParent(namespace);
			classObject.computeReferences();
		} else if (functionDeclaration) {
			for (const functionObject of this.createFunctions(name, node, functionDeclaration, new Map, namespace)) {
				this.file.addGlobal(functionObject);
			}
		} else if (typeAliasDeclaration && typeAliasObject) {
			this.addTypeAlias(node, typeAliasDeclaration, typeAliasObject, new Map);
			typeAliasObject.setParent(namespace);
			this.file.addGlobal(typeAliasObject);
		} else if (variableDeclaration) {
			const variableObject = this.createVariable(name, node, variableDeclaration, TypeQualifier.Reference, new Map, namespace);
			variableObject.addFlags(Flags.Extern);

			/*
			if (!variableObject.getType().isVoid()) {
				this.file.addGlobal(variableObject);
			}
			*/
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
