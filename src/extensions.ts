import { Flags } from "./namespace.js";
import { Function } from "./function.js";
import { Class, Visibility } from "./class.js";
import { Type, DeclaredType, NamedType } from "./type.js";
import { Parser } from "./parser.js";

// TODO: check correctness of string conversion functions
// TODO: separate object class into separate file so we can include <string>

function addConversionConstructor(classObj: Class, type: Type) {
	const funcObj = new Function(classObj.getName());
	funcObj.addParameter(type, "x");
	classObj.addMember(funcObj, Visibility.Public);
}

function addStringExtensions(parser: Parser, stringClass: Class): void {
	const stringType = new DeclaredType(stringClass);

	addConversionConstructor(stringClass, stringType.constPointer());
	addConversionConstructor(stringClass, stringType.constReference());
	addConversionConstructor(stringClass, new NamedType("long"));
	addConversionConstructor(stringClass, new NamedType("unsigned long"));
	addConversionConstructor(stringClass, new NamedType("int"));
	addConversionConstructor(stringClass, new NamedType("unsigned int"));
	addConversionConstructor(stringClass, new NamedType("double"));

	const fromUtf8 = new Function("fromUtf8", stringType.pointer());
	fromUtf8.addFlags(Flags.Static);
	fromUtf8.addParameter(new NamedType("char").constPointer(), "in");
	fromUtf8.addParameter(new NamedType("std::size_t"), "len", "SIZE_MAX");
	fromUtf8.setBody(`
client::String* out = new client::String();
unsigned int codepoint;
while (len > 0 && *in != 0) {
	unsigned char ch = static_cast<unsigned char>(*in);
	// ASCII range
	if (ch <= 0x7F)
		codepoint = ch;
	// Continuation bytes
	else if (ch <= 0xbf)
		codepoint = (codepoint << 6) | (ch & 0x3f);
	// Start of 2-bytes sequence
	else if (ch <= 0xdf)
		codepoint = ch & 0x1f;
	// Start of 3-bytes sequence
	else if (ch <= 0xef)
		codepoint = ch & 0x0f;
	// Start of 4-bytes sequence
	else
		codepoint = ch & 0x07;
	++in;
	--len;
	// NOTE: we are assuming that invalid codepoints will be handled
	// in a sensible way by javascript strings
	if (len == 0 || (*in & 0xc0) != 0x80) {
		if (codepoint <= 0xffff) {
			out = out->concat(client::String::fromCharCode(codepoint));
		} else {
			codepoint -= 0x10000;
			unsigned int highSurrogate = (codepoint >> 10) + 0xd800;
			unsigned int lowSurrogate = (codepoint & 0x3ff) + 0xdc00;
			out = out->concat(client::String::fromCharCode(highSurrogate));
			out = out->concat(client::String::fromCharCode(lowSurrogate));
		}
	}
}
return out;
	`);

	const toUtf8 = new Function("toUtf8", new NamedType("std::string"));
	toUtf8.setBody(`
std::string out;
const size_t len = get_length();
for (size_t i = 0; i < len; i++) {
	unsigned int codepoint = charCodeAt(i);
	if (codepoint >= 0xd800 && codepoint <= 0xdfff) {
		unsigned int surrogate = charCodeAt(++i);
		codepoint = 0x10000 + ((codepoint & 0x3ff) << 10) + (surrogate & 0x3ff);
	}
	if (codepoint > 0xffff) {
		codepoint = 0xfffd; // Was invalid character, use replacement character U+FFFD
	}
	if (codepoint <= 0x7f) {
		out.push_back(codepoint);
	} else if (codepoint <= 0x7ff) {
		out.push_back(0xC0 | (codepoint >> 6));
		out.push_back(0x80 | (codepoint & 63));
	} else {
		out.push_back(0xE0 | (codepoint >> 12));
		out.push_back(0x80 | ((codepoint >> 6) & 63));
		out.push_back(0x80 | (codepoint & 63));
	}
}
return out;
	`);

	const charConstructor = new Function(stringClass.getName());
	charConstructor.addParameter(new NamedType("char").constPointer(), "x");
	charConstructor.addInitializer(stringClass.getName(), "fromUtf8(x)");
	charConstructor.setBody(``);

	stringClass.addMember(fromUtf8, Visibility.Public);
	// stringClass.addMember(toUtf8, Visibility.Public);
	stringClass.addMember(charConstructor, Visibility.Public);
}

export function addExtensions(parser: Parser): void {
	// parser.file.addInclude("string", true);
	parser.file.addInclude("type_traits", true);
	parser.file.addInclude("cstddef", true);
	parser.file.addInclude("cstdint", true);

	if (parser.stringBuiltin.classObj) {
		addStringExtensions(parser, parser.stringBuiltin.classObj);
	}
}
