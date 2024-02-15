import { Parser } from "./parser.js";
import { Type } from "../type/type.js";
import { TypeInfo, TypeKind } from "./typeInfo.js";
import { QualifiedType } from "../type/qualifiedType.js";
import { TemplateType } from "../type/templateType.js";
import { NULLPTR_TYPE, ANY_TYPE, VOID_TYPE, DOUBLE_TYPE, BOOL_TYPE } from "../type/namedType.js";
import { FunctionType } from "../type/functionType.js";
import { PlaceholderType } from "../type/placeholderType.js";
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

	// The `visited` map is used to prevent infinite recursion in recursive
	// types. For example, to parse `type Foo = number | Array<Foo>;`, we must
	// first parse `Foo`, which must first parse `Foo`, etc...
	//
	// In practice, this will usually cause the type to become `_Any`. Because
	// most recursive type aliases are union types, and when a union type is
	// used as a type parameter it becomes `_Any`.
	//
	// If the `overrides` map ever changes, `visited` must be invalidated.
	private readonly visited: Map<ts.Type, Type> = new Map;

	public constructor(parser: Parser, overrides: ReadonlyMap<ts.Type, TypeInfo>) {
		this.parser = parser;
		this.overrides = overrides;
	}

	// For every call signature of a type with call signatures, we generate a
	// `_Function<T>` overload, where T is a c-style function type that
	// represents the call signature.
	//
	// The parameters and return type are both generated using
	// `asCallbackType`.
	private addCallInfo(info: TypeInfo, callSignatures: ReadonlyArray<ts.Signature>): void {
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
		const visitedType = this.visited.get(type);
		const overrideType = this.overrides.get(type);
		const basicClass = this.parser.getBasicDeclaredClass(type);
		const genericClass = this.parser.getGenericDeclaredClass(type);
		const callSignatures = type.getCallSignatures();

		if (visitedType) {
			// We've seen this type before, use the already parsed info.
			info.addType(visitedType, TypeKind.Class);
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
		} else if (genericClass && type.isClassOrInterface()) {
			// A typescript class for which we have a generic declaration. This
			// only seems to happen when a type inside of the declaration of a
			// generic class references that same generic class directly with
			// the same type parameters. Otherwise, we instead get a type
			// reference.
			//
			// To parse one of these, we parse all the type parameters and
			// construct a `TemplateType` with the parsed type parameters.
			const placeholder = new PlaceholderType();
			this.visited.set(type, placeholder);

			const templateType = TemplateType.create(
				genericClass,
				...(type.typeParameters ?? [])
					.map(typeParameter => this.getInfo(typeParameter).asTypeParameter())
			);

			info.addType(templateType.fix(placeholder, templateType), TypeKind.Class);
			this.visited.delete(type);

			// If the class has call signatures, we add those as well. This
			// makes it so we can pass functions without casting to the
			// class type because it will also generate overloads for
			// `_Function`.
			this.addCallInfo(info, callSignatures);
		} else if (basicClass && type.isClassOrInterface()) {
			// A typescript class for which we have a basic (not generic)
			// declaration. We simply add the class declaration to the info.
			info.addType(basicClass, TypeKind.Class);
			this.addCallInfo(info, callSignatures);
		} else if (callSignatures.length > 0) {
			// For function types, add their call signatures.
			this.addCallInfo(info, callSignatures);
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
			//
			// SAFETY: All of the `*Unsafe` calls are safe because we manually
			// intern the type at the end.
			const genericTarget = this.parser.getGenericDeclaredClass(type.target);

			if (!genericTarget) {
				const basicTarget = this.parser.getBasicDeclaredClass(type.target);
				info.addType(basicTarget ?? this.parser.getRootType("Object"), TypeKind.Class);
				return;
			}

			const placeholder = new PlaceholderType();
			this.visited.set(type, placeholder);

			const templateType = TemplateType.create(
				genericTarget,
				...this.parser.getTypeArguments(type)
					.filter(typeArgument => !(typeArgument as any).isThisType)
					.map(typeArgument => this.getInfo(typeArgument).asTypeParameter())
			);

			info.addType(templateType.fix(placeholder, templateType), TypeKind.Class);
			this.visited.delete(type);
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
