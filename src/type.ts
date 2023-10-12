import { Namespace } from "./namespace.js";
import { Declaration } from "./declaration.js";
import { Writer } from "./writer.js";

export abstract class Expression {
	public abstract getDeclarations(): ReadonlyArray<Declaration>;
	public abstract write(writer: Writer, namespace?: Namespace): void;

	public static enableIf(condition: Expression, type?: Type): TemplateType {
		const result = new TemplateType(new FakeType("std::enable_if_t"));
		result.addTypeParameter(condition);

		if (type) {
			result.addTypeParameter(type);
		}

		return result;
	}

	public static isSame(lhs: Type, rhs: Type): TemplateType {
		const result = new TemplateType(new FakeType("std::is_same_v"));
		result.addTypeParameter(lhs);
		result.addTypeParameter(rhs);
		return result;
	}

	public static isConvertible(from: Type, to: Type): TemplateType {
		const result = new TemplateType(new FakeType("std::is_convertible_v"));
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
		if (this.children.length == 1) {
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
}

export class OrExpression extends Value {
	public write(writer: Writer, namespace?: Namespace): void {
		this.writeDelim(writer, "||", namespace);
	}
}

export class AndExpression extends Value {
	public write(writer: Writer, namespace?: Namespace): void {
		this.writeDelim(writer, "&&", namespace);
	}
}

export abstract class Type extends Expression {
	public pointer(): PointerType {
		return new PointerType(this);
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
}

export class FakeType extends UnqualifiedType {
	private readonly name: string;

	public constructor(name: string) {
		super();
		this.name = name;
	}

	public getDeclarations(): ReadonlyArray<Declaration> {
		return [];
	}

	public getName(): string {
		return this.name;
	}

	public write(writer: Writer, namespace?: Namespace): void {
		writer.write(this.name);
	}
}

export class PointerType extends Type {
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

	public write(writer: Writer, namespace?: Namespace): void {
		this.inner.write(writer, namespace);
		writer.write("*");
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
}
