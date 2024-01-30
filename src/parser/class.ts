import { Parser } from "./parser.js";
import { Child } from "./node.js";
import { Class, Visibility } from "../declaration/class.js";
import { Function } from "../declaration/function.js";
import { Generics } from "./generics.js";
import { Namespace } from "../declaration/namespace.js";
import { parseFunction } from "./function.js";
import { parseVariable } from "./variable.js";
import { parseTypeAlias } from "./typeAlias.js";
import { ANY_TYPE, VOID_TYPE } from "../type/namedType.js";
import { getName } from "./name.js";
import * as ts from "typescript";

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

function parseProperty(parser: Parser, declaration: ts.PropertySignature | ts.PropertyDeclaration, generics: Generics, parent: Class): void {
	const info = parser.getTypeNodeInfo(declaration.type!, generics);
	const [interfaceName, escapedName] = getName(declaration);

	if (declaration.questionToken) {
		info.setOptional();
	}
	
	const func = new Function(`get_${escapedName}`, info.asReturnType(parser));
	func.setInterfaceName(`get_${interfaceName}`);
	func.setDeclaration(declaration);
	parser.addDeclaration(func, parent);

	const readonly = (declaration.modifiers ?? [])
		.some(modifier => ts.isReadonlyKeywordOrPlusOrMinusToken(modifier));

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

function parseConstructor(parser: Parser, node: Child, declaration: ts.VariableDeclaration | ts.PropertySignature | ts.PropertyDeclaration, generics: Generics, parent: Class): void {
	const type = parser.getTypeFromTypeNode(declaration.type!);
	const [symbol, types] = parser.getSymbol(type, generics);
	generics = generics.clone(types);

	const members = (symbol?.declarations ?? [])
		.filter(declaration => parser.includesDeclaration(declaration))
		.filter(declaration => isConstructorClassLike(declaration))
		.flatMap(declaration => (declaration as any).members);

	for (const member of members) {
		if (isMethodLike(member)) {
			parseFunction(parser, member, generics, true, parent);
		} else if (isPropertyLike(member)) {
			const flags = ts.getCombinedModifierFlags(member);
			const [interfaceName, escapedName] = getName(member);
			const child = node.getChild(escapedName);

			if (!(flags & ts.ModifierFlags.Static)) {
				if (child && child.basicClass) {
					parseConstructor(parser, child, member, generics, child.basicClass);

					if (child.genericClass) {
						parseConstructor(parser, child, member, generics, child.genericClass);
					}
				} else {
					parseVariable(parser, member, generics, parent);
				}
			}
		}
	}
}

export function parseClass(parser: Parser, node: Child, object: Class, generics: Generics, parent?: Namespace): void {
	const declarations = node.getClassDeclarations();
	generics = generics.clone();

	if (object.isGenericVersion()) {
		const [parameters, constraints] = generics.createParameters(parser, declarations);
		parameters.forEach(parameter => object.addTypeParameter(parameter.getName()));
		constraints.forEach(constraint => object.addConstraint(constraint));
	} else {
		generics.createConstraints(parser, declarations);
	}
	
	const includedDeclarations = declarations
		.filter(declaration => parser.includesDeclaration(declaration));

	const heritageTypes = includedDeclarations
		.flatMap(declaration => declaration.heritageClauses ?? [])
		.flatMap(heritageClause => heritageClause.types);

	for (const heritageType of heritageTypes) {
		const type = parser.getTypeAtLocation(heritageType);
		const info = parser.getTypeInfo(type, generics);
		object.addBase(info.asBaseType(), Visibility.Public);
	}

	if (object.getBases().length === 0) {
		if (object !== parser.getRootClass("Object")) {
			object.addBase(parser.getRootType("Object"), Visibility.Public);
		} else {
			object.addBase(ANY_TYPE, Visibility.Public);
		}
	}

	const members = includedDeclarations
		.flatMap<ts.TypeElement | ts.ClassElement>(declaration => declaration.members);

	for (const member of members) {
		if (isFunctionLike(member)) {
			parseFunction(parser, member, generics, false, object);
		} else if (isPropertyLike(member)) {
			const flags = ts.getCombinedModifierFlags(member);

			if (flags & ts.ModifierFlags.Static) {
				parseVariable(parser, member, generics, object);
			} else {
				parseProperty(parser, member, generics, object);
			}
		}
	}

	for (const child of node.getChildren()) {
		const functionDeclarations = child.getFunctionDeclarations();

		if (child.basicClass) {
			if (!object.isGenericVersion()) {
				parseClass(parser, child, child.basicClass, generics, object);

				if (child.genericClass) {
					parseClass(parser, child, child.genericClass, generics, object);
				}
			}
		} else if (functionDeclarations.length > 0) {
			for (const declaration of functionDeclarations) {
				parseFunction(parser, declaration, generics, true, object);
			}
		} else if (child.variableDeclaration) {
			parseVariable(parser, child.variableDeclaration, generics, object);
		} else if (child.typeAliasDeclaration && child.basicTypeAlias) {
			if (!object.isGenericVersion()) {
				parseTypeAlias(parser, child.typeAliasDeclaration, child.basicTypeAlias, generics, object);

				if (child.genericTypeAlias) {
					parseTypeAlias(parser, child.typeAliasDeclaration, child.genericTypeAlias, generics, object);
				}
			}
		} else if (!object.isGenericVersion()) {
			child.basicClass = new Class(child.getName());
			parseClass(parser, child, child.basicClass, generics, object);
		}
	}

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

	object.setDeclaration(node.moduleDeclaration ?? declarations[0]);
	parser.addDeclaration(object, parent);
}
