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
import { Expression } from "../type/expression.js";
import { Type } from "../type/type.js";
import { TemplateDeclaration } from "../declaration/templateDeclaration.js";
import { NamedType, ANY_TYPE, VOID_TYPE, NULLPTR_TYPE } from "../type/namedType.js";
import { TemplateType } from "../type/templateType.js";
import { TypeQualifier } from "../type/qualifiedType.js";
import { DeclaredType } from "../type/declaredType.js";
import { FunctionType } from "../type/functionType.js";

export enum TypeKind {
	Class,
	Primitive,
	Generic,

	// `ClassOverload` is used when a type should only be generated in function
	// overload. `TypeData` of this kind are ignored in any other context.
	ClassOverload,
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

	// Class types need to be converted to pointer types, but primitives and
	// generic types do not. One exception is `std::nullptr_t`, which is a
	// class type but should not generate a `std::nullptr_t*`.
	//
	// Good: `String*`, `_Function<void()>*`, `double`, `T`, `std::nullptr_t`
	// Bad: `String`, `_Function<void()>`, `double*`, `T*`, `std::nullptr_t*`
	public needsPointer(): boolean {
		return this.kind === TypeKind.Class && this.type !== NULLPTR_TYPE;
	}

	// Adds a pointer qualifier to a type only if it needs it, according to
	// `needsPointer`. If `basic` is true, generic types that take `_Any*` are
	// converted to their basic version. This conversion is useful for
	// generating parameter types (see `asParameterTypes` on `TypeInfo`).
	public getPointerOrPrimitive(basic: boolean = false): Type {
		if (this.needsPointer()) {
			if (basic && this.type instanceof TemplateType && this.type.getTypeParameters().every(type => type === ANY_TYPE.pointer())) {
				const inner = this.type.getInner();
				const declaration = inner instanceof DeclaredType && inner.getDeclaration();
				const basicVersion = declaration instanceof TemplateDeclaration && declaration.getBasicVersion();

				if (basicVersion) {
					return DeclaredType.create(basicVersion).pointer();
				}
			}

			return this.type.pointer();
		} else {
			return this.type;
		}
	}

