import { Namespace, Flags } from "./namespace.js";
import { Declaration, TemplateDeclaration } from "./declaration.js";
import { Class, Visibility } from "./class.js";
import { Function } from "./function.js";
import { Variable } from "./variable.js";
import { TypeAlias } from "./typeAlias.js";
import { Library } from "./library.js";
import { Expression, ValueExpression, ExpressionKind, Type, NamedType, DeclaredType, TemplateType, UnqualifiedType } from "./type.js";
import { escapeName } from "./name.js";
import { TypeInfo, TypeKind } from "./typeInfo.js";
import { addExtensions } from "./extensions.js";
import * as ts from "typescript";

const VOID_TYPE = new NamedType("void");
const BOOL_TYPE = new NamedType("bool");
const DOUBLE_TYPE = new NamedType("double");
const ELLIPSES = new NamedType("...");
const TYPES_EMPTY: Map<ts.Type, Type> = new Map;

class Node {
	public readonly children: Map<string, Child> = new Map;

	public get(name: string): Child {
		let node = this.children.get(name);

		if (!node) {
			node = new Child(name);
			this.children.set(name, node);
		}

		return node;
	}
}

class Child extends Node {
	public readonly name: string
	public readonly interfaceDecls: Array<ts.InterfaceDeclaration> = new Array;
	public funcDecl?: ts.FunctionDeclaration;
	public varDecl?: ts.VariableDeclaration;
	public typeDecl?: ts.TypeAliasDeclaration;
	public classObj?: Class;
	public typeObj?: TypeAlias;

	public constructor(name: string) {
		super();
		this.name = name;
	}
}

type BuiltinType = {
	classObj?: Class,
	type: Type,
};

type TypeMap = Map<ts.Type, Type>;
type FuncDecl = ts.SignatureDeclarationBase;
type VarDecl = ts.VariableDeclaration | ts.PropertySignature;
type TypeDecl = ts.TypeAliasDeclaration;
type TypeParamDecl = ts.TypeParameterDeclaration;

export class Parser {
	private readonly typeChecker: ts.TypeChecker;
	private readonly root: Node = new Node;
	private readonly declaredTypes: TypeMap = new Map;
	private readonly declaredTemplateTypes: TypeMap = new Map;
	private readonly library: Library;
	public readonly objectBuiltin: BuiltinType;
	public readonly stringBuiltin: BuiltinType;
	public readonly bigintBuiltin: BuiltinType;
	public readonly symbolBuiltin: BuiltinType;
	public readonly arrayElementTypeHelper: UnqualifiedType;

	public constructor(program: ts.Program, library: Library) {
		this.library = library;
		this.library.addGlobalInclude("type_traits", true);
		this.library.addGlobalInclude("jshelper.h", false);
		this.typeChecker = program.getTypeChecker();
		const namespace = new Namespace("client");
		namespace.addAttribute("cheerp::genericjs");

		for (const sourceFile of program.getSourceFiles()) {
			this.discover(this.root, sourceFile);
		}

		this.objectBuiltin = this.getBuiltinType("Object");
		this.stringBuiltin = this.getBuiltinType("String", this.objectBuiltin);
		this.bigintBuiltin = this.getBuiltinType("BigInt", this.objectBuiltin);
		this.symbolBuiltin = this.getBuiltinType("Symbol", this.objectBuiltin);
		this.arrayElementTypeHelper = new NamedType("cheerp::ArrayElementTypeT");
		this.generate(this.root, namespace);
		this.library.removeDuplicates();

		if (this.objectBuiltin.classObj) {
			this.objectBuiltin.classObj.addAttribute("cheerp::client_layout");
		}
	}

	public getLibrary(): Library {
		return this.library;
	}

	private getBuiltinType(name: string, object?: BuiltinType): BuiltinType {
		const child = this.root.children.get(name);

		if (child && child.classObj) {
			return {
				classObj: child.classObj,
				type: new DeclaredType(child.classObj),
			};
		} else if (object) {
			return object;
		} else {
			return {
				type: new NamedType(`client::${name}`),
			};
		}
	}

	private getTypeParameter(type: ts.TypeParameter, id: number): NamedType {
		let result = this.declaredTypes.get(type);

		if (!result) {
			result = new NamedType(`_T${id}`);
			this.declaredTypes.set(type, result);
		}

		return result as NamedType;
	}

