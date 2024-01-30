import { Parser } from "./parser.js";
import { Generics } from "./generics.js";
import { Namespace, Flags } from "../declaration/namespace.js";
import { Class, Visibility } from "../declaration/class.js";
import { getName } from "./name.js";
import { TemplateType } from "../type/templateType.js";
import { CompoundExpression } from "../type/compoundExpression.js";
import { Type } from "../type/type.js";
import { Function } from "../declaration/function.js";
import { DOUBLE_TYPE, ARGS, ANY_TYPE, ENABLE_IF } from "../type/namedType.js";
import { ELLIPSES } from "../type/literalExpression.js";
import { options } from "../utility.js";
import * as ts from "typescript";

interface Parameter {
	name: string;
	type: Type;
	variadic: boolean;
}

function isConstructorLike(node: ts.Node): node is ts.ConstructSignatureDeclaration | ts.ConstructorDeclaration {
	return ts.isConstructSignatureDeclaration(node) || ts.isConstructorDeclaration(node);
}

function isIndexLike(node: ts.Node): node is ts.IndexSignatureDeclaration {
	return ts.isIndexSignatureDeclaration(node);
}

function isStaticMethod(node: ts.Node): node is ts.MethodDeclaration {
	return ts.isMethodDeclaration(node) && !!(ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Static);
}

function *parseOverloads(parser: Parser, declaration: ts.SignatureDeclarationBase, generics: Generics): Generator<ReadonlyArray<Parameter>, void, undefined> {
	let overloads: Array<Array<Parameter>> = [[]];

	for (const parameter of declaration.parameters) {
		const [interfaceName, name] = getName(parameter);

		if (interfaceName !== "this") {
			if (parameter.questionToken) {
				yield *overloads;
			}

			const info = parser.getTypeNodeInfo(parameter.type!, generics);
			const variadic = !!parameter.dotDotDotToken;

			overloads = info.asParameterTypes().flatMap(type => {
				const parameter = { name, type, variadic };
				return overloads.map(parameters => [...parameters, parameter]);
			});
		}
	}

	yield *overloads;
}

export function parseFunction(parser: Parser, declaration: ts.SignatureDeclarationBase, generics: Generics, isStatic: boolean, parent?: Namespace): void {
	if (!parser.includesDeclaration(declaration)) {
		return;
	}

	const parentClass = parent instanceof Class ? parent : undefined;
	const forward = parentClass?.getBasicVersion()?.getName();
	let interfaceName: string | undefined
	let escapedName: string | undefined;
	let returnType: Type | undefined;

	generics = generics.clone();

	const [parameters, constraints] = generics.createParameters(parser, [declaration]);

	if (!isConstructorLike(declaration)) {
		if (!isIndexLike(declaration)) {
			[interfaceName, escapedName] = getName(declaration);
		}

		const info = parser.getTypeNodeInfo(declaration.type, generics);
		returnType = info.asReturnType(parser);
		returnType = TemplateType.makeConstraint(returnType, constraints);
	}

	function createFunction(overload: ReadonlyArray<Parameter>, name: string, type?: Type, flags?: Flags): Function {
		const object = new Function(name, type);
		let variadicConstraint;
		const forwardParameters = [];
		const helperParameters = [];

		parameters.forEach(parameter => object.addTypeParameter(parameter.getName()));

		for (const parameter of overload) {
			if (parameter.variadic) {
				object.addVariadicTypeParameter("_Args");
				object.addParameter(ARGS.expand(), parameter.name);
				const arrayElement = TemplateType.arrayElementType(parameter.type);
				const isAcceptable = TemplateType.isAcceptableArgs(ARGS, arrayElement);
				variadicConstraint = CompoundExpression.and(isAcceptable, ELLIPSES);
				forwardParameters.push(parameter.name + "...");
				helperParameters.push(`cheerp::clientCast(${parameter.name})...`);
			} else {
				object.addParameter(parameter.type, parameter.name);
				forwardParameters.push(parameter.name);
				helperParameters.push(`cheerp::clientCast(${parameter.name})`);
			}
		}

		if (type && variadicConstraint && options.useConstraints) {
			object.setType(TemplateType.enableIf(variadicConstraint, type));
		}

		if (isStaticMethod(declaration) || (isStatic && !isConstructorLike(declaration))) {
			object.addFlags(Flags.Static)
		}

		if (forward && isConstructorLike(declaration)) {
			object.addInitializer(forward, forwardParameters.join(", "));
			object.setBody(``);
		}

		object.setInterfaceName(interfaceName);
		object.setDeclaration(declaration);
		object.removeUnusedTypeParameters();
		object.addFlags(flags ?? 0 as Flags);
		parser.addDeclaration(object, parent);

		if (parent instanceof Class && object.isVariadic() && !isConstructorLike(declaration)) {
			if (type instanceof TemplateType && type.getInner() === ENABLE_IF) {
				type = type.getTypeParameters()[1] as Type;
			}

			const helper = new Function(`_${name}`, ANY_TYPE.pointer());

			if (!type || type.isVoidLike()) {
				object.setBody(`_${name}(${helperParameters.join(", ")});`);
			} else {
				object.setBody(`return _${name}(${helperParameters.join(", ")})->template cast<${type.toString()}>();`);
			}

			object.addAttribute("gnu::always_inline");
			helper.setInterfaceName(interfaceName);
			helper.setDeclaration(declaration);
			helper.addVariadicTypeParameter("_Args");
			helper.addParameter(ARGS.expand(), "data");
			helper.addFlags(object.getFlags());
			helper.setParent(parent);
			parser.registerDeclaration(helper);
			parent.addMember(helper, Visibility.Private);
		}

		return object;
	}

	for (const overload of parseOverloads(parser, declaration, generics)) {
		if (isIndexLike(declaration)) {
			const object = createFunction(overload, "operator[]", returnType, Flags.Const);

			if (overload.length === 1 && overload[0].type === DOUBLE_TYPE) {
				const object = createFunction(overload, "operator[]", returnType!.reference());
				object.setBody(`return __builtin_cheerp_make_regular<${returnType!.toString()}>(this, 0)[static_cast<int>(${overload[0].name})];`);
			}
		} else if (isConstructorLike(declaration)) {
			createFunction(overload, parentClass!.getName());
		} else {
			createFunction(overload, escapedName!, returnType);
		}
	}
}
