import { Flags } from "./namespace.js";
import { Function } from "./function.js";
import { Class, Visibility } from "./class.js";
import { Type, DeclaredType, NamedType } from "./type.js";
import { Parser } from "./parser.js";
import { Library } from "./library.js";

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

	const fromUtf8 = new Function("fromUtf8", stringType.pointer());
	fromUtf8.addFlags(Flags.Static);
	fromUtf8.addParameter(new NamedType("char").constPointer(), "in");
	fromUtf8.addParameter(new NamedType("std::size_t"), "len", "SIZE_MAX");
	fromUtf8.setBody(`
client::String* out = new client::String();
unsigned int cp;
for (std::size_t i = 0; i < len && in[i];) {
	unsigned char ch = in[i++];
	cp =
		ch < 0x80 ? ch :
		ch < 0xc0 ? cp << 6 | (ch & 0x3f) :
		ch < 0xe0 ? ch & 0x1f :
		ch < 0xf0 ? ch & 0x0f : ch & 0x07;
	if (i == len || (in[i] & 0xc0) != 0x80) {
		if (cp <= 0xffff) {
			out = out->concat(fromCharCode(cp));
		} else {
			out = out->concat(fromCharCode((cp - 0x10000) >> 10 | 0xd800));
			out = out->concat(fromCharCode((cp & 0x3ff) | 0xdc00));
		}
	}
}
return out;
	`);

	const toUtf8 = new Function("toUtf8", new NamedType("std::string"));
	toUtf8.setBody(`
std::string out;
std::size_t len = get_length();
unsigned int cp;
for (std::size_t i = 0; i < len;) {
	unsigned int ch = charCodeAt(i++);
	cp =
		ch < 0xd800 || ch > 0xdfff ? ch :
		ch < 0xdc00 ? (ch & 0x3ff) << 10 : (cp | (ch & 0x3ff)) + 0x10000;
	if (i == len || (ch & 0xdc00) != 0xd800) {
		if (cp <= 0x7f) {
			out.push_back(cp);
		} else if (cp <= 0x7ff) {
			out.push_back(0xc0 | cp >> 6);
			out.push_back(0x80 | (cp & 0x3f));
		} else if (cp <= 0xffff) {
			out.push_back(0xe0 | cp >> 12);
			out.push_back(0x80 | (cp >> 6 & 0x3f));
			out.push_back(0x80 | (cp & 0x3f));
		} else {
			out.push_back(0xf0 | cp >> 18);
			out.push_back(0x80 | (cp >> 12 & 0x3f));
			out.push_back(0x80 | (cp >> 6 & 0x3f));
			out.push_back(0x80 | (cp & 0x3f));
		}
	}
}
return out;
	`);

	const charConstructor = new Function(stringClass.getName());
	charConstructor.addParameter(new NamedType("char").constPointer(), "x");
	charConstructor.addInitializer(stringClass.getName(), "fromUtf8(x)");
	charConstructor.setBody(``);

	stringClass.addMember(fromUtf8, Visibility.Public);
	stringClass.addMember(toUtf8, Visibility.Public);
	stringClass.addMember(charConstructor, Visibility.Public);
}

export function addExtensions(parser: Parser): void {
	const library = parser.getLibrary();
	const jsobjectFile = library.getFile("cheerp/jsobject.h")!;
	const typesFile = library.getFile("cheerp/types.h")!;
	const clientlibFile = library.getFile("cheerp/clientlib.h")!;

	typesFile.addInclude("string", true);
	jsobjectFile.addInclude("cstddef", true);
	jsobjectFile.addInclude("cstdint", true);

	if (parser.stringBuiltin.classObj) {
		addStringExtensions(parser, parser.stringBuiltin.classObj);
	}
}
