import { UnqualifiedType } from "./type.js";
import { Dependency, State, Dependencies } from "../target.js";
import { Writer } from "../writer.js";
import { Namespace } from "../declaration/namespace.js";

// `NamedType` is much like `LiteralExpression` but for types. The difference
// in name is due to a combination of poor foresight and laziness.
export class NamedType extends UnqualifiedType {
	private readonly name: string;

	public constructor(name: string) {
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
}

export const VOID_TYPE = new NamedType("void");
export const BOOL_TYPE = new NamedType("bool");
export const DOUBLE_TYPE = new NamedType("double");
export const FLOAT_TYPE = new NamedType("float");
export const LONG_TYPE = new NamedType("long");
export const UNSIGNED_LONG_TYPE = new NamedType("unsigned long");
export const INT_TYPE = new NamedType("int");
export const UNSIGNED_INT_TYPE = new NamedType("unsigned int");
export const SHORT_TYPE = new NamedType("short");
export const UNSIGNED_SHORT_TYPE = new NamedType("unsigned short");
export const CHAR_TYPE = new NamedType("char");
export const UNSIGNED_CHAR_TYPE = new NamedType("unsigned char");
export const CONST_CHAR_POINTER_TYPE = CHAR_TYPE.constPointer();
export const SIZE_TYPE = new NamedType("std::size_t");
export const NULLPTR_TYPE = new NamedType("std::nullptr_t");
export const STRING_TYPE = new NamedType("std::string");
export const ENABLE_IF = new NamedType("std::enable_if_t");
export const IS_SAME = new NamedType("std::is_same_v");
export const IS_CONVERTIBLE = new NamedType("std::is_convertible_v");
export const IS_ACCEPTABLE = new NamedType("cheerp::IsAcceptableV");
export const IS_ACCEPTABLE_ARGS = new NamedType("cheerp::IsAcceptableArgsV");
export const ARRAY_ELEMENT_TYPE = new NamedType("cheerp::ArrayElementTypeT");
export const ANY_TYPE = new NamedType("_Any");
export const UNION_TYPE = new NamedType("_Union");
export const FUNCTION_TYPE = new NamedType("_Function");
export const ARGS = new NamedType("_Args");
