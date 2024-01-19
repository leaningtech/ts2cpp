import { Parser } from "./parser.js";
import { Expression } from "./type/expression.js";
import { Type } from "./type/type.js";
import { NamedType, ANY_TYPE, UNION_TYPE, FUNCTION_TYPE, VOID_TYPE, NULLPTR_TYPE } from "./type/namedType.js";
import { TemplateType } from "./type/templateType.js";
import { TypeQualifier } from "./type/qualifiedType.js";
import { DeclaredType } from "./type/declaredType.js";

const REFERENCE_TYPES = [
	"String",
	"Function",
];

export enum TypeKind {
	Class,
	Function,
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

	public needsPointer(): boolean {
		return (this.kind === TypeKind.Class || this.kind === TypeKind.Function) && this.type.key() !== NULLPTR_TYPE.key();
	}

	public getPointerOrPrimitive(): Type {
		if (this.needsPointer()) {
			return this.type.pointer();
		} else {
			return this.type;
		}
	}

	public getNonVoidPointerOrPrimitive(): Type {
		if (this.type.key() === VOID_TYPE.key()) {
			return ANY_TYPE.pointer();
		} else {
			return this.getPointerOrPrimitive();
		}
	}
}

export class TypeInfo {
	private readonly objectType: Type;
	private readonly types: Array<TypeData> = new Array;
	private readonly keys: Set<string> = new Set;
	private optional: boolean = false;

	public constructor(parser: Parser) {
		this.objectType = parser.getRootType("Object");
	}

	public getTypes(): ReadonlyArray<TypeData> {
		return this.types;
	}

	public addType(type: Type, kind: TypeKind): void {
		const key = type.key();

		if (!this.keys.has(key)) {
			this.types.push(new TypeData(type, kind));
			this.keys.add(key);
		}
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
			return new TypeData(ANY_TYPE, TypeKind.Class);
		}
	}

	public getPlural(): ReadonlyArray<TypeData> {
		if (this.types.length > 0) {
			return this.types;
		} else {
			return [new TypeData(ANY_TYPE, TypeKind.Class)];
		}
	}

	public asTypeConstraint(type: Type): Expression {
		return TemplateType.isAcceptable(type,
			...this.getPlural().map(constraint => {
				return constraint.getNonVoidPointerOrPrimitive();
			})
		);
	}

	public asTypeParameter(): Type {
		return this.getSingle().getNonVoidPointerOrPrimitive();
	}

	public asBaseType(): Type {
		return this.getSingle().getType();
	}

	public asReturnType(): Type {
		if (this.types.length > 1) {
			const types = this.types.filter(type => type.getKind() !== TypeKind.Function);

			if (types.length === 1) {
				return types[0].getPointerOrPrimitive();
			}

			const result = TemplateType.union(
				...types
					.map(type => {
						return type.getPointerOrPrimitive();
					})
			);

			if (result.key() === ANY_TYPE.key()) {
				return this.objectType.pointer();
			} else {
				return result.pointer();
			}
		} else if (this.types.length === 1 && this.types[0].getType().key() !== ANY_TYPE.key()) {
			return this.types[0].getPointerOrPrimitive();
		} else {
			return this.objectType.pointer();
		}
	}

	public asParameterTypes(): ReadonlyArray<Type> {
		return this.getPlural().flatMap(type => {
			if (!type.needsPointer()) {
				return [type.getType()];
			} else {
				const typeType = type.getType();
				let name;

				if (typeType instanceof NamedType) {
					name = typeType.getName();
				} else if (typeType instanceof DeclaredType) {
					name = typeType.getDeclaration().getName()
				} else if (typeType instanceof TemplateType) {
					let inner = typeType.getInner();

					if (inner instanceof NamedType) {
						name = inner.getName();
					}
				}

				if (name && REFERENCE_TYPES.includes(name)) {
					return [type.getType().constReference()];
				} else {
					return [type.getType().constPointer()];
				}
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
