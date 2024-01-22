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
import { removeDuplicates } from "../utility.js";

// A template type is a generic type with template arguments
// (`TArray<String*>`).
export class TemplateType extends Type {
	private readonly inner: UnqualifiedType;
	private readonly typeParameters: Array<Expression> = new Array;

	public constructor(inner: UnqualifiedType) {
		super();
		this.inner = inner;
	}

	public getInner(): UnqualifiedType {
		return this.inner;
	}

	public getTypeParameters(): ReadonlyArray<Expression> {
		return this.typeParameters;
	}

	public addTypeParameter(typeParameter: Expression): void {
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
			this.typeParameters
				.flatMap(typeParameter => [...typeParameter.getDependencies(reason, state)])
				.concat([...this.inner.getDependencies(reason)])
		);
	}
	
	public getReferencedTypes(): ReadonlyArray<Type> {
		return this.typeParameters
			.flatMap(typeParameter => [...typeParameter.getReferencedTypes()])
			.concat([this, ...this.inner.getReferencedTypes()]);
	}

	public write(writer: Writer, namespace?: Namespace): void {
		let first = true;
		this.inner.write(writer, namespace);
		writer.write("<");

		for (const typeParameter of this.typeParameters) {
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
		const typeParameters = this.typeParameters
			.map(typeParameter => typeParameter.key()).join("");

		return `T${this.inner.key()}${typeParameters};`;
	}

	// A template type is always true if:
	// - it's `std::is_same_v<T, U>` where T and U refer to the same type.
	// - it's `IsAcceptableV<T, U...>` where U includes the type `_Any*`.
	public isAlwaysTrue(): boolean {
		const key = this.inner.key();

		if (key === IS_SAME.key()) {
			return this.typeParameters[0].key() === this.typeParameters[1].key();
		} else if (key === IS_ACCEPTABLE.key()) {
			return this.typeParameters.slice(1).map(typeParameter => typeParameter.key()).includes(ANY_TYPE.pointer().key());
		} else {
			return false;
		}
	}

	// A template type is void-like if it's `std::enable_if_t<T>` and `T` is
	// void-like.
	public isVoidLike(): boolean {
		const key = this.inner.key();

		if (key === ENABLE_IF.key()) {
			return this.typeParameters[1].isVoidLike();
		} else {
			return false;
		}
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

		const result = new TemplateType(ENABLE_IF);

		result.addTypeParameter(condition);

		if (type) {
			result.addTypeParameter(type);
		}

		return result;
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

		const result = new TemplateType(ARRAY_ELEMENT_TYPE);
		result.addTypeParameter(array);
		return result;
	}

	// Construct a `_Union<T...>` template.
	//
	// Any duplicates in the argument list are removed first.
	public static union(...types: ReadonlyArray<Type>): Type {
		const result = new TemplateType(UNION_TYPE);
		const anyTypePointerKey = ANY_TYPE.pointer().key();

		for (const type of removeDuplicates(types)) {
			if (type.key() === anyTypePointerKey) {
				return ANY_TYPE;
			}

			result.addTypeParameter(type);
		}

		return result;
	}

	// Construct a `std::is_same_v<T, U>` template.
	public static isSame(lhs: Type, rhs: Type): TemplateType {
		const result = new TemplateType(IS_SAME);
		result.addTypeParameter(lhs);
		result.addTypeParameter(rhs);
		return result;
	}

	// Construct a `std::is_convertible_v<T, U>` template.
	public static isConvertible(from: Type, to: Type): TemplateType {
		const result = new TemplateType(IS_CONVERTIBLE);
		result.addTypeParameter(from);
		result.addTypeParameter(to);
		return result;
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
		const anyTypePointerKey = ANY_TYPE.pointer().key();
		const result = new TemplateType(IS_ACCEPTABLE);
		result.addTypeParameter(from);
		
		if (to.some(type => type.key() === anyTypePointerKey)) {
			return TRUE;
		}

		for (const type of removeDuplicates(to)) {
			result.addTypeParameter(type);
		}

		return result;
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
		const anyTypePointerKey = ANY_TYPE.pointer().key();
		const result = new TemplateType(IS_ACCEPTABLE_ARGS);
		result.addTypeParameter(from);
		
		if (to.some(type => type.key() === anyTypePointerKey)) {
			return TRUE;
		}

		for (const type of removeDuplicates(to)) {
			result.addTypeParameter(type);
		}

		return result;
	}
}
