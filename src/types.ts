import { NamedType, EllipsesExpression } from "./type.js";

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
export const STRING_TYPE = new NamedType("std::string");
export const ENABLE_IF = new NamedType("std::enable_if_t");
export const IS_SAME = new NamedType("std::is_same_v");
export const IS_CONVERTIBLE = new NamedType("std::is_convertible_v");
export const IS_ACCEPTABLE = new NamedType("cheerp::IsAcceptableV");
export const ARRAY_ELEMENT_TYPE = new NamedType("cheerp::ArrayElementTypeT");
export const ANY_TYPE = new NamedType("_Any");
export const UNION_TYPE = new NamedType("_Union");
export const FUNCTION_TYPE = new NamedType("_Function");
export const ARGS = new NamedType("_Args");
export const ELLIPSES = new EllipsesExpression();
