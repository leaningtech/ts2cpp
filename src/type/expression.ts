import { Dependency, State, Dependencies } from "../target.js";
import { Type } from "./type.js";
import { Writer, StringWriter } from "../writer.js";
import { Namespace } from "../declaration/namespace.js";
import { options } from "../utility.js";

const EXPRESSIONS = new Map;

// An ordinary C++ expression, like `std::is_same_v<T, double>`. Types are also
// expressions, see "src/type/type.ts" for more info.
//
// Expressions are interned (using the `intern` function), meaning that every
// distinct expression shares one instance. The `EXPRESSIONS` map tracks
// expression instances for the purpose of interning.
export abstract class Expression {
	public static getCount(): number {
		return EXPRESSIONS.size;
	}

	// Return all dependencies of this type. Some compound types depend on
	// multiple declarations, for example, `TArray<String*>*` depends on both
	// `TArray` and `String`.
	//
	// `reason` includes the following information:
	// - Is this dependency on the complete type or just a forward declaration?
	// - What declaration is the *dependent* of this dependency?
	// - What is the dependency needed for? Return type? Base class? etc.
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
	// `const TArray<String*>*` into `TArray<String*>`.
	public removeQualifiers(): Expression {
		return this;
	}

	// Turn the type into a string, the string should (hopefully) be valid C++.
	public toString(namespace?: Namespace): string {
		const writer = new StringWriter({ pretty: options.isPretty });
		this.write(writer, namespace);
		return writer.getString();
	}

	protected intern(): this {
		const key = this.key();
		const value = EXPRESSIONS.get(key);

		if (value) {
			return value;
		}

		EXPRESSIONS.set(key, this);
		return this;
	}

	// A public version of `intern`, this is called unsafe because it should
	// only be used with `createUnsafe` functions, which are very dangerous.
	public internUnsafe(): this {
		return this.intern();
	}
}

// Returns a new array where every key occurs at most once.
export function removeDuplicateExpressions<T extends Expression>(expressions: ReadonlyArray<T>): Array<T> {
	return [...new Set(expressions)];
}
