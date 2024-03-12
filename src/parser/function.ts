import { Parser } from "./parser.js";
import { Generics } from "./generics.js";
import { Namespace, Flags } from "../declaration/namespace.js";
import { Class, Visibility } from "../declaration/class.js";
import { getName } from "./name.js";
import { TemplateType } from "../type/templateType.js";
import { CompoundExpression } from "../type/compoundExpression.js";
import { Type } from "../type/type.js";
import { Function } from "../declaration/function.js";
import { DOUBLE_TYPE, ANY_TYPE, ENABLE_IF } from "../type/namedType.js";
import { ARGS } from "../type/genericType.js"
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

// Generate a list of overloads for the function declaration. The logic for
// generating these overloads is as follows:
//
// At an optional parameter, overloads are generated with all parameters
// before the optional argument.
//
// At parameter of union type, or another type that the type parser expands to
// a union type, overloads are generated for all types that `asParameterTypes`
// returns.
//
// Overloads are generated in a multiplicative way. If a function has two
// parameters that would each generate two overloads, in total there would be
// 2 * 2 = 4 overloads.
//
// For example, `function foo(first: A | B, second?: any);` generates these
// overloads:
// ```
// void foo(A* first);
// void foo(B* first);
// void foo(A* first, const _Any& second);
// void foo(B* first, const _Any& second);
// ```
//
// Note that union types will not always generate overloads, they may generate
// a `_Union` template instead, according to the logic in `asParameterTypes`.
function *parseOverloads(parser: Parser, declaration: ts.SignatureDeclarationBase, generics: Generics): Generator<ReadonlyArray<Parameter>, void, undefined> {
	let overloads: Array<Array<Parameter>> = [[]];

	for (const parameter of declaration.parameters) {
		const [interfaceName, name] = getName(parameter);

		if (interfaceName !== "this") {
			// At an optional parameter, yield all overloads generated so far.
			if (parameter.questionToken) {
				yield *overloads;
			}

			const info = parser.getTypeNodeInfo(parameter.type!, generics);
			const variadic = !!parameter.dotDotDotToken;

			// At a parameter that should generate multiple overloads, multiply
			// the set of current overloads with the new overloads.
			overloads = info.asParameterTypes().flatMap(type => {
				const parameter = { name, type, variadic };
				return overloads.map(parameters => [...parameters, parameter]);
			});
		}
	}

	yield *overloads;
}

