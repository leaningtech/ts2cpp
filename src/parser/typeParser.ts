import { Parser } from "./parser.js";
import { Type } from "../type/type.js";
import { TypeInfo, TypeKind } from "./typeInfo.js";
import { QualifiedType } from "../type/qualifiedType.js";
import { TemplateType } from "../type/templateType.js";
import { NULLPTR_TYPE, ANY_TYPE, VOID_TYPE, DOUBLE_TYPE, BOOL_TYPE } from "../type/namedType.js";
import { FunctionType } from "../type/functionType.js";
import { isTypeReference } from "./generics.js";
import { getName } from "./name.js";
import * as ts from "typescript";

// The main job of a `TypeParser` is to create a `TypeInfo` object from a
// typescript type. See "src/parser/typeInfo.ts" for more about `TypeInfo`.
export class TypeParser {
	private readonly parser: Parser;

	// The `overrides` map stores types that the caller *already* has
	// information about. This allows us to return type information for types
	// which exist outside of the context of the parser. For example, the type
	// arguments of generic types are stored in the `overrides` map.
	private readonly overrides: ReadonlyMap<ts.Type, TypeInfo>;

	// The `visited` set is used to prevent infinite recursion in recursive
	// types. For example, to parse `type Foo = number | Array<Foo>;`, we must
	// first parse `Foo`, which must first parse `Foo`, etc...
	//
	// Recursive types are not supported at the moment, and are always replaced
	// with `_Any*`.
	private readonly visited: Set<ts.Type> = new Set;

	public constructor(parser: Parser, overrides: ReadonlyMap<ts.Type, TypeInfo>) {
		this.parser = parser;
		this.overrides = overrides;
	}

	// For every call signature of a type with call signatures, we generate a
	// `_Function<T>` overload, where T is a C-style function type that
	// represents the call signature.
	//
	// The parameters and return type are both generated using
	// `asCallbackType`.
	private addCallInfo(info: TypeInfo, callSignatures: ReadonlyArray<ts.Signature>): void {
		// Also add EventListener overload for compatibility.
		if (callSignatures.length > 0) {
			info.addType(this.parser.getRootType("EventListener"), TypeKind.ClassOverload);
		}

		for (const signature of callSignatures) {
			const declaration = signature.getDeclaration();
			const returnType = this.getNodeInfo(declaration.type).asCallbackType();

			const parameterTypes = declaration.parameters
				.filter(parameter => getName(parameter)[0] !== "this")
				.map(parameter => this.getNodeInfo(parameter.type))
				.map(info => info.asCallbackType());

			info.addType(TemplateType.createFunction(returnType, ...parameterTypes), TypeKind.Class);
		}
	}

