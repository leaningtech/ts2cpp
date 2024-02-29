import { Parser } from "./parser.js";
import { Child } from "./node.js";
import { Class, Visibility } from "../declaration/class.js";
import { Function } from "../declaration/function.js";
import { Generics } from "./generics.js";
import { Namespace } from "../declaration/namespace.js";
import { parseFunction } from "./function.js";
import { parseVariable } from "./variable.js";
import { parseTypeAlias } from "./typeAlias.js";
import { ANY_TYPE, VOID_TYPE, CHECK_TEMPLATE } from "../type/namedType.js";
import { DeclaredType } from "../type/declaredType.js";
import { getName } from "./name.js";
import * as ts from "typescript";
import { TemplateType } from "../type/templateType.js";

function isMethodLike(node: ts.Node): node is ts.SignatureDeclarationBase {
	return ts.isMethodSignature(node) || ts.isMethodDeclaration(node) || ts.isConstructSignatureDeclaration(node);
}

function isFunctionLike(node: ts.Node): node is ts.SignatureDeclarationBase {
	return ts.isMethodSignature(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isIndexSignatureDeclaration(node);
}

function isPropertyLike(node: ts.Node): node is ts.PropertySignature | ts.PropertyDeclaration {
	return ts.isPropertySignature(node) || ts.isPropertyDeclaration(node);
}

function isConstructorClassLike(node: ts.Node): node is ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeLiteralNode {
	return ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node) || ts.isTypeLiteralNode(node);
}

// Parse a property (field) of a class. A getter function is generated for
// every property. For non-`readonly` properties, we also generate a setter.
function parseProperty(parser: Parser, declaration: ts.PropertySignature | ts.PropertyDeclaration, generics: Generics, parent: Class): void {
	// 1. Get type info and name of the property.
	const info = parser.getTypeNodeInfo(declaration.type!, generics);
	const [interfaceName, escapedName] = getName(declaration);

	// 2. If the property is optional, add that to the type info.
	if (declaration.questionToken) {
		info.setOptional();
	}
	
	// 3. Generate the getter function.
	const func = new Function(`get_${escapedName}`, info.asReturnType(parser));
	func.setInterfaceName(`get_${interfaceName}`);
	func.setDeclaration(declaration);
	parser.addDeclaration(func, parent);

	const readonly = (declaration.modifiers ?? [])
		.some(modifier => ts.isReadonlyKeywordOrPlusOrMinusToken(modifier));

	// 4. If the property is not `readonly`, also generate setter functions.
	// The setter functions may be overloaded, depending on the type of the
	// property, and the logic in `asParameterTypes`.
	if (!readonly) {
		for (const parameter of info.asParameterTypes()) {
			const func = new Function(`set_${escapedName}`, VOID_TYPE);
			func.setInterfaceName(`set_${interfaceName}`);
			func.setDeclaration(declaration);
			func.addParameter(parameter, escapedName);
			parser.addDeclaration(func, parent);
		}
	}
}