	private discover(self: Node, parent: ts.Node): void {
		ts.forEachChild(parent, node => {
			if (ts.isInterfaceDeclaration(node)) {
				const name = escapeName(node.name.getText());
				const child = self.get(name);
				child.interfaceDecls.push(node);

				if (!child.classObj) {
					const type = this.typeChecker.getTypeAtLocation(node);
					child.classObj = new Class(name);
					this.declaredTypes.set(type, new DeclaredType(child.classObj));
				}
			} else if (ts.isFunctionDeclaration(node)) {
				const name = escapeName(node.name!.getText());
				const child = self.get(name);
				child.funcDecl = node;
			} else if (ts.isVariableStatement(node)) {
				for (const decl of node.declarationList.declarations) {
					const name = escapeName(decl.name.getText());
					const child = self.get(name);
					child.varDecl = decl;
				}
			} else if (ts.isTypeAliasDeclaration(node)) {
				const name = escapeName(node.name.getText());
				const child = self.get(name);
				child.typeDecl = node;
				child.typeObj = new TypeAlias(name, VOID_TYPE);
			} else if (ts.isModuleDeclaration(node)) {
				const name = escapeName(node.name.getText());
				const child = self.get(name);
				this.discover(child, node.body!);
			}
		});
	}

	private addTypeInfo(type: ts.Type, types: TypeMap, info: TypeInfo): void {
		// TODO: type literals and literal types

		const declaredTemplateType = this.declaredTemplateTypes.get(type);
		const declaredType = types.get(type) ?? this.declaredTypes.get(type);

		if (declaredTemplateType) {
			info.addType(declaredTemplateType, TypeKind.Class);
		} else if (declaredType && type.isTypeParameter()) {
			info.addType(declaredType, TypeKind.Generic);
		} else if (declaredType && type.isClassOrInterface()) {
			if (type.typeParameters && type.typeParameters.length > 0) {
				const templateType = new TemplateType(declaredType);
				this.declaredTemplateTypes.set(type, templateType);

				for (const typeParam of type.typeParameters) {
					const info = this.getTypeInfo(typeParam, types);
					templateType.addTypeParameter(info.asTypeParameter());
				}

				info.addType(templateType, TypeKind.Class);
			} else {
				info.addType(declaredType, TypeKind.Class);
			}
		} else if (declaredType) {
			info.addType(declaredType, TypeKind.Class);
		} else if (type.flags & ts.TypeFlags.Undefined) {
			info.setOptional();
		} else if (type.flags & ts.TypeFlags.Any) {
			info.addType(new NamedType("client::_Any"), TypeKind.Class);
			info.setOptional();
		} else if (type.flags & ts.TypeFlags.VoidLike) {
			info.addType(VOID_TYPE, TypeKind.Primitive);
		} else if (type.flags & ts.TypeFlags.NumberLike) {
			info.addType(DOUBLE_TYPE, TypeKind.Primitive);
		} else if (type.flags & ts.TypeFlags.BooleanLike) {
			info.addType(BOOL_TYPE, TypeKind.Primitive);
		} else if (type.flags & ts.TypeFlags.StringLike) {
			info.addType(this.stringBuiltin.type, TypeKind.Class);
		} else  if (type.flags & ts.TypeFlags.BigIntLike) {
			info.addType(this.bigintBuiltin.type, TypeKind.Class);
		} else if (type.flags & ts.TypeFlags.ESSymbolLike) {
			info.addType(this.symbolBuiltin.type, TypeKind.Class);
		} else if (type.isUnion()) {
			for (const inner of type.types) {
				this.addTypeInfo(inner, types, info);
			}
		} else if (type.flags & ts.TypeFlags.Object) {
			const objectType = type as ts.ObjectType;

			if (objectType.objectFlags & ts.ObjectFlags.Reference) {
				const typeRef = objectType as ts.TypeReference;
				const target = this.declaredTypes.get(typeRef.target);

				if (!target) {
					info.addType(this.objectBuiltin.type, TypeKind.Class);
					return;
				}

				const templateType = new TemplateType(target);
				this.declaredTemplateTypes.set(type, templateType);

				for (const typeArg of this.typeChecker.getTypeArguments(typeRef)) {
					const info = this.getTypeInfo(typeArg, types);
					templateType.addTypeParameter(info.asTypeParameter());
				}
		
				info.addType(templateType, TypeKind.Class);
			} else {
				info.addType(this.objectBuiltin.type, TypeKind.Class);
			}
		} else {
			info.addType(this.objectBuiltin.type, TypeKind.Class);
		}
	}

