import { UnqualifiedType } from "./type.js";
import { Dependency, State, Dependencies } from "../target.js";
import { Writer } from "../writer.js";
import { Namespace } from "../declaration/namespace.js";

// `NamedType` is much like `LiteralExpression` but for types. The difference
// in name is due to a combination of poor foresight and laziness.
export class NamedType extends UnqualifiedType {
	private readonly name: string;

	private constructor(name: string) {
		super();
		this.name = name;
	}

	public getName(): string {
		return this.name;
	}

	public getDependencies(reason: Dependency, innerState?: State): Dependencies {
		return new Dependencies;
	}

	public write(writer: Writer, namespace?: Namespace): void {
		writer.write(this.name);
	}

	public key(): string {
		return `N${this.name};`;
	}

	public isVoidLike(): boolean {
		return this.name === "void";
	}

	public static create(name: string): NamedType {
		return new NamedType(name).intern();
	}
}

export const VOID_TYPE = NamedType.create("void");
export const BOOL_TYPE = NamedType.create("bool");
export const DOUBLE_TYPE = NamedType.create("double");
export const FLOAT_TYPE = NamedType.create("float");
export const LONG_TYPE = NamedType.create("long");
export const UNSIGNED_LONG_TYPE = NamedType.create("unsigned long");
export const INT_TYPE = NamedType.create("int");
export const UNSIGNED_INT_TYPE = NamedType.create("unsigned int");
export const SHORT_TYPE = NamedType.create("short");
export const UNSIGNED_SHORT_TYPE = NamedType.create("unsigned short");
export const CHAR_TYPE = NamedType.create("char");
export const UNSIGNED_CHAR_TYPE = NamedType.create("unsigned char");
export const CONST_CHAR_POINTER_TYPE = CHAR_TYPE.constPointer();
export const NULLPTR_TYPE = NamedType.create("cheerp::Nullptr");
export const STRING_TYPE = NamedType.create("std::string");
export const ENABLE_IF = NamedType.create("cheerp::EnableIf");
export const IS_SAME = NamedType.create("cheerp::IsSame");
export const CAN_CAST = NamedType.create("cheerp::CanCast");
export const CAN_CAST_ARGS = NamedType.create("cheerp::CanCastArgs");
export const ARRAY_ELEMENT_TYPE = NamedType.create("cheerp::ArrayElementType");
export const ANY_TYPE = NamedType.create("_Any");
export const UNION_TYPE = NamedType.create("_Union");
export const FUNCTION_TYPE = NamedType.create("_Function");