// Parse a "constructor" object. A constructor object is a variable with the
// same name as a class or interface declaration.
//
// This matches a common pattern in typescript declarations:
// ```
// declare interface Foo {
//     method(): void;
// }
//
// declare interface FooConstructor {
//     staticMethod(): void;
//     new(): Foo;
// }
//
// // The constructor object shares its name with the interface `Foo`:
// declare var Foo: FooConstructor;
// ```
//
// Instead of generating an actual variable, we add the members of the object
// as members of the class that shares its name with the variable:
// ```
// class Foo : public Object {
// public:
//     // From `method(): void;` in `interface Foo`.
//     void method();
//
//     // From `staticMethod(): void;` in `interface FooConstructor`.
//     static void staticMethod();
//
//     // From `new(): Foo` in `interface FooConstructor`.
//     Foo();
// };
// ```
function parseConstructor(parser: Parser, node: Child, declaration: ts.VariableDeclaration | ts.PropertySignature | ts.PropertyDeclaration, generics: Generics, parent: Class): void {
	// 1. Get the type of the constructor object.
	const type = parser.getTypeFromTypeNode(declaration.type!);

	// 2. Get the symbol and type parameters of the constructor object type.
	//
	// If the type is generic, it has the form `T<U...>`. The symbol is `T`,
	// and the type parameters are `U...`.
	//
	// If the type is not generic, it has the form `T`. The symbol is `T`, and
	// the type parameters are an empty map.
	const [symbol, types] = parser.getSymbol(type, generics);

	// 3. Update the generics map state with the type parameters of the
	// constructor object.
	generics = new Generics(generics.getNextId(), types);

	// 4. Gather all members of all declarations of the symbol.
	const members = (symbol?.declarations ?? [])
		.filter(declaration => parser.includesDeclaration(declaration))
		.filter(declaration => isConstructorClassLike(declaration))
		.flatMap(declaration => (declaration as any).members);

	// 5. Parse and add the members to the class.
	for (const member of members) {
		if (isMethodLike(member)) {
			// Methods are parsed using `parseFunction`.
			parseFunction(parser, member, generics, true, parent);
		} else if (isPropertyLike(member)) {
			// Property members may be regular properties, but they may also
			// be the constructor object for an inner class.
			const flags = ts.getCombinedModifierFlags(member);
			const [interfaceName, escapedName] = getName(member);
			const child = node.getChild(escapedName);

			// Ignore static properties.
			if (flags & ts.ModifierFlags.Static) {
				continue;
			}

			if (child && child.classObject) {
				const basicVersion = child.classObject.getBasicVersion();

				// If there is an inner class with the same name as this
				// property, parse the property as a constructor object for the
				// inner class.
				basicVersion && parseConstructor(parser, child, member, generics, basicVersion);
				parseConstructor(parser, child, member, generics, child.classObject);
			} else {
				// If there is no inner class with the same name, parse it as a
				// regular property.
				parseVariable(parser, member, generics, parent);
			}
		}
	}
}

