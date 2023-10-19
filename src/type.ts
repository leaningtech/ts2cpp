import { Namespace } from "./namespace.js";
import { Declaration } from "./declaration.js";
import { Writer } from "./writer.js";

export abstract class Expression {
	public abstract getDeclarations(): ReadonlyArray<Declaration>;
	public abstract write(writer: Writer, namespace?: Namespace): void;
	public abstract key(): string;

	public static enableIf(condition: Expression, type?: Type): TemplateType {
		const result = new TemplateType(new NamedType("std::enable_if_t"));
		result.addTypeParameter(condition);

		if (type) {
			result.addTypeParameter(type);
		}

		return result;
	}

	public static isSame(lhs: Type, rhs: Type): TemplateType {
		const result = new TemplateType(new NamedType("std::is_same_v"));
		result.addTypeParameter(lhs);
		result.addTypeParameter(rhs);
		return result;
	}

	public static isConvertible(from: Type, to: Type): TemplateType {
		const result = new TemplateType(new NamedType("std::is_convertible_v"));
		result.addTypeParameter(from);
		result.addTypeParameter(to);
		return result;
	}

	public static or(...children: ReadonlyArray<Expression>): ValueExpression {
		const result = new ValueExpression("||");

		for (const expression of children) {
			result.addChild(expression);
		}

		return result;
	}

	public static and(...children: ReadonlyArray<Expression>): ValueExpression {
		const result = new ValueExpression("&&");

		for (const expression of children) {
			result.addChild(expression);
		}

		return result;
	}
}

export class ValueExpression extends Expression {
	private readonly children: Array<Expression> = new Array;
	private readonly delim: string;

	public constructor(delim: string) {
		super();
		this.delim = delim;
	}

	public getChildren(): ReadonlyArray<Expression> {
		return this.children;
	}

	public addChild(expression: Expression): void {
		this.children.push(expression);
	}
	
	public getDeclarations(): ReadonlyArray<Declaration> {
		return this.children.flatMap(expression => expression.getDeclarations());
	}

	public write(writer: Writer, namespace?: Namespace): void {
		if (this.children.length === 1) {
			this.children[0].write(writer, namespace);
		} else {
			let first = true;
			writer.write("(");

			for (const expression of this.children) {
				if (!first) {
					writer.writeSpace(false);
					writer.write(this.delim);
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
		return `${this.delim[0]}${children};`;
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

	public getDeclarations(): ReadonlyArray<Declaration> {
		return new Array;
	}

	public write(writer: Writer, namespace?: Namespace): void {
		writer.write(this.name);
	}

	public key(): string {
		return `N${this.name};`;
	}
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

	public getDeclarations(): ReadonlyArray<Declaration> {
		return this.inner.getDeclarations();
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

	public key(): string {
		const typeParameters = this.typeParameters
			.map(typeParameter => typeParameter.key()).join("");

		return `T${this.inner.key()}${typeParameters};`;
	}
}
