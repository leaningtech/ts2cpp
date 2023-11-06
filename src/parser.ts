import { Namespace, Flags } from "./namespace.js";
import { Declaration, TemplateDeclaration } from "./declaration.js";
import { Class, Visibility } from "./class.js";
import { Function } from "./function.js";
import { Variable } from "./variable.js";
import { TypeAlias } from "./typeAlias.js";
import { Library } from "./library.js";
import { Expression, ValueExpression, ExpressionKind, Type, NamedType, DeclaredType, TemplateType, UnqualifiedType } from "./type.js";
import { VOID_TYPE, BOOL_TYPE, DOUBLE_TYPE, ARRAY_ELEMENT_TYPE, ANY_TYPE, ARGS, ELLIPSES } from "./types.js";
import { getName } from "./name.js";
import { TypeInfo, TypeKind } from "./typeInfo.js";
import * as ts from "typescript";

const TYPES_EMPTY: Map<ts.Type, Type> = new Map;

class Node {
	public readonly children: Map<string, Child> = new Map;

	public get(interfaceName: string, name: string, sourceFile: ts.SourceFile): Child {
		let node = this.children.get(name);

		if (!node) {
			node = new Child(interfaceName, name);
			this.children.set(name, node);
		}

		if (sourceFile.hasNoDefaultLib) {
			node.defaultLib = true;
		}

		return node;
	}
}

class Child extends Node {
	public readonly interfaceName: string;
	public readonly name: string;
	public readonly interfaceDecls: Array<ts.InterfaceDeclaration> = new Array;
	public funcDecl?: ts.FunctionDeclaration;
	public varDecl?: ts.VariableDeclaration;
	public typeDecl?: ts.TypeAliasDeclaration;
	public basicClassObj?: Class;
	public genericClassObj?: Class;
	public basicTypeObj?: TypeAlias;
	public genericTypeObj?: TypeAlias;
	public type?: ts.Type;
	public defaultLib: boolean = false;