	private getTypeInfo(type: ts.Type, types: TypeMap): TypeInfo {
		const info = new TypeInfo(this);
		this.addTypeInfo(type, types, info);
		return info;
	}

	private getTypeNodeInfo(node: ts.TypeNode, types: TypeMap): TypeInfo {
		const type = this.typeChecker.getTypeFromTypeNode(node);
		return this.getTypeInfo(type, types);
	}

	private getSymbol(type: ts.Type, types: TypeMap): [ts.Symbol, TypeMap] {
		if (type.flags & ts.TypeFlags.Object) {
			const objectType = type as ts.ObjectType;

			if (objectType.objectFlags & ts.ObjectFlags.Reference) {
				const typeRef = objectType as ts.TypeReference;
				const typeArgs = this.typeChecker.getTypeArguments(typeRef);
				const result = new Map;

				for (let i = 0; i < typeArgs.length; i++) {
					const typeParameter = typeRef.target.typeParameters![i];
					const info = this.getTypeInfo(typeArgs[i], types);
					result.set(typeParameter, info.asTypeParameter());
				}

				return [typeRef.target.symbol, result];
			}
		}

		return [type.symbol, TYPES_EMPTY];
	}

	private *getConstraints(typeParameters?: ReadonlyArray<TypeParamDecl>): Generator<Expression> {
		const constraintSet = new Set;

		if (typeParameters) {
			for (const typeParameter of typeParameters) {
				const constraint = ts.getEffectiveConstraintOfTypeParameter(typeParameter);

				if (constraint) {
					const typeParamType = this.typeChecker.getTypeAtLocation(typeParameter);
					const typeParam = this.declaredTypes.get(typeParamType)!;
					const constraintInfo = this.getTypeNodeInfo(constraint, TYPES_EMPTY);
					const result = constraintInfo.asTypeConstraint(typeParam);
					const key = result.key();

					if (!constraintSet.has(key)) {
						yield result;
						constraintSet.add(key);
					}
				}
			}
		}
	}

	private getTypeConstraints(type: Type, typeParameters?: ReadonlyArray<TypeParamDecl>): Type {
		const expression = new ValueExpression(ExpressionKind.LogicalAnd);

		for (const constraint of this.getConstraints(typeParameters)) {
			expression.addChild(constraint);
		}

		if (expression.getChildren().length > 0) {
			return Type.enableIf(expression, type);
		} else {
			return type;
		}
	}

	private *createFuncs(decl: FuncDecl, types: TypeMap, typeId: number, node?: Child): Generator<Function> {
		let name, returnType;
		let params = new Array(new Array);
		let questionParams = new Array;
		const typeParams = new Array;

		if (decl.typeParameters) {
			for (const typeParameter of decl.typeParameters) {
				const type = this.typeChecker.getTypeAtLocation(typeParameter);
				typeParams.push(this.getTypeParameter(type, typeId++).getName());
			}
		}

		if (ts.isConstructSignatureDeclaration(decl)) {
			name = node!.name;
		} else {
			name = escapeName(decl.name!.getText());
			const returnInfo = this.getTypeNodeInfo(decl.type!, types);
			returnType = returnInfo.asReturnType();
		}

		if (returnType) {
			returnType = this.getTypeConstraints(returnType, decl.typeParameters);
		}

		for (const parameter of decl.parameters) {
			if (parameter.name.getText() === "this") {
				continue;
			}

			const parameterInfo = this.getTypeNodeInfo(parameter.type!, types);

			if (parameter.questionToken) {
				questionParams = questionParams.concat(params);
			}

			params = parameterInfo.asParameterTypes().flatMap(type => {
				return params.map(parameters => [...parameters, [parameter, type]]);
			});
		}

		params = params.concat(questionParams);

		for (const parameters of params) {
			const funcObj = new Function(name, returnType);
			const constraint = new ValueExpression(ExpressionKind.LogicalAnd);

			for (const typeParam of typeParams) {
				funcObj.addTypeParameter(typeParam);
			}
			
			for (const [parameter, type] of parameters) {
				const name = escapeName(parameter.name.getText());

				if (parameter.dotDotDotToken) {
					funcObj.addVariadicTypeParameter("_Args");
					const param = new NamedType("_Args");
					funcObj.addParameter(param.expand(), name);
					const argsConstraint = new ValueExpression(ExpressionKind.LogicalAnd);
					const element = new TemplateType(this.arrayElementTypeHelper);
					element.addTypeParameter(type);
					argsConstraint.addChild(Expression.isAcceptable(param, element));
					argsConstraint.addChild(ELLIPSES);
					constraint.addChild(argsConstraint);
				} else {
					funcObj.addParameter(type, name);
				}
			}

			if (returnType && constraint.getChildren().length > 0) {
				funcObj.setType(Type.enableIf(constraint, returnType));
			}

			funcObj.removeUnusedTypeParameters();
			yield funcObj;
		}
	}

