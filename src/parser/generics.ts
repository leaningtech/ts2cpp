// Functions that help with processing generic types

import { Parser } from "./parser.js";
import { Type } from "../type/type.js";
import { NamedType } from "../type/namedType.js";
import { Expression } from "../type/expression.js";
import { options } from "../utility.js";
import { TypeInfo, TypeKind } from "./typeInfo.js";
import * as ts from "typescript";

export function isObjectType(type: ts.Type): type is ts.ObjectType {
	return !!(type.flags & ts.TypeFlags.Object);
}

export function isTypeReference(type: ts.Type): type is ts.TypeReference {
	return isObjectType(type) && !!(type.objectFlags & ts.ObjectFlags.Reference);
}

// Which other types are used in this type?
//
// For class or interface types: The type parameters, if any.
// For call function-like types: The return and parameter types.
// For union `T | ...` and intersction `T & ...` types: The inner types `T`.
// For type references `T<U...>`: The target type `T` and type arguments `U`.
function *getUsedTypes(parser: Parser, type: ts.Type): IterableIterator<ts.Type> {
	const callSignatures = type.getCallSignatures();

	if (type.isClassOrInterface()) {
		yield *type.typeParameters ?? [];
	} else if (callSignatures.length > 0) {
		for (const signature of callSignatures) {
			const declaration = signature.getDeclaration();
			yield parser.getTypeFromTypeNode(declaration.type!);

			for (const parameter of declaration.parameters) {
				yield parser.getTypeFromTypeNode(parameter.type!);
			}
		}
	} else if (type.isUnion() || type.isIntersection()) {
		yield *type.types;
	} else if (isTypeReference(type)) {
		yield type.target;
		yield *parser.getTypeArguments(type);
	}
}

// Do any of the types in `types` use the type `other`? This function
// implements a depth first search to find out.
function usesType(parser: Parser, types: ReadonlySet<ts.Type>, other: ts.Type): boolean {
	const queue = [...types];
	const visited = new Set(queue);

	for (let type = queue.pop(); type; type = queue.pop()) {
		if (type === other) {
			return true;
		}

		for (const inner of getUsedTypes(parser, type)) {
			if (!visited.has(inner)) {
				visited.add(inner);
				queue.push(inner);
			}
		}
	}

	return false;
}

function isFunctionLike(node: ts.Node): boolean {
	return ts.isMethodDeclaration(node) || ts.isConstructSignatureDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isIndexSignatureDeclaration(node) || ts.isMethodSignature(node) || ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node);
}

function isTypeAliasLike(node: ts.Node): boolean {
	return ts.isTypeAliasDeclaration(node);
}

function isClassLike(node: ts.Node): boolean {
	return ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node);
}

// This class stores a map of generic arguments and the C++ types we have made
// for them. When parsing a declaration that may have generic arguments, the
// parser calls either `createParameters` or `createConstraints`. See the
// comments at those functions for information about what they do and when they
// should be used.
//
// The `types` are used as overrides for `TypeParser` (see
// "src/parser/typeParser.ts"), so that when the type parser encounters a
// type argument, it will use the appropriate C++ type.
//
// The comments in this simplified example show the contents of `types` as the
// declaration is being parsed. Showing how when parsing the parameters of
// `bar`, we have a C++ type for both `T` and `U`:
// ```
// // {}
// declare interface Foo<T>
// // { T: <Type> }
// {
//     bar<U>
//     // { T: <Type>, U: <Type> }
//     (t: T, u: U): void;
//     // { T: <Type> }
// }
// // {}
// ```
export class Generics {
	// A counter that is incremented every time we create a new type argument,
	// used to give them a unique name, _T0, _T1, _T2, etc...
	private id: number;

	private types?: Map<ts.Type, TypeInfo>;

	public constructor(id?: number, types?: ReadonlyMap<ts.Type, TypeInfo>) {
		this.id = id ?? 0;
		this.types = types && new Map(types);
	}

	// Create a copy of the type arguments map. This is called when we start
	// parsing a new generic declaration, the type arguments of that
	// declaration are then added using `createParameters` or
	// `createConstraints`, and the copy is discarded once the whole
	// declaration has been parsed.
	public clone(): Generics {
		return new Generics(this.id, this.types);
	}

	public getTypes(): ReadonlyMap<ts.Type, TypeInfo> {
		return this.types ?? new Map;
	}

	private addType(type: ts.Type, override: TypeInfo): void {
		this.types ??= new Map;
		this.types.set(type, override);
	}

