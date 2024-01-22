import { Type, UnqualifiedType } from "./type.js";
import { DeclaredType } from "./declaredType.js";
import { Expression } from "./expression.js";
import { Dependency, State, Dependencies } from "../target.js";
import { Class } from "../declaration/class.js";
import { Writer } from "../writer.js";
import { Namespace } from "../declaration/namespace.js";
import { LiteralExpression, TRUE } from "./literalExpression.js";
import { CompoundExpression } from "./compoundExpression.js";
import { VOID_TYPE, ENABLE_IF, ANY_TYPE, ARRAY_ELEMENT_TYPE, UNION_TYPE, IS_SAME, IS_CONVERTIBLE, IS_ACCEPTABLE, IS_ACCEPTABLE_ARGS } from "./namedType.js";
import { removeDuplicateExpressions } from "./expression.js";

// A template type is a generic type with template arguments
// (`TArray<String*>`).
export class TemplateType extends Type {
	private readonly inner: UnqualifiedType;
	private typeParameters?: Array<Expression>;

	private constructor(inner: UnqualifiedType) {
		super();
		this.inner = inner;
	}

	public getInner(): UnqualifiedType {
		return this.inner;
	}

	public getTypeParameters(): ReadonlyArray<Expression> {
		return this.typeParameters ?? [];
	}

	// This is unsafe because `TemplateType` should be immutable. There is a
	// rare case where we need to modify it, but we should be very careful when
	// doing so.
	public addTypeParameterUnsafe(typeParameter: Expression): void {
		this.typeParameters ??= [];
		this.typeParameters.push(typeParameter);
	}

	// The dependencies of a template type are:
	// - the type parameters.
	// - the inner type.
	//
	// If the inner type is a class declaration with constraints, then any
	// pointer types declared in this template must have a complete dependency
	// on their inner type, so the contraints can be properly verified. this is
	// done by passing `Complete` as the `innerState` to `getDependencies` on
	// the type parameters.
	public getDependencies(reason: Dependency, innerState?: State): Dependencies {
		let state: State | undefined = undefined;

		if (this.inner instanceof DeclaredType) {
			const declaration = this.inner.getDeclaration();

			if (declaration instanceof Class && declaration.hasConstraints()) {
				state = reason.getState();
			}
		}

		return new Dependencies(
			this.getTypeParameters()
				.flatMap(typeParameter => [...typeParameter.getDependencies(reason, state)])
				.concat([...this.inner.getDependencies(reason)])
		);
	}
	
	public getReferencedTypes(): ReadonlyArray<Type> {
		return this.getTypeParameters()
			.flatMap(typeParameter => [...typeParameter.getReferencedTypes()])
			.concat([this, ...this.inner.getReferencedTypes()]);
	}

	public write(writer: Writer, namespace?: Namespace): void {
		let first = true;
		this.inner.write(writer, namespace);
		writer.write("<");

		for (const typeParameter of this.getTypeParameters()) {
			if (!first) {
				writer.write(",");
				writer.writeSpace(false);
			}

			typeParameter.write(writer, namespace);
			first = false;
		}

		writer.write(">");
	}

	public key(): string {
		const typeParameters = this.getTypeParameters()
			.map(typeParameter => typeParameter.key()).join("");

		return `T${this.inner.key()}${typeParameters};`;
	}

	// A template type is always true if:
	// - it's `std::is_same_v<T, U>` where T and U refer to the same type.
	// - it's `IsAcceptableV<T, U...>` where U includes the type `_Any*`.
	public isAlwaysTrue(): boolean {
		if (this.inner === IS_SAME) {
			return this.getTypeParameters()[0] === this.getTypeParameters()[1];
		} else if (this.inner === IS_ACCEPTABLE) {
			return this.getTypeParameters().slice(1).includes(ANY_TYPE.pointer());
		} else {
			return false;
		}
	}

	// A template type is void-like if it's `std::enable_if_t<T>` and `T` is
	// void-like.
	public isVoidLike(): boolean {
		if (this.inner === ENABLE_IF) {
			return this.getTypeParameters()[1].isVoidLike();
		} else {
			return false;
		}
	}

	public getName(): string | undefined {
		return this.inner.getName();
	}

	// A version of `create` that does not intern the template type. Attempting
	// to use the return value of this function may break things in subtle ways
	// and should only be done with extreme caution.
	public static createUnsafe(inner: UnqualifiedType): TemplateType {
		return new TemplateType(inner);
	}