	private createVar(decl: VarDecl, types: TypeMap, member: boolean): Variable {
		const name = escapeName(decl.name.getText());
		const info = this.getTypeNodeInfo(decl.type!, types);

		if (ts.isPropertySignature(decl) && decl.questionToken) {
			info.setOptional();
		}

		return new Variable(name, info.asVariableType(member));
	}

	private generateType(decl: TypeDecl, types: TypeMap, typeId: number, typeObj: TypeAlias): void {
		const info = this.getTypeNodeInfo(decl.type, types);

		if (decl.typeParameters) {
			for (const typeParameter of decl.typeParameters) {
				const type = this.typeChecker.getTypeAtLocation(typeParameter);
				typeObj.addTypeParameter(this.getTypeParameter(type, typeId++).getName());
			}
		}

		typeObj.setType(this.getTypeConstraints(info.asTypeAlias(), decl.typeParameters));
		typeObj.removeUnusedTypeParameters();
	}

	private generateConstructor(node: Child, classObj: Class, typeId: number, decl: VarDecl): void {
		const type = this.typeChecker.getTypeFromTypeNode(decl.type!);
		const [symbol, types] = this.getSymbol(type, TYPES_EMPTY);
		const members = (symbol.declarations ?? new Array)
			.filter(decl => ts.isInterfaceDeclaration(decl))
			.flatMap(decl => decl.members);

		for (const member of members) {
			if (ts.isMethodSignature(member)) {
				for (const funcObj of this.createFuncs(member, types, typeId)) {
					funcObj.addFlags(Flags.Static);
					classObj.addMember(funcObj, Visibility.Public);
				}
			} else if (ts.isConstructSignatureDeclaration(member)) {
				for (const funcObj of this.createFuncs(member, types, typeId, node)) {
					classObj.addMember(funcObj, Visibility.Public);
				}
			} else if (ts.isPropertySignature(member)) {
				const name = escapeName(member.name.getText());
				const child = node.children.get(name);

				if (child && child.classObj) {
					this.generateConstructor(child, child.classObj, typeId, member);
				} else {
					const varObj = this.createVar(member, types, true);
					varObj.addFlags(Flags.Static);
					classObj.addMember(varObj, Visibility.Public);
				}
			}
		}
	}