	public constructor(interfaceName: string, name: string) {
		super();
		this.interfaceName = interfaceName;
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
	private readonly basicDeclaredTypes: TypeMap = new Map;
	private readonly genericDeclaredTypes: TypeMap = new Map;
	private readonly templateDeclaredTypes: TypeMap = new Map;
	private readonly classes: Array<Class> = new Array;
	private readonly library: Library;
	public readonly objectBuiltin: BuiltinType;
	public readonly numberBuiltin: BuiltinType;
	public readonly stringBuiltin: BuiltinType;
	public readonly bigintBuiltin: BuiltinType;
	public readonly symbolBuiltin: BuiltinType;

	public constructor(program: ts.Program, library: Library) {
		this.library = library;
		this.library.addGlobalInclude("type_traits", true);
		this.typeChecker = program.getTypeChecker();
		const namespace = new Namespace("client");
		namespace.addAttribute("cheerp::genericjs");

		for (const sourceFile of program.getSourceFiles()) {
			this.discover(this.root, sourceFile, sourceFile);
		}

		this.objectBuiltin = this.getBuiltinType("Object");
		this.numberBuiltin = this.getBuiltinType("Number");
		this.stringBuiltin = this.getBuiltinType("String");
		this.bigintBuiltin = this.getBuiltinType("BigInt");
		this.symbolBuiltin = this.getBuiltinType("Symbol");

		this.generate(this.root, namespace);
		this.library.removeDuplicates();

		for (const declaration of this.classes) {
			declaration.computeVirtualBaseClasses();
		}

		if (this.objectBuiltin.classObj) {
			this.objectBuiltin.classObj.addAttribute("cheerp::client_layout");
		}
	}

	public getLibrary(): Library {
		return this.library;
	}

	public getClasses(): ReadonlyArray<Class> {
		return this.classes;
	}

	public getRootClass(name: string): Class | undefined {
		const child = this.root.children.get(name);

		if (child && child.basicClassObj) {
			return child.basicClassObj;
		}
	}

	private getBuiltinType(name: string): BuiltinType {
		const child = this.root.children.get(name);

		if (child && child.basicClassObj) {
			return {
				classObj: child.basicClassObj,
				type: new DeclaredType(child.basicClassObj),
			};
		} else {
			return {
				type: new NamedType(`client::${name}`),
			};
		}
	}

	private getTypeParameter(types: TypeMap, type: ts.TypeParameter, id: number): NamedType {
		let result = types.get(type);

		if (!result) {
			result = new NamedType(`_T${id}`);
			types.set(type, result);
		}

		return result as NamedType;
	}

	private discover(self: Node, parent: ts.Node, sourceFile: ts.SourceFile): void {
		ts.forEachChild(parent, node => {
			if (ts.isInterfaceDeclaration(node)) {
				const [interfaceName, name] = getName(node.name);
				const child = self.get(interfaceName, name, sourceFile);
				child.interfaceDecls.push(node);

				if (!child.basicClassObj) {
					child.type = this.typeChecker.getTypeAtLocation(node);
					const interfaceType = child.type as ts.InterfaceType;
					child.basicClassObj = new Class(name);
					const basicClassType = new DeclaredType(child.basicClassObj);
					this.basicDeclaredTypes.set(child.type, basicClassType);

					if (interfaceType.typeParameters && interfaceType.typeParameters.length > 0) {
						child.genericClassObj = new Class(`T${name}`);
						child.genericClassObj.addBase(basicClassType, Visibility.Public);
						this.genericDeclaredTypes.set(child.type, new DeclaredType(child.genericClassObj));
					}
				}
			} else if (ts.isFunctionDeclaration(node)) {
				const [interfaceName, name] = getName(node.name!);
				const child = self.get(interfaceName, name, sourceFile);
				child.funcDecl = node;
			} else if (ts.isVariableStatement(node)) {
				for (const decl of node.declarationList.declarations) {
					const [interfaceName, name] = getName(decl.name);
					const child = self.get(interfaceName, name, sourceFile);
					child.varDecl = decl;
				}
			} else if (ts.isTypeAliasDeclaration(node)) {
				const type = this.typeChecker.getTypeAtLocation(node);
				const [interfaceName, name] = getName(node.name);
				const child = self.get(interfaceName, name, sourceFile);
				child.typeDecl = node;
				child.basicTypeObj = new TypeAlias(name, VOID_TYPE);

				if (node.typeParameters && node.typeParameters.length > 0) {
					child.genericTypeObj = new TypeAlias(`T${name}`, VOID_TYPE);
				}
			} else if (ts.isModuleDeclaration(node)) {
				const [interfaceName, name] = getName(node.name);
				const child = self.get(interfaceName, name, sourceFile);
				this.discover(child, node.body!, sourceFile);
			}
		});
	}

	private addTypeInfo(type: ts.Type, types: TypeMap, info: TypeInfo): void {
		// TODO: type literals

		const basicDeclaredType = types.get(type) ?? this.basicDeclaredTypes.get(type);
		const genericDeclaredType = this.genericDeclaredTypes.get(type);
		const templateDeclaredType = this.templateDeclaredTypes.get(type);

		if (templateDeclaredType) {
			info.addType(templateDeclaredType, TypeKind.Class);
		} else if (basicDeclaredType && type.isTypeParameter()) {
			info.addType(basicDeclaredType, TypeKind.Generic);
		} else if (genericDeclaredType && type.isClassOrInterface()) {
			const templateType = new TemplateType(genericDeclaredType);
			this.templateDeclaredTypes.set(type, templateType);

			if (type.typeParameters) {
				for (const typeParam of type.typeParameters) {
					const info = this.getTypeInfo(typeParam, types);
					templateType.addTypeParameter(info.asTypeParameter());
				}
			}

			info.addType(templateType, TypeKind.Class);
		} else if (basicDeclaredType && type.isClassOrInterface()) {
			info.addType(basicDeclaredType, TypeKind.Class);
		} else if (basicDeclaredType) {
			info.addType(basicDeclaredType, TypeKind.Class);
		} else if (type.flags & ts.TypeFlags.Undefined) {
			info.setOptional();
		} else if (type.flags & ts.TypeFlags.Any) {
			info.addType(this.objectBuiltin.type, TypeKind.Class);
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
				const target = this.genericDeclaredTypes.get(typeRef.target);

				if (!target) {
					const target = this.basicDeclaredTypes.get(typeRef.target) ?? this.objectBuiltin.type;
					info.addType(target, TypeKind.Class);
					return;
				}

				const templateType = new TemplateType(target);
				this.templateDeclaredTypes.set(type, templateType);

				for (const typeArg of this.typeChecker.getTypeArguments(typeRef)) {
					const info = this.getTypeInfo(typeArg, types);
					templateType.addTypeParameter(info.asTypeParameter());
				}
		
				info.addType(templateType, TypeKind.Class);
			} else {
				info.addType(this.objectBuiltin.type, TypeKind.Class);
			}
		} else if (type.isTypeParameter()) {
			info.addType(ANY_TYPE, TypeKind.Class);
			info.addType(DOUBLE_TYPE, TypeKind.Primitive);
			info.setOptional();
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

	private getSymbol(type: ts.Type, types: TypeMap): [ts.Symbol | undefined, TypeMap] {
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

				return [typeRef.target.getSymbol(), result];
			}
		}

		return [type.getSymbol(), TYPES_EMPTY];
	}

