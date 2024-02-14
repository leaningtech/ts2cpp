import { Expression } from "./expression.js";

// A C++ type, like `TArray<String*>*`. Types are not too different from
// expressions, they just have some utility functions for operations that can
// only be applied to types, and having a separate type for types gives some
// type safety. `Type` being a cubclass of `Expression` is convenient when
// both are acceptable, for example the type parameters of a `TemplateType`,
// then we can just use `Expression`.
export abstract class Type extends Expression {
	// Add qualifier to the type. For example, this turns
	// `NamedType.create("String").qualify(Pointer)` into `String*`.
	public qualify(qualifier: TypeQualifier): QualifiedType {
		return QualifiedType.create(this, qualifier);
	}
	
	public pointer(): QualifiedType {
		return this.qualify(TypeQualifier.Pointer);
	}

	public constPointer(): QualifiedType {
		return this.qualify(TypeQualifier.ConstPointer);
	}

	public reference(): QualifiedType {
		return this.qualify(TypeQualifier.Reference);
	}

	public constReference(): QualifiedType {
		return this.qualify(TypeQualifier.ConstReference);
	}

	public expand(): QualifiedType {
		return this.qualify(TypeQualifier.Variadic);
	}

	public rValueReference(): QualifiedType {
		return this.qualify(TypeQualifier.RValueReference);
	}

	// Get a member type of this type. For example
	// `typename Container::iterator`.
	public getMemberType(name: string): MemberType {
		return MemberType.create(this, name);
	}

	// A type always references itself.
	//
	// Don't confuse this with `getDependencies`! When we call
	// `getReferencedTypes` on `String` we *want* it to return `String`.
	public getReferencedTypes(): ReadonlyArray<Type> {
		return [this];
	}

	// Get a name for this type, if available. Subclasses should override this
	// if they can give a reasonable name for the type.
	public getName(): string | undefined {
		return undefined;
	}

	// If this is a generic type and all type arguments are `_Any*`, return the
	// basic version of this type. For example, this turns `TArray<_Any*>` into
	// `Array`. `TemplateType` overrides this to provide this functionality.
	public orBasic(): Type {
		return this;
	}

	// Check recursively if the type references any type arguments of a
	// template declaration.
	public hasGenerics(): boolean {
		return this.getReferencedTypes().some(type => type instanceof GenericType);
	}
}

// A type to mark that this type has no qualifiers, this is used to restrict
// what types are allowed in some functions for extra type safety. For example,
// we can't create a `Array*<String>`, because `TemplateType` does not accept
// qualified types.
export abstract class UnqualifiedType extends Type {
}

import { TypeQualifier, QualifiedType } from "./qualifiedType.js";
import { MemberType } from "./memberType.js";
import { GenericType } from "./genericType.js";