	// `addInfo` is where most of the work happens. The type `type` is parsed
	// and `info` is updated accordingly.
	//
	// This function takes in a `TypeInfo`, rather than returning it, to
	// support recursively parsing all types in nested unions into the same
	// `TypeInfo` instance.
	private addInfo(info: TypeInfo, type: ts.Type): void {
		const overrideType = this.overrides.get(type);
		const declaredType = this.parser.getDeclaredType(type);
		const callSignatures = type.getCallSignatures();

		if (this.visited.has(type)) {
			// We've seen this type before, to prevent infinite recursing, use
			// `_Any`.
			info.addType(ANY_TYPE, TypeKind.Class);
		} else if (overrideType) {
			// This type is in the overrides map, add info from that map.
			info.merge(overrideType);
		} else if (type.flags & ts.TypeFlags.Undefined) {
			// The typescript `undefined` type does not directly correspond
			// to a type in C++. Instead, it often appears in union types, such
			// as `string | undefined` to mark that a value of that type is
			// optional. So if we encounter the `undefined` type, we simply
			// mark this type info as optional.
			info.setOptional();
		} else if (type.flags & ts.TypeFlags.Any) {
			// Typescript `any` becomes C++ `_Any`. `any` can also be
			// undefined, so we mark the info as optional.
			info.addType(ANY_TYPE, TypeKind.Class);
			info.setOptional();
		} else if (type.flags & ts.TypeFlags.VoidLike) {
			// Typescript `void` becomes C++ `void`.
			info.addType(VOID_TYPE, TypeKind.Primitive);
		} else if (type.flags & ts.TypeFlags.NumberLike) {
			// Typescript `number` becomes C++ `double`.
			info.addType(DOUBLE_TYPE, TypeKind.Primitive);
		} else if (type.flags & ts.TypeFlags.BooleanLike) {
			// Typescript `boolean` becomes C++ `bool`.
			info.addType(BOOL_TYPE, TypeKind.Primitive);
		} else if (type.flags & ts.TypeFlags.StringLike) {
			// Typescript `string` becomes C++ `client::String`.
			info.addType(this.parser.getRootType("String"), TypeKind.Class);
		} else if (type.flags & ts.TypeFlags.BigIntLike) {
			// Typescript `bigint` becomes C++ `client::BigInt`.
			info.addType(this.parser.getRootType("BigInt"), TypeKind.Class);
		} else if (type.flags & ts.TypeFlags.ESSymbolLike) {
			// Typescript `symbol` becomes C++ `client::Symbol`.
			info.addType(this.parser.getRootType("Symbol"), TypeKind.Class);
		} else if (callSignatures.length > 0) {
			// For function types, add their call signatures.
			//
			// TODO: use geenric parameters
			this.addCallInfo(info, callSignatures);
		} else if (declaredType && type.isClassOrInterface()) {
			// A typescript class for which we have a C++ declaration. This
			// happens in two cases:
			// - Basic (not generic) classes.
			// - Reference to a generic class within the class itself with the
			//   same type parameters. Otherwise, generic classes are parsed as
			//   `ts.TypeReference` instead.
			if (!declaredType.getDeclaration().isGeneric()) {
				info.addType(declaredType, TypeKind.Class);
			} else {
				this.visited.add(type);

				const templateType = TemplateType.create(
					declaredType,
					...(type.typeParameters ?? [])
						.map(typeParameter => this.getInfo(typeParameter).asTypeParameter())
				);

				this.visited.delete(type);
				info.addType(templateType, TypeKind.Class);
			}
		} else if (type.isIntersection()) {
			// HACK: For intersection types, we only use the first variant.
			this.addInfo(info, type.types[0]);
		} else if (type.isUnion()) {
			// Union types are parsed by recursively adding all variants to the
			// same `TypeInfo` instance.
			type.types.forEach(inner => this.addInfo(info, inner));
		} else if (isTypeReference(type)) {
			// A type reference usually has the form `T<U...>`, when this is
			// the case, we should have a generic declared class for the target
			// type. Tuple types of the form `[T, U]` seemingly also end up as
			// type references, these are currently not handled and are
			// translated into `client::Object`.
			//
			// To parse type references, we parse all the type parameters and
			// construct a `TemplateType` with the parsed type parameters.
			const target = this.parser.getDeclaredType(type.target);

			if (!target) {
				info.addType(this.parser.getRootType("Object"), TypeKind.Class);
			} else if (!target.getDeclaration().isGeneric()) {
				info.addType(target, TypeKind.Class);
			} else {
				this.visited.add(type);

				const templateType = TemplateType.create(
					target,
					...this.parser.getTypeArguments(type)
						.filter(typeArgument => !(typeArgument as any).isThisType)
						.map(typeArgument => this.getInfo(typeArgument).asTypeParameter())
				);

				this.visited.delete(type);
				info.addType(templateType, TypeKind.Class);
			}
		} else if (type.isTypeParameter()) {
			// A type parameter that was not in the `overrides` map. We have no
			// idea what type this is so this should just be the same as `any`.
			info.addType(ANY_TYPE, TypeKind.Class);
			info.setOptional();
		} else {
			// Any other type is just `client::Object`.
			info.addType(this.parser.getRootType("Object"), TypeKind.Class);
		}
	}

	// A simple wrapper around `addInfo` that constructs a new `TypeInfo`,
	// calls `addInfo` with it, and then returns the populated `TypeInfo`.
	public getInfo(type: ts.Type): TypeInfo {
		const info = new TypeInfo;
		this.addInfo(info, type);
		return info;
	}

	// Essentially equivalent to `getInfo(getTypeFromTypeNode(node))`, except:
	// - When `node` is undefined, return an optional `_Any`.
	// - When `node` is a `this` type node, `getContraint` returns the parent
	// class type, and we return info for the parent class type instead.
	public getNodeInfo(node?: ts.TypeNode): TypeInfo {
		if (node) {
			const type = this.parser.getTypeFromTypeNode(node);
			return this.getInfo(ts.isThisTypeNode(node) ? type.getConstraint()! : type);
		} else {
			const info = new TypeInfo;
			info.addType(ANY_TYPE, TypeKind.Class);
			info.setOptional();
			return info;
		}
	}

	// `getSymbol` returns the symbol for the templated type of a type
	// reference of the form `T<U...>`, along with a map containg the type
	// arguments of the type reference. If `type` is not a type reference, we
	// return the symbol of the type itself, and there are no type arguments.
	//
	// The type arguments can be used, for example, as the `overrides` map of
	// another `TypeParser` instance.
	public getSymbol(type: ts.Type): [ts.Symbol | undefined, Map<ts.Type, TypeInfo>] {
		if (isTypeReference(type)) {
			const result = new Map(
				this.parser.getTypeArguments(type)
					.map((t, i) => [type.target.typeParameters![i], this.getInfo(t)])
			);

			return [type.target.getSymbol(), result];
		} else {
			return [type.getSymbol(), new Map];
		}
	}
}
