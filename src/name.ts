import * as ts from "typescript";

const DIGITS = "0123456789";
const CHARSET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";

const RESERVED = [
	"alignas",
	"alignof",
	"and",
	"and_eq",
	"asm",
	"atomic_cancel",
	"atomic_commit",
	"atomic_noexcept",
	"auto",
	"bitand",
	"bitor",
	"bool",
	"break",
	"case",
	"catch",
	"char",
	"char8_t",
	"char16_t",
	"char32_t",
	"class",
	"compl",
	"concept",
	"const",
	"consteval",
	"constexpr",
	"constinit",
	"const_cast",
	"continue",
	"co_await",
	"co_return",
	"co_yield",
	"decltype",
	"default",
	"delete",
	"do",
	"double",
	"dynamic_cast",
	"else",
	"enum",
	"explicit",
	"export",
	"extern",
	"false",
	"float",
	"for",
	"friend",
	"goto",
	"if",
	"inline",
	"int",
	"long",
	"mutable",
	"namespace",
	"new",
	"noexcept",
	"not",
	"not_eq",
	"nullptr",
	"operator",
	"or",
	"or_eq",
	"private",
	"protected",
	"public",
	"reflexpr",
	"register",
	"reinterpret_cast",
	"requires",
	"return",
	"short",
	"signed",
	"sizeof",
	"static",
	"static_assert",
	"static_cast",
	"struct",
	"switch",
	"synchronized",
	"template",
	"this",
	"thread_local",
	"throw",
	"true",
	"try",
	"typedef",
	"typeid",
	"typename",
	"union",
	"unsigned",
	"using",
	"virtual",
	"void",
	"volatile",
	"wchar_t",
	"while",
	"xor",
	"xor_eq",
];

export function escapeName(name: string): string {
	let result = "";

	for (const char of name) {
		if (CHARSET.includes(char) && (result !== "" || !DIGITS.includes(char))) {
			result += char;
		} else {
			result += `_${char.charCodeAt(0)}_`;
		}
	}

	if (RESERVED.includes(result)) {
		result = result + "_";
	}

	return result;
}

type Name = ts.Identifier | ts.BindingName | ts.ModuleName | ts.PropertyName;

export function getName(identifier?: Name): [string, string] {
	const name = identifier!.getText();
	return [name, escapeName(name)];
}
