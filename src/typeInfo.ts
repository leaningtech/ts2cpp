import { Parser } from "./parser.js";
import { Expression, Type, TypeQualifier } from "./type.js";

export enum TypeKind {
	Class,
	Primitive,
	Generic,
}

export class TypeData {
	private type: Type;
	private kind: TypeKind;

	public constructor(type: Type, kind: TypeKind) {
		this.type = type;
		this.kind = kind;
	}

	public getType(): Type {
		return this.type;
	}

	public getKind(): TypeKind {
		return this.kind;
	}

	public getPointerOrPrimitive(): Type {
		if (this.kind === TypeKind.Class) {
			return this.type.pointer();
		} else {
			return this.type;
		}
	}
}

export class TypeInfo {
	private readonly objectType: Type;
	private readonly types: Array<TypeData> = new Array;
	private optional: boolean = false;

	public constructor(parser: Parser) {
		this.objectType = parser.objectBuiltin.type;
	}

	public getTypes(): ReadonlyArray<TypeData> {
		return this.types;
	}

	public addType(type: Type, kind: TypeKind): void {
		this.types.push(new TypeData(type, kind));
	}

	public isOptional(): boolean {
		return this.optional;
	}

	public setOptional(): void {
		this.optional = true;
	}

	public getSingle(): TypeData {
		if (this.types.length === 1) {
			return this.types[0];
		} else {
			return new TypeData(this.objectType, TypeKind.Class);
		}
	}

	public getPlural(): ReadonlyArray<TypeData> {
		if (this.types.length > 0) {
			return this.types;
		} else {
			return [new TypeData(this.objectType, TypeKind.Class)];
		}
	}

	public asTypeConstraint(type: Type): Expression {
		return Expression.or(
			...this.getPlural().map(constraint => {
				return Expression.isConvertible(type, constraint.getPointerOrPrimitive());
			})
		);
	}

	public asTypeParameter(): Type {
		return this.getSingle().getPointerOrPrimitive();
	}

	public asBaseType(): Type {
		return this.getSingle().getType();
	}

	public asReturnType(): Type {
		return this.getSingle().getPointerOrPrimitive();
	}

	public asParameterTypes(): ReadonlyArray<Type> {
		return this.getPlural().flatMap(type => {
			if (type.getKind() !== TypeKind.Class) {
				return [type.getType()];
			} else if (this.optional) {
				return [type.getType().constReference(), type.getType().constPointer()];
			} else {
				return [type.getType().constReference()];
			}
		});
	}

	public asVariableType(member: boolean): Type {
		const type = this.getSingle();

		if (this.optional || member) {
			return type.getPointerOrPrimitive();
		} else {
			return type.getType();
		}
	}

	public asTypeAlias(): Type {
		return this.getSingle().getType();
	}
}
