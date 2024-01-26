// Sometimes the exact C++ type we generate depends on how it is being used.
// For example, when `String` is used as a return type, we must use `String*`,
// but if it is being used as a parameter we use `const String&`. This file
// implements the logic that generates the correct C++ type depending on how
// it is used.
//
// If there is any need to change, for example, the qualifiers that are used in
// function parameters, or whether types used as generic parameters should be
// converted to pointer types, this is the file to change.

import { Parser } from "./parser.js";
import { Expression, removeDuplicateExpressions } from "../type/expression.js";
import { Type } from "../type/type.js";
import { NamedType, ANY_TYPE, UNION_TYPE, FUNCTION_TYPE, VOID_TYPE, NULLPTR_TYPE } from "../type/namedType.js";
import { TemplateType } from "../type/templateType.js";
import { TypeQualifier } from "../type/qualifiedType.js";
import { DeclaredType } from "../type/declaredType.js";

export enum TypeKind {
	Class,
	Function,
	Primitive,
	Generic,
}

// `TypeData` stores a C++ type that has already been parsed from the
// typescript AST, along with some metadata so that we can add appropriate
// qualifiers depending on where the type is used.
export class TypeData {
	private type: Type;
	private kind: TypeKind;

	public constructor(type: Type, kind: TypeKind) {
		this.type = type;
		this.kind = kind;
	}

	public getType(): Type {
		return this.type;
	}

	public getKind(): TypeKind {
		return this.kind;
	}

	// Class and function (`_Function`) types need to be converted to pointer
	// types, but primitives and generic types do not. One exception is
	// `std::nullptr_t`, which is a class type but should not generate a
	// `std::nullptr_t*`.
	//
	// Good: `String*`, `_Function<void()>*`, `double`, `T`, `std::nullptr_t`
	// Bad: `String`, `_Function<void()>`, `double*`, `T*`, `std::nullptr_t*`
	public needsPointer(): boolean {
		return (this.kind === TypeKind.Class || this.kind === TypeKind.Function) && this.type !== NULLPTR_TYPE;
	}

	// Adds a pointer qualifier to a type only if it needs it, according to
	// `needsPointer`.
	public getPointerOrPrimitive(): Type {
		if (this.needsPointer()) {
			return this.type.pointer();
		} else {
			return this.type;
		}
	}

	// Same as `getPointerOrPrimitive`, except that if this type is void it is
	// converted to `_Any*`. This is necessary because `void` cannot be used
	// in many places in C++.
	public getNonVoidPointerOrPrimitive(): Type {
		if (this.type === VOID_TYPE) {
			return ANY_TYPE.pointer();
		} else {
			return this.getPointerOrPrimitive();
		}
	}
}

// `TypeInfo` exists in between the typescript AST and the C++ AST. It holds
// enough information about a parsed type so that we don't need to look at the
// typescript AST any more, but it cannot contain the final C++ type yet
// because at this point we do not yet know what the type will be used for.
//
// When the parser encounters a typed declaration, the type is passed to
// `getTypeInfo` to obtain a `TypeInfo` instance. The same `getTypeInfo`
// function is used regardless of the location of where the type is being used.
// The returned `TypeInfo` no longer references the typescript AST, but it
// holds enough information to generate the correct C++ type for any use case.
// Then the appropriate `as*` function is called on the type info to get the
// actual C++ type to use at that location.
//
// We could instead of have separate functions `parseVariableType`,
// `parseFunctionReturnType`, `parseBaseClassType`, etc. But this would result
// in large amounts of duplicated parsing code and would be difficult to
// maintain.
export class TypeInfo {
	// A list of types, in the case of union types (`number | string`), this
	// list contains one entry for every type in the union. Depending on where
	// the type is used, this might get converted into a set of overloads,
	// a `_Union` type, or a type erased type.
	private readonly types: Array<TypeData> = new Array;

	// Will be set if the type is optional. This is the case when the type
	// is a union type and it contains an `undefined` member. Or when it is
	// as a variable or function parameter type and the name is suffixed with
	// a question mark `?` character.
	private optional: boolean = false;

	public getTypes(): ReadonlyArray<TypeData> {
		return this.types;
	}

	// In some cases, two different typescript types can convert to the same
	// C++ type. Rather than generating a union or function overload that has
	// the same type twice, this function makes sure not to add duplicate
	// types. This is especially common for unions of literal types. For
	// example, `"mousemove" | "mousedown" | "mouseup" | ...`.
	public addType(type: Type, kind: TypeKind): void {
		if (!this.types.some(t => t.getType() === type)) {
			this.types.push(new TypeData(type, kind));
		}
	}

