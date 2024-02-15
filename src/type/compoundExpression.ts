import { Expression } from "./expression.js";
import { PlaceholderType } from "./placeholderType.js";
import { Dependency, State, Dependencies } from "../target.js";
import { Type } from "./type.js";
import { Writer } from "../writer.js";
import { Namespace } from "../declaration/namespace.js";

export enum ExpressionKind {
	// "&&"
	LogicalAnd,
	// "||"
	LogicalOr,
};

// A `CompoundExpression` is a list of subexpressions separated by a binary
// operator, such as `A || B || C`. All operators are the same, to mix them
// you must construct nested `CompoundExpressions`.
export class CompoundExpression extends Expression {
	private children?: Array<Expression>;
	private readonly kind: ExpressionKind;

	private constructor(kind: ExpressionKind) {
		super();
		this.kind = kind;
	}

	public getChildren(): ReadonlyArray<Expression> {
		return this.children ?? [];
	}

	public getKind(): ExpressionKind {
		return this.kind;
	}

	// The dependencies of a compound expression are:
	// - partial for all children.
	public getDependencies(reason: Dependency, innerState?: State): Dependencies {
		return new Dependencies(this.getChildren().flatMap(expression => [...expression.getDependencies(reason)]));
	}

	public getReferencedTypes(): ReadonlyArray<Type> {
		return this.getChildren().flatMap(expression => [...expression.getReferencedTypes()]);
	}

	public write(writer: Writer, namespace?: Namespace): void {
		if (this.getChildren().length === 0) {
			// Special case when there are no children.
			switch (this.kind) {
			case ExpressionKind.LogicalAnd:
				writer.write("true");
				break;
			case ExpressionKind.LogicalOr:
				writer.write("false");
				break;
			}
		} else if (this.getChildren().length === 1) {
			// Omit parentheses if there is only one child.
			this.getChildren()[0].write(writer, namespace);
		} else {
			// We must write the full expression with parentheses.
			let first = true;
			writer.write("(");

			for (const expression of this.getChildren()) {
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
		const children = this.getChildren().map(child => child.key()).join("");

		switch (this.kind) {
		case ExpressionKind.LogicalAnd:
			return `&${children};`;
		case ExpressionKind.LogicalOr:
			return `|${children};`;
		}
	}

	public isAlwaysTrue(): boolean {
		switch (this.kind) {
		case ExpressionKind.LogicalAnd:
			return this.getChildren().every(child => child.isAlwaysTrue());
		case ExpressionKind.LogicalOr:
			return this.getChildren().some(child => child.isAlwaysTrue());
		}
	}

	public fix(placeholder: PlaceholderType, type: Expression): any {
		return CompoundExpression.create(
			this.kind,
			...this.getChildren().map(member => member.fix(placeholder, type))
		);
	}

	// Create a new compound expression.
	public static create(kind: ExpressionKind, ...members: ReadonlyArray<Expression>): CompoundExpression {
		const result = new CompoundExpression(kind);

		if (members.length > 0) {
			result.children = [...members];
		}

		return result.intern();
	}

	// Create a new compound expression, collapsing multiple compound
	// expressions of the same kind into one. For "&&" and "||", this does not
	// change the meaning of the expression.
	public static combine(kind: ExpressionKind, ...members: ReadonlyArray<Expression>): CompoundExpression {
		const children = [];

		for (const member of members) {
			if (member instanceof CompoundExpression && member.getKind() === kind && !member.getChildren().includes(ELLIPSES)) {
				children.push(...member.getChildren());
			} else {
				children.push(member);
			}
		}
		
		return CompoundExpression.create(kind, ...children);
	}

	public static or(...children: ReadonlyArray<Expression>): CompoundExpression {
		return CompoundExpression.combine(ExpressionKind.LogicalOr, ...children);
	}

	public static and(...children: ReadonlyArray<Expression>): CompoundExpression {
		return CompoundExpression.combine(ExpressionKind.LogicalAnd, ...children);
	}
}

import { ELLIPSES } from "./literalExpression.js";
