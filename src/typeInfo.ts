import { Parser } from "./parser.js";
import { Type, TypeQualifier } from "./type.js";

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

	public qualify(qualifier: TypeQualifier, force: boolean = false): Type {
		if (this.kind === TypeKind.Class || force) {
			return this.type.qualify(qualifier);
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
		this.objectType = parser.getObjectType();
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

	public asTypeParameter(): Type {
		if (this.types.length === 1) {
			return this.types[0].qualify(TypeQualifier.Pointer, this.optional);
		} else {
			return this.objectType.pointer();
		}
	}

	public asBaseType(): Type {
		if (this.types.length === 1) {
			return this.types[0].getType();
		} else {
			return this.objectType;
		}
	}

	public asReturnType(): Type {
		if (this.types.length === 1) {
			return this.types[0].qualify(TypeQualifier.Pointer, this.optional);
		} else {
			return this.objectType.pointer();
		}
	}

	public asParameterTypes(): ReadonlyArray<Type> {
		if (this.types.length > 0) {
			return this.types.flatMap(type => {
				const constReference = type.qualify(TypeQualifier.ConstReference);

				if (this.optional) {
					return [constReference, type.getType().constPointer()];
				} else {
					return [constReference];
				}
			});
		} else {
			if (this.optional) {
				return [this.objectType.constReference(), this.objectType.constPointer()];
			} else {
				return [this.objectType.constReference()];
			}
		}
	}

	public asVariableType(member: boolean): Type {
		if (this.types.length === 1) {
			if (this.optional || member) {
				return this.types[0].qualify(TypeQualifier.Pointer);
			} else {
				return this.types[0].getType();
			}
		} else {
			if (this.optional || member) {
				return this.objectType.pointer();
			} else {
				return this.objectType;
			}
		}
	}

	public asTypeAlias(): Type {
		if (this.types.length === 1) {
			return this.types[0].getType();
		} else {
			return this.objectType;
		}
	}
}
