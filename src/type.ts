import { Namespace } from "./namespace.js";
import { Declaration } from "./declaration.js";
import { Writer } from "./writer.js";
import { Dependencies, Dependency, State } from "./target.js";

export abstract class Expression {
	public abstract getDependencies(reason: Dependency): Dependencies;
	public abstract getNamedTypes(): ReadonlySet<string>;
	public abstract write(writer: Writer, namespace?: Namespace): void;
	public abstract key(): string;

	public static enableIf(condition: Expression, type?: Type): TemplateType {
		const result = new TemplateType(ENABLE_IF);
		result.addTypeParameter(condition);

		if (type) {
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

	public static isAcceptable(from: Type, to: Type): TemplateType {
		const result = new TemplateType(IS_ACCEPTABLE);
		result.addTypeParameter(from);
		result.addTypeParameter(to);
		return result;
	}

	public static or(...children: ReadonlyArray<Expression>): ValueExpression {
		const result = new ValueExpression(ExpressionKind.LogicalOr);

		for (const expression of children) {
			result.addChild(expression);
		}

		return result;
	}

	public static and(...children: ReadonlyArray<Expression>): ValueExpression {
		const result = new ValueExpression(ExpressionKind.LogicalAnd);

		for (const expression of children) {
			result.addChild(expression);
		}

		return result;
	}
}

export enum ExpressionKind {
	LogicalAnd,
	LogicalOr,
};

export class ValueExpression extends Expression {
	private readonly children: Array<Expression> = new Array;
	private readonly kind: ExpressionKind;

	public constructor(kind: ExpressionKind) {
		super();
		this.kind = kind;
	}

	public getChildren(): ReadonlyArray<Expression> {
		return this.children;
	}

	public addChild(expression: Expression): void {
		if (!this.children.map(child => child.key()).includes(expression.key())) {
			this.children.push(expression);
		}
	}

	public getDependencies(reason: Dependency): Dependencies {
		const partialReason = reason.withState(State.Partial);
		return new Dependencies(this.children.flatMap(expression => [...expression.getDependencies(partialReason)]));
	}
	
	public getNamedTypes(): ReadonlySet<string> {
		return new Set(this.children.flatMap(expression => [...expression.getNamedTypes()]));
	}

	public write(writer: Writer, namespace?: Namespace): void {
		if (this.children.length === 0) {
			switch (this.kind) {
			case ExpressionKind.LogicalAnd:
				writer.write("true");
				break;
			case ExpressionKind.LogicalOr:
				writer.write("false");
				break;
			}
		} else if (this.children.length === 1) {
			this.children[0].write(writer, namespace);
		} else {
			let first = true;
			writer.write("(");

			for (const expression of this.children) {
				if (!first) {
					writer.writeSpace(false);

					switch (this.kind) {
					case ExpressionKind.LogicalAnd:
						writer.write("&&");
						break;
					case ExpressionKind.LogicalOr:
						writer.write("||");
						break;
					}

					writer.writeSpace(false);
				}

				expression.write(writer, namespace);
				first = false;
			}

			writer.write(")");
		}
	}

	public key(): string {
		const children = this.children.map(child => child.key()).join("");

		switch (this.kind) {
		case ExpressionKind.LogicalAnd:
			return `&${children};`;
		case ExpressionKind.LogicalOr:
			return `|${children};`;
		}
	}
}

export enum TypeQualifier {
	Pointer = 1,
	Reference = 2,
	Const = 4,
	Variadic = 8,
	ConstPointer = Const | Pointer,
	ConstReference = Const | Reference,
}

export abstract class Type extends Expression {
	public qualify(qualifier: TypeQualifier): QualifiedType {
		return new QualifiedType(this, qualifier);
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

	public getMemberType(name: string) {
		return new MemberType(this, name);
	}
}

export abstract class UnqualifiedType extends Type {
}

export class DeclaredType extends UnqualifiedType {
	private readonly declaration: Declaration;

	public constructor(declaration: Declaration) {
		super();
		this.declaration = declaration;
	}

	public getDeclaration(): Declaration {
		return this.declaration;
	}

	public getDependencies(reason: Dependency): Dependencies {
		return new Dependencies([[this.declaration, reason]]);
	}
	
	public getNamedTypes(): ReadonlySet<string> {
		return new Set;
	}

	public write(writer: Writer, namespace?: Namespace): void {
		writer.write(this.declaration.getPath(namespace));
	}

	public key(): string {
		return `D${this.declaration.getId()}`;
	}
}

export class NamedType extends UnqualifiedType {
	private readonly name: string;

	public constructor(name: string) {
		super();
		this.name = name;
	}

	public getName(): string {
		return this.name;
	}

	public getDependencies(reason: Dependency): Dependencies {
		return new Dependencies;
	}
	
	public getNamedTypes(): ReadonlySet<string> {
		return new Set([this.name]);
	}

	public write(writer: Writer, namespace?: Namespace): void {
		writer.write(this.name);
	}

	public key(): string {
		return `N${this.name};`;
	}
}

export class MemberType extends UnqualifiedType {
	private readonly inner: Type;
	private readonly name: string;

	public constructor(inner: Type, name: string) {
		super();
		this.inner = inner;
		this.name = name;
	}

	public getInner(): Type {
		return this.inner;
	}

	public getName(): string {
		return this.name;
	}

	public getDependencies(reason: Dependency): Dependencies {
		return this.inner.getDependencies(reason.withState(State.Complete));
	}
	
	public getNamedTypes(): ReadonlySet<string> {
		return this.inner.getNamedTypes();
	}

	public write(writer: Writer, namespace?: Namespace): void {
		writer.write("typename");
		writer.writeSpace();
		this.inner.write(writer, namespace);
		writer.write("::");
		writer.write(this.name);
	}

	public key(): string {
		return `Y${this.inner.key()}${this.name};`;
	};
}

export class QualifiedType extends Type {
	private readonly inner: Type;
	private readonly qualifier: TypeQualifier;

	public constructor(inner: Type, qualifier: TypeQualifier) {
		super();
		this.inner = inner;
		this.qualifier = qualifier;
	}

	public getInner(): Type {
		return this.inner;
	}

	public getQualifier(): TypeQualifier {
		return this.qualifier;
	}

	public getDependencies(reason: Dependency): Dependencies {
		if (this.qualifier & (TypeQualifier.Pointer | TypeQualifier.Reference)) {
			return this.inner.getDependencies(reason.withState(State.Partial));
		} else {
			return this.inner.getDependencies(reason);
		}
	}
	
	public getNamedTypes(): ReadonlySet<string> {
		return this.inner.getNamedTypes();
	}

	public write(writer: Writer, namespace?: Namespace): void {
		if (this.qualifier & TypeQualifier.Const) {
			writer.write("const");
			writer.writeSpace();
		}

		this.getInner().write(writer, namespace);

		if (this.qualifier & TypeQualifier.Pointer) {
			writer.write("*");
		}
		
		if (this.qualifier & TypeQualifier.Reference) {
			writer.write("&");
		}

		if (this.qualifier & TypeQualifier.Variadic) {
			writer.write("...");
		}
	}
	
	public key(): string {
		return `Q${this.qualifier}${this.inner.key()}`;
	}
}

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

	public getDependencies(reason: Dependency): Dependencies {
		const partialReason = reason.withState(State.Partial);

		return new Dependencies(
			this.typeParameters
				.flatMap(typeParameter => [...typeParameter.getDependencies(partialReason)])
				.concat([...this.inner.getDependencies(reason)])
		);
	}
	
	public getNamedTypes(): ReadonlySet<string> {
		return new Set(
			this.typeParameters
				.flatMap(typeParameter => [...typeParameter.getNamedTypes()])
				.concat([...this.inner.getNamedTypes()])
		);
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
}

export class FunctionType extends Type {
	private readonly returnType: Type;
	private readonly parameters: Array<Type> = new Array;

	public constructor(returnType: Type) {
		super();
		this.returnType = returnType;
	}

	public getReturnType(): Type {
		return this.returnType;
	}

	public getParameters(): ReadonlyArray<Type> {
		return this.parameters;
	}

	public addParameter(parameter: Type): void {
		this.parameters.push(parameter);
	}

	public getDependencies(reason: Dependency): Dependencies {
		const partialReason = reason.withState(State.Partial);

		return new Dependencies(
			this.parameters
				.flatMap(typeParameter => [...typeParameter.getDependencies(partialReason)])
				.concat([...this.returnType.getDependencies(partialReason)])
		);
	}

	public getNamedTypes(): ReadonlySet<string> {
		return new Set(
			this.parameters
				.flatMap(parameter => [...parameter.getNamedTypes()])
				.concat([...this.returnType.getNamedTypes()])
		);
	}

	public write(writer: Writer, namespace?: Namespace): void {
		let first = true;
		this.returnType.write(writer, namespace);
		writer.write("(");

		for (const parameter of this.parameters) {
			if (!first) {
				writer.write(",");
				writer.writeSpace(false);
			}

			parameter.write(writer, namespace);
			first = false;
		}

		writer.write(")");
	}

	public key(): string {
		const parameters = this.parameters
			.map(parameter => parameter.key()).join("");

		return `f${this.returnType.key()}${parameters};`;
	}
}

import { ENABLE_IF, IS_SAME, IS_CONVERTIBLE, IS_ACCEPTABLE } from "./types.js";
