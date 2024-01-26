import { Namespace, Flags } from "../declaration/namespace.js";
import { Declaration, TemplateDeclaration } from "../declaration/declaration.js";
import { Class, Visibility } from "../declaration/class.js";
import { Function } from "../declaration/function.js";
import { Variable } from "../declaration/variable.js";
import { TypeAlias } from "../declaration/typeAlias.js";
import { Library } from "../library.js";
import { Expression } from "../type/expression.js";
import { ELLIPSES } from "../type/literalExpression.js";
import { CompoundExpression, ExpressionKind } from "../type/compoundExpression.js";
import { Type, UnqualifiedType } from "../type/type.js";
import { NamedType, VOID_TYPE, BOOL_TYPE, DOUBLE_TYPE, ANY_TYPE, NULLPTR_TYPE, FUNCTION_TYPE, ARGS, ENABLE_IF } from "../type/namedType.js";
import { DeclaredType } from "../type/declaredType.js";
import { TemplateType } from "../type/templateType.js";
import { FunctionType } from "../type/functionType.js";
import { QualifiedType, TypeQualifier } from "../type/qualifiedType.js";
import { getName } from "./name.js";
import { TypeInfo, TypeKind } from "./typeInfo.js";
import { withTimer, options } from "../utility.js";
import { addExtensions } from "../extensions.js";
import { Node, Child } from "./node.js";
import { TypeParser } from "./typeParser.js";
import { usesType, Generics } from "./generics.js";
import { parseLibrary } from "./library.js";
import * as ts from "typescript";

type TypeMap = Map<ts.Type, Type>;
type ClassDecl = ts.InterfaceDeclaration | ts.ClassDeclaration;
type FuncDecl = ts.SignatureDeclarationBase;
type VarDecl = ts.VariableDeclaration | ts.PropertySignature | ts.PropertyDeclaration;
type TypeDecl = ts.TypeAliasDeclaration;
type TypeParamDecl = ts.TypeParameterDeclaration;

export class Parser {
	private readonly typeChecker: ts.TypeChecker;
	private readonly root: Node = new Node;
	private readonly namespace?: Namespace;
	private readonly basicDeclaredTypes: Map<ts.Type, DeclaredType> = new Map;
	private readonly genericDeclaredTypes: Map<ts.Type, DeclaredType> = new Map;
	private readonly library: Library;
	private readonly classes: Array<Class> = new Array;
	private readonly functions: Array<Function> = new Array;
	private target: number = 0;
	private progress: number = 0;

