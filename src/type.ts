import { Namespace } from "./namespace.js";
import { Declaration } from "./declaration.js";
import { Writer } from "./writer.js";

export abstract class Expression {
	public abstract getDeclarations(): ReadonlyArray<Declaration>;
	public abstract write(writer: Writer, namespace?: Namespace): void;
	public abstract equals(other: Expression): boolean;

	public static enableIf(condition: Expression, type?: Type): TemplateType {
		const result = new TemplateType(new ExternType("std::enable_if_t"));
		result.addTypeParameter(condition);

		if (type) {
			result.addTypeParameter(type);
		}

		return result;
	}

	public static isSame(lhs: Type, rhs: Type): TemplateType {
		const result = new TemplateType(new ExternType("std::is_same_v"));
		result.addTypeParameter(lhs);
		result.addTypeParameter(rhs);
		return result;
	}

	public static isConvertible(from: Type, to: Type): TemplateType {
		const result = new TemplateType(new ExternType("std::is_convertible_v"));
		result.addTypeParameter(from);
		result.addTypeParameter(to);
		return result;
	}

	public static or(...children: ReadonlyArray<Expression>): OrExpression {
		const result = new OrExpression();

		for (const expression of children) {
			result.addChild(expression);
		}

		return result;
	}

	public static and(...children: ReadonlyArray<Expression>): AndExpression {
		const result = new AndExpression();

		for (const expression of children) {
			result.addChild(expression);
		}

		return result;
	}
}

export abstract class Value extends Expression {
	private readonly children: Array<Expression> = new Array;

	public getChildren(): ReadonlyArray<Expression> {
		return this.children;
	}

	public addChild(expression: Expression): void {
		this.children.push(expression);
	}
	
	public getDeclarations(): ReadonlyArray<Declaration> {
		return this.children.flatMap(expression => expression.getDeclarations());
	}

	public writeDelim(writer: Writer, delim: string, namespace?: Namespace): void {
		if (this.children.length === 1) {
			this.children[0].write(writer, namespace);
		} else {
			let first = true;
			writer.write("(");

			for (const expression of this.children) {
				if (!first) {
					writer.writeSpace(false);
					writer.write(delim);
					writer.writeSpace(false);
				}

				expression.write(writer, namespace);
				first = false;
			}

			writer.write(")");
		}
	}

	public childrenEquals(other: Value): boolean {
		if (this.children.length !== other.children.length) {
			return false;
		}

		for (let i = 0; i < this.children.length; i++) {
			if (!this.children[i].equals(other.children[i])) {
				return false;
			}
		}

		return true;
	}
}

export class OrExpression extends Value {
	public write(writer: Writer, namespace?: Namespace): void {
		this.writeDelim(writer, "||", namespace);
	}

	public equals(other: Expression): boolean {
		return other instanceof OrExpression && this.childrenEquals(other);
	}
}

export class AndExpression extends Value {
	public write(writer: Writer, namespace?: Namespace): void {
		this.writeDelim(writer, "&&", namespace);
	}

	public equals(other: Expression): boolean {
		return other instanceof AndExpression && this.childrenEquals(other);
	}
}

export enum TypeQualifier {
	Pointer,
	ConstPointer,
	Reference,
	ConstReference,
}

export abstract class Type extends Expression {
	public pointer(): PointerType {
		return new PointerType(this, false);
	}

	public constPointer(): PointerType {
		return new PointerType(this, true);
	}

	public reference(): ReferenceType {
		return new ReferenceType(this, false);
	}

	public constReference(): ReferenceType {
		return new ReferenceType(this, true);
	}

	public qualify(qualifier: TypeQualifier): Type {
		switch (qualifier) {
		case TypeQualifier.Pointer:
			return this.pointer();
		case TypeQualifier.ConstPointer:
			return this.constPointer();
		case TypeQualifier.Reference:
			return this.reference();
		case TypeQualifier.ConstReference:
			return this.constReference();
		}
	}

	public expand(): VariadicExpansionType {
		return new VariadicExpansionType(this);
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

	public getDeclarations(): ReadonlyArray<Declaration> {
		return [this.declaration];
	}

	public write(writer: Writer, namespace?: Namespace): void {
		writer.write(this.declaration.getPath(namespace));
	}

	public equals(other: Expression): boolean {
		return other instanceof DeclaredType && this.declaration === other.declaration;
	}
}

export abstract class NamedType extends UnqualifiedType {
	private readonly name: string;

	public constructor(name: string) {
		super();
		this.name = name;
	}

	public getName(): string {
		return this.name;
	}

	public getDeclarations(): ReadonlyArray<Declaration> {
		return new Array;
	}

	public write(writer: Writer, namespace?: Namespace): void {
		writer.write(this.name);
	}
}

export class ExternType extends NamedType {
	public equals(other: Expression): boolean {
		return other instanceof ExternType && this.getName() === other.getName();
	}
}

export class ParameterType extends NamedType {
	private readonly id: number;

	public constructor(name: string, id: number) {
		super(name);
		this.id = id;
	}

	public getId(): number {
		return this.id;
	}

	public equals(other: Expression): boolean {
		return other instanceof ParameterType && this.id == other.id;
	}
}

export abstract class WrapperType extends Type {
	private readonly inner: Type;

	public constructor(inner: Type) {
		super();
		this.inner = inner;
	}

	public getInner(): Type {
		return this.inner;
	}

	public getDeclarations(): ReadonlyArray<Declaration> {
		return this.inner.getDeclarations();
	}
}

export class VariadicExpansionType extends WrapperType {
	public write(writer: Writer, namespace?: Namespace): void {
		this.getInner().write(writer, namespace);
		writer.write("...");
	}

	public equals(other: Expression): boolean {
		return other instanceof VariadicExpansionType && this.getInner().equals(other.getInner());
	}
}

export class PointerType extends WrapperType {
	private readonly constness: boolean;

	public constructor(inner: Type, constness: boolean) {
		super(inner);
		this.constness = constness;
	}

	public isConst(): boolean {
		return this.constness;
	}

	public write(writer: Writer, namespace?: Namespace): void {
		if (this.constness) {
			writer.write("const");
			writer.writeSpace();
		}

		this.getInner().write(writer, namespace);
		writer.write("*");
	}

	public equals(other: Expression): boolean {
		return other instanceof PointerType && this.constness === other.constness && this.getInner().equals(other.getInner());
	}
}

export class ReferenceType extends WrapperType {
	private readonly constness: boolean;

	public constructor(inner: Type, constness: boolean) {
		super(inner);
		this.constness = constness;
	}

	public isConst(): boolean {
		return this.constness;
	}

	public write(writer: Writer, namespace?: Namespace): void {
		if (this.constness) {
			writer.write("const");
			writer.writeSpace();
		}

		this.getInner().write(writer, namespace);
		writer.write("&");
	}

	public equals(other: Expression): boolean {
		return other instanceof ReferenceType && this.constness === other.constness && this.getInner().equals(other.getInner());
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

	public getDeclarations(): ReadonlyArray<Declaration> {
		return this.typeParameters
			.flatMap(typeParameter => typeParameter.getDeclarations())
			.concat(this.inner.getDeclarations());
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

	public equals(other: Expression): boolean {
		if (!(other instanceof TemplateType)) {
			return false;
		}

		if (!this.inner.equals(other.inner)) {
			return false;
		}

		if (this.typeParameters.length !== other.typeParameters.length) {
			return false;
		}

		for (let i = 0; i < this.typeParameters.length; i++) {
			if (!this.typeParameters[i].equals(other.typeParameters[i])) {
				return false;
			}
		}

		return true;
	}
}