	private *getConstraints(types: TypeMap, typeParameters?: ReadonlyArray<TypeParamDecl>): Generator<Expression> {
		const constraintSet = new Set;

		if (typeParameters) {
			for (const typeParameter of typeParameters) {
				const constraint = ts.getEffectiveConstraintOfTypeParameter(typeParameter);

				if (constraint) {
					const typeParamType = this.typeChecker.getTypeAtLocation(typeParameter);
					const typeParam = types.get(typeParamType)!;
					const constraintInfo = this.getTypeNodeInfo(constraint, types);
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

	private getTypeConstraints(type: Type, types: TypeMap, typeParameters?: ReadonlyArray<TypeParamDecl>): Type {
		const expression = new ValueExpression(ExpressionKind.LogicalAnd);

		for (const constraint of this.getConstraints(types, typeParameters)) {
			expression.addChild(constraint);
		}

		if (expression.getChildren().length > 0) {
			return Type.enableIf(expression, type);
		} else {
			return type;
		}
	}

	private *createFuncs(decl: FuncDecl, types: TypeMap, typeId: number, forward?: string, className?: string): Generator<Function> {
		let interfaceName, name, returnType;
		let params = new Array(new Array);
		let questionParams = new Array;
		const typeParams = new Array;

		types = new Map(types);

		if (decl.typeParameters) {
			for (const typeParameter of decl.typeParameters) {
				const type = this.typeChecker.getTypeAtLocation(typeParameter);
				typeParams.push(this.getTypeParameter(types, type, typeId++).getName());
			}
		}

		if (ts.isConstructSignatureDeclaration(decl)) {
			interfaceName = className!;
			name = className!;
		} else {
			[interfaceName, name] = getName(decl.name);
			const returnInfo = this.getTypeNodeInfo(decl.type!, types);
			returnType = returnInfo.asReturnType();
		}

		if (returnType) {
			returnType = this.getTypeConstraints(returnType, types, decl.typeParameters);
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
			funcObj.setInterfaceName(interfaceName);
			const constraint = new ValueExpression(ExpressionKind.LogicalAnd);
			const forwardParameters = [];

			for (const typeParam of typeParams) {
				funcObj.addTypeParameter(typeParam);
			}
			
			for (const [parameter, type] of parameters) {
				const [interfaceName, name] = getName(parameter.name);

				if (parameter.dotDotDotToken) {
					funcObj.addVariadicTypeParameter("_Args");
					const param = ARGS;
					funcObj.addParameter(param.expand(), name);
					const argsConstraint = new ValueExpression(ExpressionKind.LogicalAnd);
					const element = new TemplateType(ARRAY_ELEMENT_TYPE);
					element.addTypeParameter(type);
					argsConstraint.addChild(Expression.isAcceptable(param, element));
					argsConstraint.addChild(ELLIPSES);
					constraint.addChild(argsConstraint);
					forwardParameters.push(name + "...");
				} else {
					funcObj.addParameter(type, name);
					forwardParameters.push(name);
				}
			}

			if (returnType && constraint.getChildren().length > 0) {
				funcObj.setType(Type.enableIf(constraint, returnType));
			}

			// TODO: forward static methods as well

			if (forward && ts.isConstructSignatureDeclaration(decl)) {
				const params = forwardParameters.join(", ");
				funcObj.addInitializer(forward, params);
				funcObj.setBody(``);
			}

			funcObj.removeUnusedTypeParameters();
			yield funcObj;
		}
	}

	private createVar(decl: VarDecl, types: TypeMap, member: boolean): Variable {
		const [interfaceName, name] = getName(decl.name);
		const info = this.getTypeNodeInfo(decl.type!, types);

		if (ts.isPropertySignature(decl) && decl.questionToken) {
			info.setOptional();
		}

		return new Variable(name, info.asVariableType(member));
	}

	private generateType(decl: TypeDecl, types: TypeMap, typeId: number, typeObj: TypeAlias, generic: boolean): void {
		const info = this.getTypeNodeInfo(decl.type, types);

		types = new Map(types);

		if (generic) {
			if (decl.typeParameters) {
				for (const typeParameter of decl.typeParameters) {
					const type = this.typeChecker.getTypeAtLocation(typeParameter);
					typeObj.addTypeParameter(this.getTypeParameter(types, type, typeId++).getName());
				}
			}

			typeObj.setType(this.getTypeConstraints(info.asTypeAlias(), types, decl.typeParameters));
		} else {
			typeObj.setType(info.asTypeAlias());
		}

		typeObj.removeUnusedTypeParameters();
	}

	private generateConstructor(node: Child, classObj: Class, classTypes: TypeMap, typeId: number, decl: VarDecl, generic: boolean): void {
		const forward = generic ? node.name : undefined;
		const type = this.typeChecker.getTypeFromTypeNode(decl.type!);
		const [symbol, types] = this.getSymbol(type, classTypes);
		const members = (symbol?.declarations ?? new Array)
			.filter(decl => ts.isInterfaceDeclaration(decl))
			.flatMap(decl => decl.members);

		for (const member of members) {
			if (ts.isMethodSignature(member)) {
				for (const funcObj of this.createFuncs(member, types, typeId, forward)) {
					funcObj.setDefaultLib(node.defaultLib);
					funcObj.addFlags(Flags.Static);
					classObj.addMember(funcObj, Visibility.Public);
				}
			} else if (ts.isConstructSignatureDeclaration(member)) {
				for (const funcObj of this.createFuncs(member, types, typeId, forward, classObj.getName())) {
					funcObj.setDefaultLib(node.defaultLib);
					classObj.addMember(funcObj, Visibility.Public);
				}
			} else if (ts.isPropertySignature(member)) {
				const [interfaceName, name] = getName(member.name);
				const child = node.children.get(name);

				if (child && child.basicClassObj) {
					if (!generic) {
						this.generateConstructor(child, child.basicClassObj, types, typeId, member, false);
						
						if (child.genericClassObj) {
							this.generateConstructor(child, child.genericClassObj, types, typeId, member, true);
						}
					}
				} else {
					const varObj = this.createVar(member, types, true);
					varObj.setDefaultLib(node.defaultLib);
					varObj.addFlags(Flags.Static);
					classObj.addMember(varObj, Visibility.Public);
				}
			}
		}
	}

	private generateClass(node: Child, classObj: Class, types: TypeMap, typeId: number, generic: boolean, parent?: Namespace): void {
		if (node.interfaceDecls.length > 0) {
			const type = this.typeChecker.getTypeAtLocation(node.interfaceDecls[0]);
			const interfaceType = type as ts.InterfaceType;
			const baseTypes = this.typeChecker.getBaseTypes(interfaceType);

			types = new Map(types);

			for (const baseType of baseTypes) {
				const info = this.getTypeInfo(baseType, types);
				classObj.addBase(info.asBaseType(), Visibility.Public);
			}

			if (generic) {
				const typeParameters = node.interfaceDecls
					.flatMap(decl => ts.getEffectiveTypeParameterDeclarations(decl));

				if (interfaceType.typeParameters) {
					for (const typeParameter of interfaceType.typeParameters) {
						const typeParam = this.getTypeParameter(types, typeParameter, typeId++);
						classObj.addTypeParameter(typeParam.getName());
					}
				}

				for (const constraint of this.getConstraints(types, typeParameters)) {
					classObj.addConstraint(constraint);
				}
			}
		}

		const forward = generic ? node.name : undefined;
		const members = node.interfaceDecls.flatMap(decl => decl.members);

		for (const member of members) {
			if (ts.isMethodSignature(member)) {
				for (const funcObj of this.createFuncs(member, types, typeId, forward)) {
					funcObj.setDefaultLib(node.defaultLib);
					classObj.addMember(funcObj, Visibility.Public);
				}
			} else if (ts.isPropertySignature(member)) {
				const [interfaceName, name] = getName(member.name);
				const info = this.getTypeNodeInfo(member.type!, types);
				const readOnly = !!member.modifiers && member.modifiers
					.some(modifier => ts.isReadonlyKeywordOrPlusOrMinusToken(modifier));

				if (member.questionToken) {
					info.setOptional();
				}

				const funcObj = new Function(`get_${name}`, info.asReturnType());
				funcObj.setDefaultLib(node.defaultLib);
				classObj.addMember(funcObj, Visibility.Public);

				if (!readOnly) {
					for (const parameter of info.asParameterTypes()) {
						const funcObj = new Function(`set_${name}`, VOID_TYPE);
						funcObj.addParameter(parameter, name);
						funcObj.setDefaultLib(node.defaultLib);
						classObj.addMember(funcObj, Visibility.Public);
					}
				}
			}
		}


		if (classObj.getBases().length === 0) {
			if (this.objectBuiltin.classObj !== classObj) {
				// TODO: automatically find an appropriate base class
				classObj.addBase(this.objectBuiltin.type, Visibility.Public);
			} else {
				classObj.addBase(ANY_TYPE, Visibility.Public);
			}
		}

		for (const child of node.children.values()) {
			if (child.basicClassObj) {
				if (!generic) {
					this.generateClass(child, child.basicClassObj, types, typeId, false, classObj);
					classObj.addMember(child.basicClassObj, Visibility.Public);
					this.library.addGlobal(child.basicClassObj);

					if (child.genericClassObj) {
						this.generateClass(child, child.genericClassObj, types, typeId, true, classObj);
						classObj.addMember(child.genericClassObj, Visibility.Public);
						this.library.addGlobal(child.genericClassObj);
					}
				}
			} else if (child.funcDecl) {
				for (const funcObj of this.createFuncs(child.funcDecl, types, typeId, forward)) {
					funcObj.setDefaultLib(child.defaultLib);
					funcObj.addFlags(Flags.Static);
					classObj.addMember(funcObj, Visibility.Public);
				}
			} else if (child.varDecl) {
				const varObj = this.createVar(child.varDecl, types, true);
				varObj.setDefaultLib(child.defaultLib);
				varObj.addFlags(Flags.Static);
				classObj.addMember(varObj, Visibility.Public);
			} else if (child.typeDecl && child.basicTypeObj) {
				if (!generic) {
					this.generateType(child.typeDecl, types, typeId, child.basicTypeObj, false);
					classObj.addMember(child.basicTypeObj, Visibility.Public);

					if (child.genericTypeObj) {
						this.generateType(child.typeDecl, types, typeId, child.genericTypeObj, true);
						classObj.addMember(child.genericTypeObj, Visibility.Public);
					}
				}
			} else if (!generic) {
				child.basicClassObj = new Class(child.name);
				this.generateClass(child, child.basicClassObj, types, typeId, false, classObj);
				classObj.addMember(child.basicClassObj, Visibility.Public);
				this.library.addGlobal(child.basicClassObj);
			}
		}

		if (node.varDecl) {
			const type = this.typeChecker.getTypeFromTypeNode(node.varDecl.type!);

			if (type === node.type) {
				classObj.setName(classObj.getName() + "Class");
				const varObj = this.createVar(node.varDecl, TYPES_EMPTY, false);
				varObj.setDefaultLib(node.defaultLib);
				varObj.addFlags(Flags.Extern);

				if (parent instanceof Class) {
					parent.addMember(varObj, Visibility.Public);
				} else {
					varObj.setParent(parent);
					this.library.addGlobal(varObj);
				}
			} else {
				this.generateConstructor(node, classObj, types, typeId, node.varDecl, generic);
			}
		}

		// classObj.removeUnusedTypeParameters();
		classObj.removeDuplicates();
		classObj.setDefaultLib(node.defaultLib);
		this.classes.push(classObj);
	}

	private generate(node: Node, namespace?: Namespace): void {
		for (const child of node.children.values()) {
			if (child.basicClassObj) {
				this.generateClass(child, child.basicClassObj, TYPES_EMPTY, 0, false, namespace);
				child.basicClassObj.setParent(namespace);
				child.basicClassObj.computeReferences();
				this.library.addGlobal(child.basicClassObj);

				if (child.genericClassObj) {
					this.generateClass(child, child.genericClassObj, TYPES_EMPTY, 0, true, namespace);
					child.genericClassObj.setParent(namespace);
					child.genericClassObj.computeReferences();
					this.library.addGlobal(child.genericClassObj);
				}
			} else if (child.funcDecl) {
				for (const funcObj of this.createFuncs(child.funcDecl, TYPES_EMPTY, 0)) {
					funcObj.setParent(namespace);
					funcObj.setDefaultLib(child.defaultLib);
					this.library.addGlobal(funcObj);
				}
			} else if (child.varDecl) {
				const varObj = this.createVar(child.varDecl, TYPES_EMPTY, false);

				if (varObj.getType() !== VOID_TYPE) {
					varObj.setParent(namespace);
					varObj.addFlags(Flags.Extern);
					varObj.setDefaultLib(child.defaultLib);
					this.library.addGlobal(varObj);
				}
			} else if (child.typeDecl && child.basicTypeObj) {
				this.generateType(child.typeDecl, TYPES_EMPTY, 0, child.basicTypeObj, false);
				child.basicTypeObj.setParent(namespace);
				child.basicTypeObj.setDefaultLib(child.defaultLib);
				this.library.addGlobal(child.basicTypeObj);

				if (child.genericTypeObj) {
					this.generateType(child.typeDecl, TYPES_EMPTY, 0, child.genericTypeObj, true);
					child.genericTypeObj.setParent(namespace);
					child.genericTypeObj.setDefaultLib(child.defaultLib);
					this.library.addGlobal(child.genericTypeObj);
				}
			} else {
				this.generate(child, new Namespace(child.name, namespace));
			}
		}
	}
}