	public constructor(program: ts.Program, library: Library, defaultLib: boolean) {
		this.library = library;
		this.library.addGlobalInclude("type_traits", true);
		this.typeChecker = program.getTypeChecker();
		this.namespace = new Namespace("client");
		this.namespace.addAttribute("cheerp::genericjs");

		withTimer("discover", () => {
			for (const sourceFile of program.getSourceFiles()) {
				this.root.discover(this, sourceFile);
			}
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

			for (const declaration of this.classes) {
				declaration.removeDuplicates();
			}
		});

		if (defaultLib) {
			addExtensions(this);
		}

		withTimer("compute virtual base classes", () => {
			for (const declaration of this.classes) {
				declaration.computeVirtualBaseClasses();
			}
		});

		withTimer("use base members", () => {
			for (const declaration of this.classes) {
				declaration.useBaseMembers();
			}
		});

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
			for (const declaration of this.functions) {
				declaration.rewriteParameterTypes(parameterTypesMap);
			}
		});

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

	public getSymbol(type: ts.Type, generics: Generics): [ts.Symbol | undefined, TypeMap] {
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

	public addDeclaration(declaration: Declaration, parent?: Namespace) {
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

		if (declaration instanceof Class) {
			this.classes.push(declaration)
		} else if (declaration instanceof Function) {
			this.functions.push(declaration);
		}
	}

	public createVariadicHelper(decl: Function): void {
		let type = decl.getType();

		if (!decl.isVariadic() || type === undefined) {
			return;
		}

		decl.addAttribute("gnu::always_inline");

		const helperFunc = new Function(`_${decl.getName()}`, ANY_TYPE.pointer());
		helperFunc.setInterfaceName(decl.getName());
		helperFunc.addVariadicTypeParameter("_Args");
		helperFunc.addParameter(NamedType.create("_Args").expand(), "data");
		helperFunc.addFlags(decl.getFlags());
		this.functions.push(helperFunc);

		const parameters = new Array;

		for (const parameter of decl.getParameters()) {
			const parameterType = parameter.getType();
			const name = parameter.getName();
			let suffix = "";

			if (parameterType instanceof QualifiedType) {
				const qualifier = parameterType.getQualifier();

				if (qualifier & TypeQualifier.Variadic) {
					suffix = "...";
				}
			}

			parameters.push(`cheerp::clientCast(${name})${suffix}`);
		}

		if (type instanceof TemplateType && type.getInner() === ENABLE_IF) {
			type = type.getTypeParameters()[1] as Type;
		}

		if (type.isVoidLike()) {
			decl.setBody(`_${decl.getName()}(${parameters.join(", ")});`);
		} else {
			decl.setBody(`return _${decl.getName()}(${parameters.join(", ")})->template cast<${type.toString()}>();`);
		}

		const parent = decl.getParent();

		if (parent instanceof Class) {
			parent.addMember(helperFunc, Visibility.Private);
		} else {
			helperFunc.setParent(parent);
		}
	}

	public createFunc(decl: FuncDecl, name: string, parameters: ReadonlyArray<any>, typeParams: ReadonlyArray<NamedType>, interfaceName?: string, returnType?: Type, forward?: string): Function {
		const funcObj = new Function(name, returnType);
		this.functions.push(funcObj);

		if (interfaceName) {
			funcObj.setInterfaceName(interfaceName);
		}

		funcObj.setDeclaration(decl);
		const constraintParameters = [];
		const forwardParameters = [];

		for (const typeParam of typeParams) {
			funcObj.addTypeParameter(typeParam.getName());
		}
		
		for (const [parameter, type] of parameters) {
			const [interfaceName, name] = getName(parameter);

			if (parameter.dotDotDotToken) {
				funcObj.addVariadicTypeParameter("_Args");
				const param = ARGS;
				funcObj.addParameter(param.expand(), name);
				const element = TemplateType.arrayElementType(type);
				constraintParameters.push(CompoundExpression.and(TemplateType.isAcceptableArgs(param, element), ELLIPSES));
				forwardParameters.push(name + "...");
			} else {
				funcObj.addParameter(type, name);
				forwardParameters.push(name);
			}
		}
		
		const constraint = CompoundExpression.and(...constraintParameters);

		if (returnType && constraint.getChildren().length > 0 && options.useConstraints) {
			funcObj.setType(TemplateType.enableIf(constraint, returnType));
		}

		if (ts.isMethodDeclaration(decl) && (ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Static)) {
			funcObj.addFlags(Flags.Static);
		}

		if (forward && (ts.isConstructSignatureDeclaration(decl) || ts.isConstructorDeclaration(decl))) {
			const params = forwardParameters.join(", ");
			funcObj.addInitializer(forward, params);
			funcObj.setBody(``);
		}

		funcObj.removeUnusedTypeParameters();
		return funcObj;
	}

	public *createFuncs(decl: FuncDecl, generics: Generics, forward?: string, className?: string): Generator<Function> {
		let interfaceName, name, returnType;
		let params = new Array(new Array);
		let questionParams = new Array;

		generics = generics.clone();

		const [typeParams, typeConstraints] = generics.createParameters(this, [decl]);

		if (ts.isConstructSignatureDeclaration(decl) || ts.isConstructorDeclaration(decl)) {
			name = className!;
		} else if (ts.isIndexSignatureDeclaration(decl)) {
			name = "operator[]";
			const returnInfo = this.getTypeNodeInfo(decl.type, generics);
			returnType = returnInfo.asReturnType(this);
		} else {
			[interfaceName, name] = getName(decl);
			const returnInfo = this.getTypeNodeInfo(decl.type, generics);
			returnType = returnInfo.asReturnType(this);
		}

		if (returnType) {
			returnType = TemplateType.makeConstraint(returnType, typeConstraints);
		}

		for (const parameter of decl.parameters) {
			if (parameter.name.getText() === "this") {
				continue;
			}

			const parameterInfo = this.getTypeNodeInfo(parameter.type!, generics);

			if (parameter.questionToken) {
				questionParams = questionParams.concat(params);
			}

			params = parameterInfo.asParameterTypes().flatMap(type => {
				return params.map(parameters => [...parameters, [parameter, type]]);
			});
		}

		params = params.concat(questionParams);

		if (ts.isIndexSignatureDeclaration(decl)) {
			for (const parameters of params) {
				const funcObj = this.createFunc(decl, name, parameters, typeParams, interfaceName, returnType, forward);
				funcObj.addFlags(Flags.Const);
				yield funcObj;
			}

			for (const parameters of params) {
				if (returnType && parameters.length === 1) {
					const [indexParameter, indexType] = parameters[0];

					if (indexType === DOUBLE_TYPE) {
						const [indexInterfaceName, indexName] = getName(indexParameter);
						const funcObj = this.createFunc(decl, name, parameters, typeParams, interfaceName, returnType.reference(), forward);
						funcObj.setBody(`return __builtin_cheerp_make_regular<${returnType.toString()}>(this, 0)[static_cast<int>(${indexName})];`);
						yield funcObj;
					}
				}
			}
		} else {
			for (const parameters of params) {
				yield this.createFunc(decl, name, parameters, typeParams, interfaceName, returnType, forward);
			}
		}
	}

	public createVar(decl: VarDecl, generics: Generics, member: boolean): Variable {
		const [interfaceName, name] = getName(decl);
		const info = this.getTypeNodeInfo(decl.type, generics);

		if (ts.isPropertySignature(decl) && decl.questionToken) {
			info.setOptional();
		}

		const variable = new Variable(name, info.asVariableType(member));

		variable.setDeclaration(decl);
		return variable;
	}

	public generateType(decl: TypeDecl, generics: Generics, typeObj: TypeAlias, generic: boolean): void {
		const info = this.getTypeNodeInfo(decl.type, generics);

		generics = generics.clone();

		if (generic) {
			const [typeParams, typeConstraints] = generics.createParameters(this, [decl]);

			for (const typeParam of typeParams) {
				typeObj.addTypeParameter(typeParam.getName());
			}

			typeObj.setType(TemplateType.makeConstraint(info.asTypeAlias(), typeConstraints));
		} else {
			generics.createConstraints(this, [decl]);
			typeObj.setType(info.asTypeAlias());
		}

		typeObj.setDeclaration(decl);
		typeObj.removeUnusedTypeParameters();
	}

	public generateConstructor(node: Child, classObj: Class, generics: Generics, decl: VarDecl, generic: boolean): void {
		const forward = generic ? node.getName() : undefined;
		const type = this.typeChecker.getTypeFromTypeNode(decl.type!);
		const [symbol, types] = this.getSymbol(type, generics);
		const members = (symbol?.declarations ?? new Array)
			.filter(decl => ts.isInterfaceDeclaration(decl) || ts.isClassDeclaration(decl) || ts.isTypeLiteralNode(decl))
			.filter(decl => this.includesDeclaration(decl))
			.flatMap(decl => decl.members);

		generics = generics.clone(types);

		for (const member of members) {
			if (ts.isMethodSignature(member) || ts.isMethodDeclaration(member)) {
				for (const funcObj of this.createFuncs(member, generics, forward)) {
					funcObj.addFlags(Flags.Static);
					classObj.addMember(funcObj, Visibility.Public);
				}
			} else if (ts.isConstructSignatureDeclaration(member)) {
				for (const funcObj of this.createFuncs(member, generics, forward, classObj.getName())) {
					classObj.addMember(funcObj, Visibility.Public);
				}
			} else if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) {
				const [interfaceName, name] = getName(member);
				const child = node.getChild(name);

				if (!(ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static)) {
					if (child && child.basicClass) {
						if (!generic) {
							this.generateConstructor(child, child.basicClass, generics, member, false);
							
							if (child.genericClass) {
								this.generateConstructor(child, child.genericClass, generics, member, true);
							}
						}
					} else {
						const varObj = this.createVar(member, generics, true);
						varObj.addFlags(Flags.Static);
						classObj.addMember(varObj, Visibility.Public);
					}
				}
			}
		}
	}

	public generateClass(node: Child, classObj: Class, generics: Generics, generic: boolean, parent?: Namespace): void {
		if (node.getClassDeclarations().length > 0) {
			const baseTypes = new Set(
				node.getClassDeclarations()
					.filter(decl => this.includesDeclaration(decl))
					.map(decl => decl.heritageClauses)
					.filter((heritageClauses): heritageClauses is ts.NodeArray<ts.HeritageClause> => !!heritageClauses)
					.flat()
					.flatMap(heritageClause => heritageClause.types)
					.map(type => this.typeChecker.getTypeAtLocation(type))
			);

			generics = generics.clone();

			if (generic) {
				const [typeParams, typeConstraints] = generics.createParameters(this, node.getClassDeclarations());

				for (const typeParam of typeParams) {
					classObj.addTypeParameter(typeParam.getName());
				}

				for (const constraint of typeConstraints) {
					classObj.addConstraint(constraint);
				}
			} else {
				generics.createConstraints(this, node.getClassDeclarations());
			}

			for (const baseType of baseTypes) {
				const info = this.getTypeInfo(baseType, generics);
				classObj.addBase(info.asBaseType(), Visibility.Public);
			}
		}

		const forward = generic ? node.getName() : undefined;

		const members = node.getClassDeclarations()
			.filter(decl => this.includesDeclaration(decl))
			.flatMap<ts.ClassElement | ts.TypeElement>(decl => decl.members);

		for (const member of members) {
			if (ts.isMethodSignature(member) || ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) {
				for (const funcObj of this.createFuncs(member, generics, forward, classObj.getName())) {
					classObj.addMember(funcObj, Visibility.Public);
					this.createVariadicHelper(funcObj);
				}
			} else if (ts.isIndexSignatureDeclaration(member)) {
				for (const funcObj of this.createFuncs(member, generics)) {
					classObj.addMember(funcObj, Visibility.Public);
				}
			} else if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) {
				const [interfaceName, name] = getName(member);
				const info = this.getTypeNodeInfo(member.type!, generics);
				const readOnly = !!member.modifiers && member.modifiers
					.some(modifier => ts.isReadonlyKeywordOrPlusOrMinusToken(modifier));

				if (member.questionToken) {
					info.setOptional();
				}

				if (!(ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static)) {
					const funcObj = new Function(`get_${name}`, info.asReturnType(this));
					this.functions.push(funcObj);
					funcObj.setInterfaceName(`get_${interfaceName}`);
					classObj.addMember(funcObj, Visibility.Public);

					if (!readOnly) {
						for (const parameter of info.asParameterTypes()) {
							const funcObj = new Function(`set_${name}`, VOID_TYPE);
							this.functions.push(funcObj);
							funcObj.setInterfaceName(`set_${interfaceName}`);
							funcObj.addParameter(parameter, name);
							classObj.addMember(funcObj, Visibility.Public);
						}
					}
				} else {
					const varObj = this.createVar(member, generics, true);
					varObj.addFlags(Flags.Static);
					classObj.addMember(varObj, Visibility.Public);
				}
			}
		}

		if (classObj.getBases().length === 0) {
			const objectClass = this.getRootClass("Object");
			const objectType = this.getRootType("Object");

			if (objectClass !== classObj) {
				classObj.addBase(objectType, Visibility.Public);
			} else {
				classObj.addBase(ANY_TYPE, Visibility.Public);
			}
		}

		for (const child of node.getChildren()) {
			if (child.basicClass) {
				if (!generic) {
					this.generateClass(child, child.basicClass, generics, false, classObj);
					classObj.addMember(child.basicClass, Visibility.Public);
					this.library.addGlobal(child.basicClass);

					if (child.genericClass) {
						this.generateClass(child, child.genericClass, generics, true, classObj);
						classObj.addMember(child.genericClass, Visibility.Public);
						this.library.addGlobal(child.genericClass);
					}
				}
			} else if (child.getFunctionDeclarations().length > 0) {
				for (const funcDecl of child.getFunctionDeclarations()) {
					for (const funcObj of this.createFuncs(funcDecl, generics, forward)) {
						funcObj.addFlags(Flags.Static);
						classObj.addMember(funcObj, Visibility.Public);
					}
				}
			} else if (child.variableDeclaration) {
				const varObj = this.createVar(child.variableDeclaration, generics, true);
				varObj.addFlags(Flags.Static);
				classObj.addMember(varObj, Visibility.Public);
			} else if (child.typeAliasDeclaration && child.basicTypeAlias) {
				if (!generic) {
					this.generateType(child.typeAliasDeclaration, generics, child.basicTypeAlias, false);
					classObj.addMember(child.basicTypeAlias, Visibility.Public);

					if (child.genericTypeAlias) {
						this.generateType(child.typeAliasDeclaration, generics, child.genericTypeAlias, true);
						classObj.addMember(child.genericTypeAlias, Visibility.Public);
					}
				}
			} else if (!generic) {
				child.basicClass = new Class(child.getName());
				this.generateClass(child, child.basicClass, generics, false, classObj);
				classObj.addMember(child.basicClass, Visibility.Public);
				this.library.addGlobal(child.basicClass);
			}
		}

		if (node.variableDeclaration) {
			const type = this.typeChecker.getTypeFromTypeNode(node.variableDeclaration.type!);
			const nodeDeclaration = node.getClassDeclarations()[0];
			const nodeType = nodeDeclaration && this.typeChecker.getTypeAtLocation(nodeDeclaration);

			if (type === nodeType) {
				classObj.setName(classObj.getName() + "Class");
				const varObj = this.createVar(node.variableDeclaration, generics, false);
				varObj.addFlags(Flags.Extern);

				if (parent instanceof Class) {
					parent.addMember(varObj, Visibility.Public);
				} else {
					varObj.setParent(parent);
					this.library.addGlobal(varObj);
				}
			} else {
				this.generateConstructor(node, classObj, generics, node.variableDeclaration, generic);
			}
		}

		if (node.classDeclaration && !classObj.hasConstructor()) {
			const funcObj = new Function(classObj.getName());
			this.functions.push(funcObj);

			if (forward) {
				funcObj.addInitializer(forward, "");
				funcObj.setBody(``);
			}

			classObj.addMember(funcObj, Visibility.Public);
		}

		// classObj.removeUnusedTypeParameters();
		classObj.setDeclaration(node.moduleDeclaration ?? node.getClassDeclarations()[0]);
		this.classes.push(classObj);
	}
}
