// Utilities for escaping names that may not be valid identifiers in c++.

import * as ts from "typescript";

const DIGITS = "0123456789";
const CHARSET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";

const RESERVED = [
	// keywords
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
	// reserved identifiers
	"assert",
	"EOF",
	"F_OK",
	"R_OK",
	"W_OK",
	"X_OK",
	"COPYFILE_EXCL",
	"COPYFILE_FICLONE",
	"COPYFILE_FICLONE_FORCE",
	"O_RDONLY",
	"O_WRONLY",
	"O_RDWR",
	"O_CREAT",
	"O_EXCL",
	"O_NOCTTY",
	"O_TRUNC",
	"O_APPEND",
	"O_DIRECTORY",
	"O_NOATIME",
	"O_NOFOLLOW",
	"O_SYNC",
	"O_DSYNC",
	"O_SYMLINK",
	"O_DIRECT",
	"O_NONBLOCK",
	"S_IFMT",
	"S_IFREG",
	"S_IFDIR",
	"S_IFCHR",
	"S_IFBLK",
	"S_IFIFO",
	"S_IFLNK",
	"S_IFSOCK",
	"S_IRWXU",
	"S_IRUSR",
	"S_IWUSR",
	"S_IXUSR",
	"S_IRWXG",
	"S_IRGRP",
	"S_IWGRP",
	"S_IXGRP",
	"S_IRWXO",
	"S_IROTH",
	"S_IWOTH",
	"S_IXOTH",
	"UV_FS_O_FILEMAP",
];

// If a character is not in the charset, or it is a digit at the start of the
// identifier, then it is replaced with `_${charCode}_`. If the result is a
// reserved word it will have an underscore prepended to it.
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

// Returns both the unescaped and escaped name of a declaration.
export function getName(declaration: ts.NamedDeclaration): [string, string] {
	const name = declaration.name!.getText();
	return [name, escapeName(name)];
}