export function parseClass(parser: Parser, node: Child, object: Class, originalGenerics: Generics, parent?: Namespace): void {
	const basicVersion = object.getBasicVersion();
	const declarations = node.getClassDeclarations();
	const generics = originalGenerics.clone();

	if (object.isGeneric()) {
		// 1.1. If this is the generic version of this class, use
		// `createParameters` to parse the type parameters.
		const [parameters, constraints] = generics.createParameters(parser, declarations);

		// 1.2. Add the type parameters and constraints to the class.
		parameters.forEach(([parameter, _]) => object.addTypeParameter(parameter.getName()));
		constraints.forEach(constraint => object.addConstraint(constraint));
		object.addConstraint(TemplateType.create(CHECK_TEMPLATE, ...parameters.map(([parameter, _]) => parameter)));

		// 1.3. If this class also has a basic version, we parse it and add it
		// as a base class of the generic version.
		if (basicVersion) {
			parseClass(parser, node, basicVersion, originalGenerics, parent);
			object.addBase(DeclaredType.create(basicVersion), Visibility.Public);
		}
	} else {
		// 2.1. If this is the basic version of this class, use
		// `createConstraints` to parse the type parameters.
		generics.createConstraints(parser, declarations);
	}

	const includedDeclarations = declarations
		.filter(declaration => parser.includesDeclaration(declaration));

	// 3. Gather all types in heritage clauses on any of the included
	// declarations of this class.
	const heritageTypes = includedDeclarations
		.flatMap(declaration => declaration.heritageClauses ?? [])
		.flatMap(heritageClause => heritageClause.types);

	// 4. And add them as bases of the class.
	for (const heritageType of heritageTypes) {
		const type = parser.getTypeAtLocation(heritageType);
		const info = parser.getTypeInfo(type, generics);
		object.addBase(info.asBaseType(), Visibility.Public);
	}

	// 5. If there are no explicit bases, we implicitly add `Object` as a base
	// class. Or if this *is* the `Object` class, we add `_Any` as a base
	// class.
	if (object.getBases().length === 0) {
		if (object !== parser.getRootClass("Object")) {
			object.addBase(parser.getRootType("Object"), Visibility.Public);
		} else {
			object.addBase(ANY_TYPE, Visibility.Public);
		}
	}

	// 6. Gather all members of the included declarations of this class.
	const members = includedDeclarations
		.flatMap<ts.TypeElement | ts.ClassElement>(declaration => declaration.members);

	// 7. Parse and add members to the class.
	for (const member of members) {
		if (isFunctionLike(member)) {
			// Methods are parsed using `parseFunction`.
			parseFunction(parser, member, generics, false, object);
		} else if (isPropertyLike(member)) {
			const flags = ts.getCombinedModifierFlags(member);

			if (flags & ts.ModifierFlags.Static) {
				// Static properties are turned into static member variables,
				// and are parsed using `parseVariable`.
				parseVariable(parser, member, generics, object);
			} else {
				// Non-static properties are turend into getter and setter
				// functions, and are parsed using `parseProperty`.
				parseProperty(parser, member, generics, object);
			}
		}
	}

	// 8. Parse the children of a namespace with the same name as this class.
	//
	// This matches a common pattern in typescript declarations:
	// ```
	// declare interface Foo {
	//     method(): void;
	// }
	//
	// // The namespace shares its name with the interface `Foo`.
	// declare namespace Foo {
	//     function staticMethod(): void;
	// }
	// ```
	//
	// Instead of generating an actual namespace, we add the children of the
	// namespace as members of the class that shares its name with the
	// namespace:
	// ```
	// class Foo {
	// public:
	//     // From `method(): void;` in `interface Foo`.
	//     void method();
	//
	//     // From `function staticMethod(): void;` in `namespace Foo`.
	//     static void staticMethod();
	// };
	// ```
	for (const child of node.getChildren()) {
		const functionDeclarations = child.getFunctionDeclarations();

		if (child.classObject) {
			// If the child is another class, it is parsed using `parseClass`
			// as an inner class of this class.
			parseClass(parser, child, child.classObject, generics, object);
		} else if (functionDeclarations.length > 0) {
			// If the child is a function declaration, it is parsed using
			// `parseFunction` as a static method of this class.
			for (const declaration of functionDeclarations) {
				parseFunction(parser, declaration, generics, true, object);
			}
		} else if (child.variableDeclaration) {
			// If the child is a variable declaration, it is parsed using
			// `parseVariable` as a static member variable of this class.
			parseVariable(parser, child.variableDeclaration, generics, object);
		} else if (child.typeAliasDeclaration && child.typeAliasObject) {
			// If the child is a type alias, it is parsed using
			// `parseTypeAlias` as a member type of this class.
			parseTypeAlias(parser, child.typeAliasDeclaration, child.typeAliasObject, generics, object);
		} else {
			child.classObject = new Class(child.getName());
			parseClass(parser, child, child.classObject, generics, object);
		}
	}

	// 9. If there is a variable declaration with the same name as this class,
	// it is parsed as a constructor object of this class. See the comments on
	// `parseConstructor` for a detailed description of constructor objects.
	//
	// There is one exception. Usually, constructor objects have the form
	// `declare var Foo: FooConstructor;`. But if the type of the constructor
	// object is also `Foo`, as in `declare var Foo: Foo;`. Then the variable
	// is not a constructor object. In this case, the class is renamed to
	// `FooClass` and the variable is parsed as a regular variable using
	// `parseVariable`.
	if (node.variableDeclaration) {
		const variableType = parser.getTypeFromTypeNode(node.variableDeclaration.type!);
		const classType = declarations[0] && parser.getTypeAtLocation(declarations[0]);

		if (variableType === classType) {
			object.setName(`${object.getName()}Class`);
			parseVariable(parser, node.variableDeclaration, generics, parent);
		} else {
			parseConstructor(parser, node, node.variableDeclaration, generics, object);
		}
	}

	// 10. Mark this class as coming from `node.moduleDeclaration`, or one of
	// the declarations in `declarations`. It does not particularly matter
	// which, they are probably from the same file anyways.
	object.setDeclaration(node.moduleDeclaration ?? declarations[0]);

	// 11. Add it to the parent declaration.
	parser.addDeclaration(object, parent);
}