	// `createParameters` is one of two functions that updates the type
	// arguments map with the type arguments of a declaration.
	//
	// This function actually takes in a list of declarations rather than a
	// single declaration, this is to handle scattered interface declarations
	// for the same type having mismatched type parmaters.
	//
	// We return both a list of all the added type arguments, and a set of
	// expressions that represent the constraints on the type arguments.
	//
	// In the simplest case, we construct a `NamedType` for every type argument
	// and add it to the map.
	public createParameters(parser: Parser, declarations: ReadonlyArray<any>): [Array<NamedType>, Set<Expression>] {
		const types = new Array<NamedType>;
		const constraints = new Set<Expression>;
		const returnTypes = new Set<ts.Type>;

		// 1. Gather a list of types that are used in places where C++ does not
		// perform "template argument deduction". This information is used to
		// ellide and completely remove the type argument in some cases. Type
		// arguments of generic classes are ignored here and are never ellided.
		//
		// For example, consider the conversion of this typescript code:
		// ```
		// declare function foo<T>(arg: T): T;
		// declare function bar<T>(arg: T): void;
		// ```
		//
		// In the function `foo`, the type argument `T` must be present,
		// because otherwise we would not be able to accurately specify the
		// return type. The type argument `T` is required to specify that the
		// return type is the same as the type of `arg`.
		//
		// In the function `bar` however, because `T` is not used in the return
		// type, we can remove the whole type parameter `T` and replace the
		// type of `arg` with `any`. No type information is lost because `T`
		// could have been `any` to begin with, and nothing is gained by using
		// a type more specific than `any`.
		//
		// The same applies when `T` has a type constraint, except instead of
		// replacing `T` with `any` it is replaced with the constraint.
		for (const declaration of declarations) {
			if (isFunctionLike(declaration) && declaration.type) {
				// Cannot ellide `T` if it is the return type of a function.
				returnTypes.add(parser.getTypeFromTypeNode(declaration.type));
			} else if (isTypeAliasLike(declaration)) {
				// Cannot ellide `T` if it is the aliased type of a type alias.
				returnTypes.add(parser.getTypeFromTypeNode(declaration.type));
			}
		}

		for (const declaration of declarations) {
			const typeParameters = ts.getEffectiveTypeParameterDeclarations(declaration);

			// 2. Iterate over all type parameters of all "declarations" of
			// this declaration.
			for (const [i, typeParameter] of typeParameters.entries()) {
				const type = parser.getTypeAtLocation(typeParameter);
				const constraint = ts.getEffectiveConstraintOfTypeParameter(typeParameter);
				const info = constraint && parser.getTypeNodeInfo(constraint, this);

				// 3. If this is a class declaration or if the type parameter
				// is used in a way that cannot be ellided, we create a new
				// named type and add it to the type argument map. If the type
				// argument has a constraint, we also add it to the list of
				// constraints.
				//
				// To handle multiple interface declarations some of which may
				// only store a subset of the complete type arguments of this
				// declaration, we keep track of the index of the type argument
				// within this interface declaration and only create a new
				// named type if we have not seen the index before.
				//
				// If the type parameter can be ellided, we only add the
				// constraint to the type argument map, and we do not generate
				// a type argument at all.
				if (isClassLike(declaration) || usesType(parser, returnTypes, type)) {
					types[i] ??= NamedType.create(`_T${this.id++}`);
					this.addType(type, new TypeInfo(types[i], TypeKind.Generic));

					if (info && options.useConstraints) {
						constraints.add(info.asTypeConstraint(types[i]));
					}
				} else if (info) {
					this.addType(type, info);
				}
			}
		}

		return [types.filter(type => type), constraints];
	}

	// `createConstraints` is one of two functions that updates the type
	// arguments map with the type arguments of a declaration.
	//
	// This function actually takes in a list of declarations rather than a
	// single declaration, this is to handle scattered interface declarations
	// for the same type having mismatched type parmaters.
	//
	// This function is called when generating the non-generic versions of
	// generic declarations, eg. `Array` instead of `TArray`. It is much
	// simpler than `createParameters`. We do not create any named types for
	// the type parameters because the non-generic versions of classes do not
	// have type parameters.
	//
	// If the type argument has no constraints, we are forced to use `any`. But
	// if the type argument does have constraints, we can use the constraint as
	// as the type argument.
	//
	// For example, for this typescript declaration:
	// ```
	// declare interface NodeListOf<T extends Node> {
	//     item(index: number): T;
	// }
	// ```
	// The non-generic C++ class looks like this:
	// ```
	// class NodeListOf: public Object {
	//     Node* item(double index);
	// };
	// ```
	//
	// Where `Node*` in the return type of `item` comes from the constraint on
	// `T` in the typescript declaration.
	public createConstraints(parser: Parser, declarations: ReadonlyArray<any>): void {
		for (const declaration of declarations) {
			const typeParameters = ts.getEffectiveTypeParameterDeclarations(declaration);

			for (const typeParameter of typeParameters) {
				const type = parser.getTypeAtLocation(typeParameter);
				const constraint = ts.getEffectiveConstraintOfTypeParameter(typeParameter);
				const info = constraint && parser.getTypeNodeInfo(constraint, this);

				if (info && !this.types?.get(type)) {
					this.addType(type, info);
				}
			}
		}
	}
}