	public isOptional(): boolean {
		return this.optional;
	}

	public setOptional(): void {
		this.optional = true;
	}

	// If there is exactly one type (not a union type), `getSingle` simply
	// returns that type. Otherwise, it returns `_Any`. This is used in cases
	// where we cannot meaningfully handle multiple types, such as when this
	// type is used as the type of a variable.
	public getSingle(): TypeData {
		if (this.types.length === 1) {
			return this.types[0];
		} else {
			return new TypeData(ANY_TYPE, TypeKind.Class);
		}
	}

	// Return all the types (of a union type), or return `_Any` if there are no
	// types in the union. This is used when we can meaningfully handle
	// multiple types, such as generating overloads when this type is used as
	// a function parameter.
	public getPlural(): ReadonlyArray<TypeData> {
		if (this.types.length > 0) {
			return this.types;
		} else {
			return [new TypeData(ANY_TYPE, TypeKind.Class)];
		}
	}

	// Used to generate type constraints like `T extends Element`. This
	// generates an expression of the form `IsAcceptableV<T, Element>` which
	// can then be used in `std::enable_if_t` or `static_assert`.
	//
	// When this is a union type, this will generate an expression that
	// evaluates to true if `type` matches any of the constraints.
	public asTypeConstraint(type: Type): Expression {
		return TemplateType.isAcceptable(type,
			...this.getPlural().map(constraint => {
				return constraint.getNonVoidPointerOrPrimitive();
			})
		);
	}

	// Used to generate type parameters, such as the `String*` in
	// `TArray<String*>`.
	public asTypeParameter(): Type {
		return this.getSingle().getNonVoidPointerOrPrimitive();
	}

	// Used to generate class base types, such as `Object` in
	// `class String: public Object {`.
	public asBaseType(): Type {
		return this.getSingle().getType();
	}

	// Used to generate function return types. The `parser` argument is needed
	// to obtain an `Object*` in some cases.
	//
	// This function never returns `_Any*`, instead returning `Object*`. This
	// is for compatibility with existing code that uses `_Any*` as if it were
	// `Object*`.
	//
	// We return a `_Union` type with all types from the typescript union,
	// except that:
	// - If there was no type (this rarely happens), we return `Object*`.
	// - If there was only one type, we just return that.
	//
	// `getPointerOrPrimitive` is used to decide which types should be pointers
	// and which shouldn't.
	public asReturnType(parser: Parser): Type {
		const types = removeDuplicateExpressions(
			this.types
				.filter(type => type.getKind() !== TypeKind.Function)
				.map(type => type.getPointerOrPrimitive())
		);

		if (types.length === 0 || types.includes(ANY_TYPE.pointer())) {
			return parser.getRootType("Object").pointer();
		} else if (types.length > 1) {
			return TemplateType.create(UNION_TYPE, ...types).pointer();
		} else {
			return types[0];
		}
	}

	// Used when generating function parameter types. This returns an array
	// rather than a union type so that overloads can be generated. This
	// performs mostly the same conversion as `getPointerOrPrimitive`, except
	// that:
	// - `String` and `Function` become const references.
	// - other non-primitive types become *const* pointers.
	public asParameterTypes(): ReadonlyArray<Type> {
		return this.getPlural().flatMap(type => {
			if (!type.needsPointer()) {
				return [type.getType()];
			} else {
				switch (type.getType().getName()) {
				case "String":
				case "Function":
					return [type.getType().constReference()];
				default:
					return [type.getType().constPointer()];
				}
			}
		});
	}

	// Used when generating the types of variables.
	//
	// Primitive types, such as the many integer constants in
	// `WebGL2RenderingContext`, are never pointers.
	//
	// Member variable types, such as the `permission` string in
	// `Notification`, become pointers.
	//
	// Optional variables, such as `opener`, become pointers.
	//
	// Non-optional global variables, such as `console`, are not pointers.
	// This makes it so you can call `console.log` instead of `console->log`.
	public asVariableType(member: boolean): Type {
		const type = this.getSingle();

		if (this.optional || member) {
			return type.getPointerOrPrimitive();
		} else {
			return type.getType();
		}
	}

	// Used when generating type aliases.
	public asTypeAlias(): Type {
		return this.getSingle().getType();
	}
}