export function parseFunction(parser: Parser, declaration: ts.SignatureDeclarationBase, generics: Generics, isStatic: boolean, parent?: Namespace): void {
	// 1. If we're not going to emit this declaration anyways, there's no point
	// in parsing it.
	if (!parser.includesDeclaration(declaration)) {
		return;
	}

	const parentClass = parent instanceof Class ? parent : undefined;
	const basicClassName = parentClass?.getBasicVersion()?.getName();
	let interfaceName: string | undefined;
	let escapedName: string | undefined;
	let returnType: Type | undefined;

	generics = generics.clone();

	// 2. Use `createParameters` to parse the type parameters.
	const [parameters, constraints] = generics.createParameters(parser, [declaration]);

	// 3. If this is not a constructor declaration, parse the return type,
	// possibly making an `std::enable_if_t` template using constraints
	// returned from `createParameters`.
	if (!isConstructorLike(declaration)) {
		const info = parser.getTypeNodeInfo(declaration.type, generics);
		returnType = info.asReturnType(parser);
		returnType = TemplateType.makeConstraint(returnType, constraints);

		// 4. Get the name of the declaration, unless this is a constructor or
		// index signature (`operator[]`). Constructors and index signatures
		// do not have names. Get and set accessors get the `get_` or `set_`
		// prefix, respectively.
		if (!isIndexLike(declaration)) {
			[interfaceName, escapedName] = getName(declaration);

			if (ts.isGetAccessor(declaration)) {
				interfaceName = `get_${interfaceName}`;
				escapedName = `get_${escapedName}`;
			} else if (ts.isSetAccessor(declaration)) {
				interfaceName = `set_${interfaceName}`;
				escapedName = `set_${escapedName}`;
			}
		}
	}

	// This is defined as an inner function to capture the useful variables
	// above, rather than having to pass a billion different parameters.
	function createFunction(overload: ReadonlyArray<Parameter>, name: string, type?: Type, flags?: Flags): Function {
		// 6. Create the function object.
		const object = new Function(name, type);

		// 7. Add the type parameters to the function.
		parameters.forEach(({ type, defaultType }) => object.addTypeParameter(type.getName(), defaultType));

		// If this is a variadic function, `variadicConstraint` stores an
		// expression that represent the constraint on variadic parameters. For
		// example, in `function(...args: number[]);`, the expression would be
		// one that evaluates to true if all `_Args` are numbers. This
		// expression will later be used in an `std::enable_if_t` template.
		let variadicConstraint;

		// Parameters to forward to the constructor of the base class. This
		// is only used in the constructors of generic versions of classes that
		// also have basic (non-generic) versions.
		const forwardParameters = [];

		// Parameters to pass to the "variadic helper function". The variadic
		// helper function is explained further down below. Parameters sent to
		// the variadic helper are wrapped in `cheerp::clientCast`, which
		// performs conversions that are not done otherwise because the
		// variadic parameters are also generic. In C++, there is no way to
		// write a variadic function that is not also generic over its variadic
		// parameters. An example of a conversion performed by
		// `cheerp::clientCast` is the conversion from `const char*` to
		// `client::String*`.
		const helperParameters = [];

		// 8. Add parameters to the function object, and populate the
		// `variadicConstraint`, `forwardParameters`, and `helperParameters`
		// variables.
		for (const parameter of overload) {
			if (parameter.variadic) {
				object.addVariadicTypeParameter("_Args");
				object.addParameter(ARGS.expand(), parameter.name);
				const arrayElement = TemplateType.arrayElementType(parameter.type);
				const canCast = TemplateType.canCastArgs(ARGS, arrayElement);
				variadicConstraint = CompoundExpression.and(canCast, ELLIPSES);
				forwardParameters.push(parameter.name + "...");
				helperParameters.push(`cheerp::clientCast(${parameter.name})...`);
			} else {
				object.addParameter(parameter.type, parameter.name);
				forwardParameters.push(parameter.name);
				helperParameters.push(`cheerp::clientCast(${parameter.name})`);
			}
		}

		// 9. Add the variadic constraint on the return type, if needed.
		if (type && variadicConstraint && options.useConstraints) {
			object.setType(TemplateType.enableIf(variadicConstraint, type));
		}

		// 10. If we can detect this is a static method, or if we were
		// explicitly told to make the method static (and this is not a
		// constructor), add the the static flag to the function object.
		if (isStaticMethod(declaration) || (isStatic && !isConstructorLike(declaration))) {
			object.addFlags(Flags.Static)
		}

		// 11. If there is a basic class name, this function must be in the
		// generic version of a class that also has a basic version. If this is
		// also a constructor, we forward all parameters to the basic version.
		// One way to think of this is that we are "type erasing" the generic
		// class, because in javascript, there is no such thing as generics.
		// When the constructor of the generic class is called, cheerp replaces
		// the whole call with just a call to the non-generic base constructor.
		if (basicClassName && isConstructorLike(declaration)) {
			object.addInitializer(basicClassName, forwardParameters.join(", "));
			object.setBody(``);
		}

		// 12. Some post processing:
		// - Set the interface name.
		// - Mark the function as coming from the declaration `declaration`.
		// - Remove unused type parameters.
		// - Add extra flags (`const`, in the case of index signatures).
		object.setInterfaceName(interfaceName);
		object.setDeclaration(declaration);
		object.removeUnusedTypeParameters();
		object.addFlags(flags ?? 0 as Flags);

		// 13. Add it to the parent declaration.
		parser.addDeclaration(object, parent);

		// 14. Generate a variadic helper. The variadic helper exists so that
		// the other function can have a body that calls `cheerp::clientCast`
		// on all of its arguments, and forward them to the variadic helper.
		// Calling the helper function is what actually results in the
		// javascript call. The variadic helper function is currently only
		// generated when:
		// - The function is inside of a class.
		// - The function is variadic.
		// - The function is not a constructor.
		if (parent instanceof Class && object.isVariadic() && !isConstructorLike(declaration)) {
			// 14.1. Create the helper function object.
			const helper = new Function(`_${name}`, ANY_TYPE.pointer());

			// 14.2. Set body of the other function object to just forward
			// to the helper. For simplicity, the helper always returns
			// `_Any*`, and this is cast to the actual return type in the other
			// function.
			if (!type || type.isVoidLike()) {
				object.setBody(`_${name}(${helperParameters.join(", ")});`);
			} else {
				object.setBody(`return _${name}(${helperParameters.join(", ")})->template cast<${type.toString()}>();`);
			}

			// 14.3. Some post processing:
			// - Add the `gnu::always_inline` attribute to the other function.
			// - Set the interface name of the helper.
			// - Mark the helper as coming from the declaration `declaration`.
			// - Add variadic parameter to the helper.
			// - Copy the flags of the other function to the helper.
			// - Set the parent of the helper.
			// - Register the declaration with the parser.
			object.addAttribute("gnu::always_inline");
			helper.setInterfaceName(interfaceName);
			helper.setDeclaration(declaration);
			helper.addVariadicTypeParameter("_Args");
			helper.addParameter(ARGS.expand(), "data");
			helper.addFlags(object.getFlags());
			helper.setParent(parent);
			parser.registerDeclaration(helper);

			// 14.4. Add the helper as a private member to the parent class.
			parent.addMember(helper, Visibility.Private);
		}

		return object;
	}

	// 5. Create functions for all overloads that `parseOverloads` yields.
	// There is some slightly different logic implemented here depending on
	// what type of function declaration this is:
	// - Index signatures are made to generate with the name `operator[]`.
	//   Index signatures also generate both a const function, and a version
	//   that returns a reference using `__builtin_cheerp_make_regular`.
	// - Constructors are generated with the name of their parent class, and
	//   do not have a return type.
	for (const overload of parseOverloads(parser, declaration, generics)) {
		if (isIndexLike(declaration)) {
			const object = createFunction(overload, "operator[]", returnType, Flags.Const);

			if (overload.length === 1 && overload[0].type === DOUBLE_TYPE) {
				const object = createFunction(overload, "operator[]", returnType!.reference());
				object.setLean(false);
				object.setBody(`return __builtin_cheerp_make_regular<${returnType!.toString()}>(this, 0)[static_cast<int>(${overload[0].name})];`);
			}
		} else if (isConstructorLike(declaration)) {
			createFunction(overload, parentClass!.getName());
		} else {
			createFunction(overload, escapedName!, returnType);
		}
	}
}
