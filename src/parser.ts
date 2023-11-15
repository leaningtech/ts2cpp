import { Namespace, Flags } from "./namespace.js";
import { Declaration, TemplateDeclaration } from "./declaration.js";
import { Class, Visibility } from "./class.js";
import { Function } from "./function.js";
import { Variable } from "./variable.js";
import { TypeAlias } from "./typeAlias.js";
import { Library } from "./library.js";
import { Expression, ValueExpression, ExpressionKind, Type, NamedType, DeclaredType, TemplateType, UnqualifiedType, FunctionType } from "./type.js";
import { VOID_TYPE, BOOL_TYPE, DOUBLE_TYPE, ANY_TYPE, FUNCTION_TYPE, ARGS, ELLIPSES } from "./types.js";
import { getName } from "./name.js";
import { TypeInfo, TypeKind } from "./typeInfo.js";
import * as ts from "typescript";

const TYPES_EMPTY: Map<ts.Type, Type> = new Map;

class Node {
	public readonly children: Map<string, Child> = new Map;

	public get(interfaceName: string, name: string, file: string): Child {
		let node = this.children.get(name);

		if (!node) {
			node = new Child(interfaceName, name, file);
			this.children.set(name, node);
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
	public file: string;

	public constructor(interfaceName: string, name: string, file: string) {
		super();
		this.interfaceName = interfaceName;
		this.name = name;
		this.file = file;
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
	public readonly functionBuiltin: BuiltinType;

	public constructor(program: ts.Program, library: Library) {
		this.library = library;
		this.library.addGlobalInclude("type_traits", true);
		this.typeChecker = program.getTypeChecker();
		const namespace = new Namespace("client");
		namespace.addAttribute("cheerp::genericjs");

		for (const sourceFile of program.getSourceFiles()) {
			this.discover(this.root, sourceFile, sourceFile.fileName);
		}

		this.objectBuiltin = this.getBuiltinType("Object");
		this.numberBuiltin = this.getBuiltinType("Number");
		this.stringBuiltin = this.getBuiltinType("String");
		this.bigintBuiltin = this.getBuiltinType("BigInt");
		this.symbolBuiltin = this.getBuiltinType("Symbol");
		this.functionBuiltin = this.getBuiltinType("Function");

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

	private includesDeclaration(node: ts.Node): boolean {
		return this.library.getTypescriptFiles().includes(node.getSourceFile().fileName);
	}

	private discover(self: Node, parent: ts.Node, file: string): void {
		ts.forEachChild(parent, node => {
			if (ts.isInterfaceDeclaration(node)) {
				const [interfaceName, name] = getName(node.name);
				const child = self.get(interfaceName, name, file);
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
				const child = self.get(interfaceName, name, file);
				child.funcDecl = node;
			} else if (ts.isVariableStatement(node)) {
				for (const decl of node.declarationList.declarations) {
					const [interfaceName, name] = getName(decl.name);
					const child = self.get(interfaceName, name, file);
					child.varDecl = decl;
				}
			} else if (ts.isTypeAliasDeclaration(node)) {
				const type = this.typeChecker.getTypeAtLocation(node);
				const [interfaceName, name] = getName(node.name);
				const child = self.get(interfaceName, name, file);
				child.typeDecl = node;
				child.basicTypeObj = new TypeAlias(name, VOID_TYPE);

				if (node.typeParameters && node.typeParameters.length > 0) {
					child.genericTypeObj = new TypeAlias(`T${name}`, VOID_TYPE);
				}
			} else if (ts.isModuleDeclaration(node)) {
				const [interfaceName, name] = getName(node.name);

				if (name === "global") {
					this.discover(this.root, node.body!, file);
				} else {
					const child = self.get(interfaceName, name, file);
					this.discover(child, node.body!, file);
				}
			} else if (ts.isClassDeclaration(node)) {
				// TODO: class declarations
			}

			// other possible nodes:
			//   ts.SyntaxKind.EndOfFileToken
			//   ts.SyntaxKind.ExportDeclaration
			//   ts.SyntaxKind.ImportDeclaration
			//   ts.SyntaxKind.ExportAssignment
			//   ts.SyntaxKind.ImportEqualsDeclaration
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
		} else if (type.getCallSignatures().length > 0) {
			// TODO: Remove non-generic overload?
			// info.addType(this.functionBuiltin.type, TypeKind.Class);

			for (const signature of type.getCallSignatures()) {
				const declaration = signature.getDeclaration();
				const returnInfo = this.getTypeNodeInfo(declaration.type!, types);
				const funcType = new FunctionType(returnInfo.asReturnType());

				for (const parameter of declaration.parameters) {
					const parameterInfo = this.getTypeNodeInfo(parameter.type!, types);
					funcType.addParameter(parameterInfo.asReturnType());
				}

				const functionType = new TemplateType(FUNCTION_TYPE);
				functionType.addTypeParameter(funcType);
				info.addType(functionType, TypeKind.Class);
			}
		} else if (basicDeclaredType) {
			info.addType(basicDeclaredType, TypeKind.Class);
		} else if (type.flags & ts.TypeFlags.Undefined) {
			info.setOptional();
		} else if (type.flags & ts.TypeFlags.Any) {
			// TODO: Use any + double + bool, is there a better alternative?
			// info.addType(ANY_TYPE, TypeKind.Class);
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
			// TODO: Improve any type
			info.addType(ANY_TYPE, TypeKind.Class);
			info.addType(DOUBLE_TYPE, TypeKind.Primitive);
			// TODO: Add bool type, improve any type?
			// info.addType(BOOL_TYPE, TypeKind.Primitive);
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

		if (ts.isThisTypeNode(node)) {
			return this.getTypeInfo(type.getConstraint()!, types);
		} else {
			return this.getTypeInfo(type, types);
		}
	}

	private usesType(parent: ts.Type, child: ts.Type, visited?: Set<ts.Type>): boolean {
		if (visited) {
			if (visited.has(parent)) {
				return false;
			} else {
				visited.add(parent);
			}
		} else {
			visited = new Set;
		}

		if (parent === child) {
			return true;
		} else if (parent.isClassOrInterface() && parent.typeParameters) {
			return parent.typeParameters
				.some(typeParameter => this.usesType(typeParameter, child, visited));
		} else if (parent.getCallSignatures().length > 0) {
			for (const signature of parent.getCallSignatures()) {
				const declaration = signature.getDeclaration();
				const type = this.typeChecker.getTypeFromTypeNode(declaration.type!);

				if (this.usesType(type, child, visited)) {
					return true;
				}

				for (const parameter of declaration.parameters) {
					const type = this.typeChecker.getTypeFromTypeNode(parameter.type!);

					if (this.usesType(type, child, visited)) {
						return true;
					}
				}
			}
		} else if (parent.isUnion()) {
			return parent.types.some(type => this.usesType(type, child, visited));
		} else if (parent.flags & ts.TypeFlags.Object) {
			const objectType = parent as ts.ObjectType;

			if (objectType.objectFlags & ts.ObjectFlags.Reference) {
				const typeRef = objectType as ts.TypeReference;

				if (this.usesType(typeRef.target, child, visited)) {
					return true;
				}

				for (const typeArg of this.typeChecker.getTypeArguments(typeRef)) {
					if (this.usesType(typeArg, child, visited)) {
						return true;
					}
				}
			}
		}

		return false;
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

	private getTypeParametersAndConstraints(types: TypeMap, typeId: number, typeParameters?: ReadonlyArray<TypeParamDecl>, returnType?: ts.Type): [ReadonlyArray<string>, ReadonlyArray<Expression>] {
		const typeParameterArray = new Array;
		const constraintArray = new Array;
		const typeSet = new Set;
		const typeParameterSet = new Set;
		const constraintSet = new Set;

		if (typeParameters) {
			for (const typeParameter of typeParameters) {
				const type = this.typeChecker.getTypeAtLocation(typeParameter);

				if (!typeSet.has(type)) {
					if (!returnType || this.usesType(returnType, type)) {
						typeParameterArray.push(this.getTypeParameter(types, type, typeId++).getName());
						typeParameterSet.add(type);
					} else {
						const constraint = ts.getEffectiveConstraintOfTypeParameter(typeParameter);

						if (constraint) {
							const constraintInfo = this.getTypeNodeInfo(constraint, types);
							types.set(type, constraintInfo.asTypeParameter()); // TODO: TypeInfoType?
						} else {
							types.set(type, ANY_TYPE.pointer());
						}
					}

					typeSet.add(type);
				}
			}

			for (const typeParameter of typeParameters) {
				const type = this.typeChecker.getTypeAtLocation(typeParameter);

				if (!typeParameterSet.has(type)) {
					continue;
				}

				const constraint = ts.getEffectiveConstraintOfTypeParameter(typeParameter);

				if (constraint) {
					const typeParamType = this.typeChecker.getTypeAtLocation(typeParameter);
					const typeParam = types.get(typeParamType)!;
					const constraintInfo = this.getTypeNodeInfo(constraint, types);
					const result = constraintInfo.asTypeConstraint(typeParam);
					const key = result.key();

					if (!constraintSet.has(key)) {
						constraintArray.push(result);
						constraintSet.add(key);
					}
				}
			}
		}

		return [typeParameterArray, constraintArray];
	}

	private makeTypeConstraint(type: Type, constraints: ReadonlyArray<Expression>): Type {
		const expression = Expression.and(...constraints);

		if (expression.getChildren().length > 0) {
			return Type.enableIf(expression, type);
		} else {
			return type;
		}
	}

	private *createFuncs(decl: FuncDecl, types: TypeMap, typeId: number, forward?: string, className?: string): Generator<Function> {
		let interfaceName, name, returnType, tsReturnType;
		let params = new Array(new Array);
		let questionParams = new Array;

		types = new Map(types);

		if (decl.type) {
			tsReturnType = this.typeChecker.getTypeFromTypeNode(decl.type);
		}

		const [typeParams, typeConstraints] = this.getTypeParametersAndConstraints(types, typeId, decl.typeParameters, tsReturnType);
		
		typeId += typeParams.length;

		if (ts.isConstructSignatureDeclaration(decl)) {
			interfaceName = className!;
			name = className!;
		} else {
			[interfaceName, name] = getName(decl.name);
			const returnInfo = this.getTypeNodeInfo(decl.type!, types);
			returnType = returnInfo.asReturnType();
		}

		if (returnType) {
			returnType = this.makeTypeConstraint(returnType, typeConstraints);
		}

		// TODO: use default values for optional parameters across multiple declarations

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
					const element = Type.arrayElementType(type);
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
			const [typeParams, typeConstraints] = this.getTypeParametersAndConstraints(types, typeId, decl.typeParameters);

			typeId += typeParams.length;

			for (const typeParam of typeParams) {
				typeObj.addTypeParameter(typeParam);
			}

			typeObj.setType(this.makeTypeConstraint(info.asTypeAlias(), typeConstraints));
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
			.filter(decl => this.includesDeclaration(decl))
			.flatMap(decl => decl.members);

		for (const member of members) {
			if (ts.isMethodSignature(member)) {
				for (const funcObj of this.createFuncs(member, types, typeId, forward)) {
					funcObj.setFile(node.file);
					funcObj.addFlags(Flags.Static);
					classObj.addMember(funcObj, Visibility.Public);
				}
			} else if (ts.isConstructSignatureDeclaration(member)) {
				for (const funcObj of this.createFuncs(member, types, typeId, forward, classObj.getName())) {
					funcObj.setFile(node.file);
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
					varObj.setFile(node.file);
					varObj.addFlags(Flags.Static);
					classObj.addMember(varObj, Visibility.Public);
				}
			}
		}
	}

	private generateClass(node: Child, classObj: Class, types: TypeMap, typeId: number, generic: boolean, parent?: Namespace): void {
		if (node.interfaceDecls.length > 0) {
			const baseTypes = new Set(
				node.interfaceDecls
					.filter(decl => this.includesDeclaration(decl))
					.map(decl => decl.heritageClauses)
					.filter((heritageClauses): heritageClauses is ts.NodeArray<ts.HeritageClause> => !!heritageClauses)
					.flat()
					.flatMap(heritageClause => heritageClause.types)
					.map(type => this.typeChecker.getTypeAtLocation(type))
			);

			types = new Map(types);

			for (const baseType of baseTypes) {
				const info = this.getTypeInfo(baseType, types);
				classObj.addBase(info.asBaseType(), Visibility.Public);
			}

			if (generic) {
				const typeParameters = node.interfaceDecls
					.filter(decl => this.includesDeclaration(decl))
					.flatMap(decl => ts.getEffectiveTypeParameterDeclarations(decl));

				const [typeParams, typeConstraints] = this.getTypeParametersAndConstraints(types, typeId, typeParameters);

				typeId += typeParams.length;

				for (const typeParam of typeParams) {
					classObj.addTypeParameter(typeParam);
				}

				for (const constraint of typeConstraints) {
					classObj.addConstraint(constraint);
				}
			}
		}

		const forward = generic ? node.name : undefined;

		const members = node.interfaceDecls
			.filter(decl => this.includesDeclaration(decl))
			.flatMap(decl => decl.members);

		for (const member of members) {
			// TODO: implement index signatures

			if (ts.isMethodSignature(member)) {
				for (const funcObj of this.createFuncs(member, types, typeId, forward)) {
					funcObj.setFile(node.file);
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
				funcObj.setInterfaceName(`get_${interfaceName}`);
				funcObj.setFile(node.file);
				classObj.addMember(funcObj, Visibility.Public);

				if (!readOnly) {
					for (const parameter of info.asParameterTypes()) {
						const funcObj = new Function(`set_${name}`, VOID_TYPE);
						funcObj.setInterfaceName(`set_${interfaceName}`);
						funcObj.addParameter(parameter, name);
						funcObj.setFile(node.file);
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
					funcObj.setFile(child.file);
					funcObj.addFlags(Flags.Static);
					classObj.addMember(funcObj, Visibility.Public);
				}
			} else if (child.varDecl) {
				const varObj = this.createVar(child.varDecl, types, true);
				varObj.setFile(child.file);
				varObj.addFlags(Flags.Static);
				classObj.addMember(varObj, Visibility.Public);
			} else if (child.typeDecl && child.basicTypeObj) {
				if (!generic) {
					this.generateType(child.typeDecl, types, typeId, child.basicTypeObj, false);
					child.basicTypeObj.setFile(child.file);
					classObj.addMember(child.basicTypeObj, Visibility.Public);

					if (child.genericTypeObj) {
						this.generateType(child.typeDecl, types, typeId, child.genericTypeObj, true);
						child.genericTypeObj.setFile(child.file);
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
				const varObj = this.createVar(node.varDecl, types, false);
				varObj.setFile(node.file);
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
		classObj.setFile(node.file);
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
					funcObj.setFile(child.file);
					this.library.addGlobal(funcObj);
				}
			} else if (child.varDecl) {
				const varObj = this.createVar(child.varDecl, TYPES_EMPTY, false);

				if (varObj.getType() !== VOID_TYPE) {
					varObj.setParent(namespace);
					varObj.addFlags(Flags.Extern);
					varObj.setFile(child.file);
					this.library.addGlobal(varObj);
				}

				if (child.children.size > 0) {
					// TODO: merge with variable declaration?
					this.generate(child, new Namespace(child.name + "_", namespace));
				}
			} else if (child.typeDecl && child.basicTypeObj) {
				this.generateType(child.typeDecl, TYPES_EMPTY, 0, child.basicTypeObj, false);
				child.basicTypeObj.setParent(namespace);
				child.basicTypeObj.setFile(child.file);
				this.library.addGlobal(child.basicTypeObj);

				if (child.genericTypeObj) {
					this.generateType(child.typeDecl, TYPES_EMPTY, 0, child.genericTypeObj, true);
					child.genericTypeObj.setParent(namespace);
					child.genericTypeObj.setFile(child.file);
					this.library.addGlobal(child.genericTypeObj);
				}
			} else {
				this.generate(child, new Namespace(child.name, namespace));
			}
		}
	}
}