	// Same as `getPointerOrPrimitive`, except that if this type is void it is
	// converted to `_Any*`. This is necessary because `void` cannot be used
	// in many places in C++.
	public getNonVoidPointerOrPrimitive(basic: boolean = false): Type {
		if (this.type === VOID_TYPE) {
			return ANY_TYPE.pointer();
		} else {
			return this.getPointerOrPrimitive(basic);
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
	private types?: Array<TypeData>;

	// Will be set if the type is optional. This is the case when the type
	// is a union type and it contains an `undefined` member. Or when it is
	// as a variable or function parameter type and the name is suffixed with
	// a question mark `?` character.
	private optional: boolean = false;

	public constructor(type?: Type, kind?: TypeKind) {
		if (type && kind !== undefined) {
			this.addType(type, kind);
		}
	}

	public getAllTypes(): ReadonlyArray<TypeData> {
		return this.types ?? [];
	}

	public getTypes(): ReadonlyArray<TypeData> {
		return this.getAllTypes().filter(type => type.getKind() !== TypeKind.ClassOverload);
	}

	// In some cases, two different typescript types can convert to the same
	// C++ type. Rather than generating a union or function overload that has
	// the same type twice, this function makes sure not to add duplicate
	// types. This is especially common for unions of literal types. For
	// example, `"mousemove" | "mousedown" | "mouseup" | ...`.
	public addType(type: Type, kind: TypeKind): void {
		if (!this.types || !this.types.some(t => t.getType() === type)) {
			this.types ??= [];
			this.types.push(new TypeData(type, kind));
		}
	}

	public merge(info: TypeInfo): void {
		if (info.optional) {
			this.setOptional();
		}

		for (const data of info.getTypes()) {
			this.addType(data.getType(), data.getKind());
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
		if (this.getTypes().length === 1) {
			return this.getTypes()[0];
		} else {
			return new TypeData(ANY_TYPE, TypeKind.Class);
		}
	}

	// Return all the types (of a union type), or return `_Any` if there are no
	// types in the union. This is used when we can meaningfully handle
	// multiple types, such as generating overloads when this type is used as
	// a function parameter.
	public getPlural(): ReadonlyArray<TypeData> {
		if (this.getTypes().length > 0) {
			return this.getTypes();
		} else {
			return [new TypeData(ANY_TYPE, TypeKind.Class)];
		}
	}

	// Returns a _Union, or `anyType` if the union contains `_Any`.
	public getUnion(anyType: Type): Type {
		const types = this.getTypes();

		if (types.length === 0 || types.some(type => type.getType() === ANY_TYPE)) {
			return anyType;
		} else {
			const transformedTypes = types.map(type => type.getPointerOrPrimitive());
			return TemplateType.createUnion(TypeQualifier.Pointer, ...transformedTypes);
		}
	}

	// Used to generate type constraints like `T extends Element`. This
	// generates an expression of the form `IsAcceptableV<T, Element>` which
	// can then be used in `std::enable_if_t` or `static_assert`.
	//
	// When this is a union type, this will generate an expression that
	// evaluates to true if `type` matches any of the constraints.
	public asTypeConstraint(type: Type): Expression {
		return TemplateType.canCast(type,
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
	// except:
	// - If there was no type (this rarely happens), we return `Object*`.
	// - If there was only one type, we just return that.
	//
	// `getPointerOrPrimitive` is used to decide which types should be pointers
	// and which shouldn't.
	public asReturnType(parser: Parser): Type {
		return this.getUnion(parser.getRootType("Object").pointer());
	}

	// Used when generating function parameter types. This returns an array
	// so that overloads can be generated. This performs mostly the same
	// conversion as `getPointerOrPrimitive`, except that:
	// - `String`, `_Function`, and `_Any` become a const references.
	// - Other non-primitive types become *const* pointers.
	// - Generic types with `_Any*` are converted to their basic versions.
	// - `Function` also generates a const reference to `_Function`.
	// - union types generate const reference to `_Union`.
	public asParameterTypes(): ReadonlyArray<Type> {
		const unionTypes = [];
		const overloadTypes = [];
		const types = this.getAllTypes();

		if (types.length === 0) {
			return [ANY_TYPE.constReference()]
		}

		for (const type of types) {
			const inner = type.getType();

			if (inner.getName() === "Function") {
				unionTypes.push(type);
				overloadTypes.push(TemplateType.createFunction(VOID_TYPE).constReference());
			} else if (inner.getName() === "String" || inner.getName() === "_Function" || inner.getName() === "_Any") {
				overloadTypes.push(inner.constReference());
			} else if (inner.getName() === "EventListener" || inner.getName() === "EventListenerObject") {
				// EventListener is never put into `_Union` types, because very
				// often there will also be an overload for `_Function`, and
				// the conversion would be ambiguous.
				overloadTypes.push(inner.pointer());
			} else {
				unionTypes.push(type);

				// If the type has any generic parameters, we also generate an
				// overload for this type to help with template argument
				// deduction.
				if (inner.hasGenerics()) {
					overloadTypes.push(type.getPointerOrPrimitive(true));
				}
			}
		}

		if (unionTypes.some(type => type.getType() === ANY_TYPE)) {
			overloadTypes.push(ANY_TYPE.constReference());
		} else if (unionTypes.length >= 1) {
			const transformedTypes = unionTypes.map(type => type.getPointerOrPrimitive(true));
			overloadTypes.push(TemplateType.createUnion(TypeQualifier.ConstReference, ...transformedTypes));
		}

		return overloadTypes;
	}

	// Used to generate the arguments and return values of callback types.
	// Both `T` and `U` in `_Function<T(U...)>` are generated using this
	// method.
	public asCallbackType(): Type {
		return this.getUnion(ANY_TYPE.pointer());
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