	private generateClass(node: Child, classObj: Class, typeId: number): void {
		if (node.interfaceDecls.length > 0) {
			const type = this.typeChecker.getTypeAtLocation(node.interfaceDecls[0]);
			const interfaceType = type as ts.InterfaceType;
			const baseTypes = this.typeChecker.getBaseTypes(interfaceType);
			const typeParameters = node.interfaceDecls
				.flatMap(decl => ts.getEffectiveTypeParameterDeclarations(decl));

			for (const baseType of baseTypes) {
				const info = this.getTypeInfo(baseType, TYPES_EMPTY);
				classObj.addBase(info.asBaseType(), Visibility.Public);
			}

			if (interfaceType.typeParameters) {
				for (const typeParameter of interfaceType.typeParameters) {
					const typeParam = this.getTypeParameter(typeParameter, typeId++);
					classObj.addTypeParameter(typeParam.getName());
				}
			}

			for (const constraint of this.getConstraints(typeParameters)) {
				classObj.addConstraint(constraint);
			}
		}

		const members = node.interfaceDecls
			.flatMap(decl => decl.members);

		for (const member of members) {
			if (ts.isMethodSignature(member)) {
				for (const funcObj of this.createFuncs(member, TYPES_EMPTY, typeId)) {
					classObj.addMember(funcObj, Visibility.Public);
				}
			} else if (ts.isPropertySignature(member)) {
				const name = escapeName(member.name.getText());
				const info = this.getTypeNodeInfo(member.type!, TYPES_EMPTY);
				const readOnly = !!member.modifiers && member.modifiers
					.some(modifier => ts.isReadonlyKeywordOrPlusOrMinusToken(modifier));

				if (member.questionToken) {
					info.setOptional();
				}

				const funcObj = new Function(`get_${name}`, info.asReturnType());
				classObj.addMember(funcObj, Visibility.Public);

				if (!readOnly) {
					for (const parameter of info.asParameterTypes()) {
						const funcObj = new Function(`set_${name}`, VOID_TYPE);
						funcObj.addParameter(parameter, name);
						classObj.addMember(funcObj, Visibility.Public);
					}
				}
			}
		}

		if (classObj.getBases().length === 0) {
			if (this.objectBuiltin.classObj !== classObj) {
				classObj.addBase(this.objectBuiltin.type, Visibility.Public);
			} else {
				classObj.addBase(new NamedType("client::_Any"), Visibility.Public);
			}
		}

		for (const child of node.children.values()) {
			if (child.classObj) {
				this.generateClass(child, child.classObj, typeId);
				classObj.addMember(child.classObj, Visibility.Public);
				this.library.addGlobal(classObj);
			} else if (child.funcDecl) {
				for (const funcObj of this.createFuncs(child.funcDecl, TYPES_EMPTY, typeId)) {
					funcObj.addFlags(Flags.Static);
					classObj.addMember(funcObj, Visibility.Public);
				}
			} else if (child.varDecl) {
				const varObj = this.createVar(child.varDecl, TYPES_EMPTY, true);
				varObj.addFlags(Flags.Static);
				classObj.addMember(varObj, Visibility.Public);
			} else if (child.typeDecl && child.typeObj) {
				this.generateType(child.typeDecl, TYPES_EMPTY, typeId, child.typeObj);
				classObj.addMember(child.typeObj, Visibility.Public);
			} else {
				child.classObj = new Class(child.name);
				this.generateClass(child, child.classObj, typeId);
				classObj.addMember(child.classObj, Visibility.Public);
				this.library.addGlobal(classObj);
			}
		}

		if (node.varDecl) {
			// TODO: use non-template version of class
			this.generateConstructor(node, classObj, typeId, node.varDecl);
		}

		// classObj.removeUnusedTypeParameters();
		classObj.removeDuplicates();
	}

	private generate(node: Node, namespace?: Namespace): void {
		for (const child of node.children.values()) {
			if (child.classObj) {
				this.generateClass(child, child.classObj, 0);
				child.classObj.setParent(namespace);
				child.classObj.computeReferences();
				this.library.addGlobal(child.classObj);
			} else if (child.funcDecl) {
				for (const funcObj of this.createFuncs(child.funcDecl, TYPES_EMPTY, 0)) {
					funcObj.setParent(namespace);
					this.library.addGlobal(funcObj);
				}
			} else if (child.varDecl) {
				const varObj = this.createVar(child.varDecl, TYPES_EMPTY, false);

				if (varObj.getType() !== VOID_TYPE) {
					varObj.setParent(namespace);
					varObj.addFlags(Flags.Extern);
					this.library.addGlobal(varObj);
				}
			} else if (child.typeDecl && child.typeObj) {
				this.generateType(child.typeDecl, TYPES_EMPTY, 0, child.typeObj);
				child.typeObj.setParent(namespace);
				this.library.addGlobal(child.typeObj);
			} else {
				this.generate(child, new Namespace(child.name, namespace));
			}
		}
	}
}

export function parse(names: ReadonlyArray<string>): Library {
	const program = ts.createProgram(names, {});
	const library = new Library("cheerp/clientlib.h");
	const jsobjectFile = library.addFile("cheerp/jsobject.h");
	const typesFile = library.addFile("cheerp/types.h");
	const clientlibFile = library.getDefaultFile();
	jsobjectFile.addName("client::Object");
	typesFile.addName("client::String");
	typesFile.addName("client::Array");
	typesFile.addName("client::Map");
	typesFile.addName("client::Number");
	typesFile.addName("client::Function");
	typesFile.addInclude("jsobject.h", false, jsobjectFile);
	clientlibFile.addInclude("types.h", false, typesFile);
	const parser = new Parser(program, library);
	addExtensions(parser);
	return library;
}
