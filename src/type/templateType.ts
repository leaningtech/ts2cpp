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

	public getDependencies(reason: Dependency, innerState?: State): Dependencies {
		let hasConstraints = false;
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

	public isVoidLike(): boolean {
		const key = this.inner.key();

		if (key === ENABLE_IF.key()) {
			return this.typeParameters[1].isVoidLike();
		} else {
			return false;
		}
	}
	
	public static enableIf(condition: Expression, type?: Type): Type {
		if (condition.isAlwaysTrue()) {
			return type ?? VOID_TYPE;
		}

		const result = new TemplateType(ENABLE_IF);

		if (type instanceof TemplateType && type.getInner() === ENABLE_IF) {
			const [otherCondition, otherType] = type.getTypeParameters();
			condition = CompoundExpression.and(condition, otherCondition);
			type = otherType as Type;
		}

		result.addTypeParameter(condition);

		if (type) {
			result.addTypeParameter(type);
		}

		return result;
	}

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

	public static isSame(lhs: Type, rhs: Type): TemplateType {
		const result = new TemplateType(IS_SAME);
		result.addTypeParameter(lhs);
		result.addTypeParameter(rhs);
		return result;
	}

	public static isConvertible(from: Type, to: Type): TemplateType {
		const result = new TemplateType(IS_CONVERTIBLE);
		result.addTypeParameter(from);
		result.addTypeParameter(to);
		return result;
	}

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