	public static create(inner: UnqualifiedType, ...typeParameters: ReadonlyArray<Expression>): TemplateType {
		const result = new TemplateType(inner);

		if (typeParameters.length > 0) {
			result.typeParameters = [...typeParameters];
		}

		return result.intern();
	}
	
	// Construct an `std::enable_if_t` template.
	//
	// If the condition is always true, we do not construct an
	// `std::enable_if_t` template, and instead just return the type.
	//
	// If `type` is also a `std::enable_if_t` template, we simply combine the
	// conditions. So `std::enable_if_t<A, std::enable_if_t<B, C>>` becomes
	// just `std::enable_if_t<(A && B), C>`.
	public static enableIf(condition: Expression, type?: Type): Type {
		if (condition.isAlwaysTrue()) {
			return type ?? VOID_TYPE;
		}

		if (type instanceof TemplateType && type.getInner() === ENABLE_IF) {
			const [otherCondition, otherType] = type.getTypeParameters();
			condition = CompoundExpression.and(condition, otherCondition);
			type = otherType as Type;
		}

		if (type) {
			return TemplateType.create(ENABLE_IF, condition, type);
		} else {
			return TemplateType.create(ENABLE_IF, condition);
		}
	}

	// Construct an `ArrayElementTypeT` template.
	//
	// If `array` has the form `TArray<T>`, we do not construct an
	// `ArrayElementTypeT`, and instead return `T`.
	//
	// If `array` is the `Array` type, we do not construct an
	// `ArrayElementTypeT`, and instead return `_Any`.
	//
	// This function assumes that any `DeclaredType` is an array type.
	public static arrayElementType(array: Type): Type {
		const rawArray = array.removeQualifiers();

		if (rawArray instanceof TemplateType) {
			if (rawArray.getInner() instanceof DeclaredType) {
				return rawArray.getTypeParameters()[0] as Type;
			}
		}

		if (rawArray instanceof DeclaredType) {
			return ANY_TYPE.pointer();
		}

		return TemplateType.create(ARRAY_ELEMENT_TYPE, array);
	}

	// Construct a `_Union<T...>` template.
	//
	// Any duplicates in the argument list are removed first.
	public static union(...types: ReadonlyArray<Type>): Type {
		const typeParameters = [];

		for (const type of removeDuplicateExpressions(types)) {
			if (type === ANY_TYPE.pointer()) {
				return ANY_TYPE;
			}

			typeParameters.push(type);
		}

		return TemplateType.create(UNION_TYPE, ...typeParameters);
	}

	// Construct a `std::is_same_v<T, U>` template.
	public static isSame(lhs: Type, rhs: Type): TemplateType {
		return TemplateType.create(IS_SAME, lhs, rhs);
	}

	// Construct a `std::is_convertible_v<T, U>` template.
	public static isConvertible(from: Type, to: Type): TemplateType {
		return TemplateType.create(IS_CONVERTIBLE, from, to);
	}

	// Construct a `IsAcceptableV<T, U...>` template.
	//
	// If U includes the `_Any` type, we do not construct a `IsAcceptableV`
	// template, and instead return `true`.
	//
	// `IsAcceptableV` is much like `std::is_convertible_v`, but it allows some
	// extra conversions according to typescript rules. For example,
	// `IsAcceptableV<double, _Any*>` returns true, while
	// `std::is_convertible_v<double, _Any*>` returns false.
	public static isAcceptable(from: Type, ...to: ReadonlyArray<Type>): Expression {
		if (to.includes(ANY_TYPE.pointer())) {
			return TRUE;
		}

		return TemplateType.create(IS_ACCEPTABLE, from, ...removeDuplicateExpressions(to));
	}

	// Construct a `IsAcceptableArgsV<T, U...>` template.
	//
	// If U includes the `_Any` type, we do not construct a `IsAcceptableV`
	// template, and instead return `true`.
	//
	// This template is identical to `IsAcceptableV`, except that it also
	// allows `T` to be `const char*` when `U` includes `String*`. The actual
	// conversion from `const char*` to `String*` is handled by
	// `cheerp::clientCast`, which is only called in variadic functions (for
	// now).
	public static isAcceptableArgs(from: Type, ...to: ReadonlyArray<Type>): Expression {
		if (to.includes(ANY_TYPE.pointer())) {
			return TRUE;
		}

		return TemplateType.create(IS_ACCEPTABLE_ARGS, from, ...removeDuplicateExpressions(to));
	}
}
