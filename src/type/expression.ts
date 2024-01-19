import { Dependency, State, Dependencies } from "../target.js";
import { Type } from "./type.js";
import { Writer, StringWriter } from "../writer.js";
import { Namespace } from "../declaration/namespace.js";
import { Key, options } from "../utility.js";

// An ordinary C++ expression, like `std::is_same_v<T, double>`. Types are also
// expressions, see "src/type/type.ts" for more info.
export abstract class Expression implements Key {
	// Return all dependencies of this type. Some compound types depend on
	// multiple declarations, for example, `Array<String*>*` depends on both
	// `Array` and `String`.
	//
	// `innerState` is a hack to force pointer types to depend on a complete
	// declaration of their inner type. Usually a pointer type, such as
	// `String*` only requires a forward declaration of it's inner type,
	// `String`. But when trying to cast to a base class, for example, the cast
	// will fail if we don't have a complete declaration. When the type is used
	// in such an expression, `innerState` will be set to `Complete`, and
	// pointer types will return a complete dependency on its inner type.
	//
	// It's not perfect, but it works well enough.
	public abstract getDependencies(reason: Dependency, innerState?: State): Dependencies;

	// All the types referenced in this expression. This is like a simpler
	// version of `getDependencies`. Some declarations call this to compute
	// their referenced types, see `getReferencedTypes` in
	// "src/declaration/declaration.ts" for more info.
	public abstract getReferencedTypes(): ReadonlyArray<Type>;

	// Write the type. The `namespace` is the namespace in which the expression
	// is being written, and can be used to abbreviate class paths.
	public abstract write(writer: Writer, namespace?: Namespace): void;
	
	// Returns a key that identifies this expression, it is used for removing
	// duplicate expressions. The key should be specific enough so we don't
	// remove any expressions that aren't actually duplicates, but it should
	// should not allow conflicting overloads to exist together.
	public abstract key(): string;

	// This function is used to evaluate some simple expressions at compile
	// time. For example, any `std::enable_if_t<std::is_same_v<T, T>, U>` can
	// be replaced with just `U`.
	public isAlwaysTrue(): boolean {
		return false;
	}

	// `isVoidLike` is used in an attempt to omit the `return` statement when
	// generating code in a function that is supposed to return this type. This
	// function can almost definitely return incorrect values for more complex
	// type expressions, but it works well enough for now.
	public isVoidLike(): boolean {
		return false;
	}

	// Return the raw type with any qualifiers removed. This turns
	// `const Array<String*>*` into `Array<String*>`.
	public removeQualifiers(): Expression {
		return this;
	}

	// Turn the type into a string, the string should (hopefully) be valid C++.
	public toString(namespace?: Namespace): string {
		const writer = new StringWriter({ pretty: options.isPretty });
		this.write(writer, namespace);
		return writer.getString();
	}
}
