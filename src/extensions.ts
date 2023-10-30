import { Flags } from "./namespace.js";
import { Function } from "./function.js";
import { Class, Visibility } from "./class.js";
import { Type, DeclaredType, NamedType } from "./type.js";
import { VOID_TYPE, BOOL_TYPE, LONG_TYPE, UNSIGNED_LONG_TYPE, INT_TYPE, UNSIGNED_INT_TYPE, CONST_CHAR_POINTER_TYPE, SIZE_TYPE, STRING_TYPE } from "./types.js";
import { Parser } from "./parser.js";
import { Library } from "./library.js";

function addConversionConstructor(classObj: Class, type: Type): void {
	const funcObj = new Function(classObj.getName());
	funcObj.addParameter(type, "x");
	classObj.addMember(funcObj, Visibility.Public);
}

function addBase(parser: Parser, base: Class, derivedName: string): void {
	const derivedClass = parser.getRootClass(derivedName);

	if (derivedClass) {
		derivedClass.addBase(new DeclaredType(base), Visibility.Public);
	}
}

function addStringExtensions(parser: Parser, stringClass: Class): void {
	const stringType = new DeclaredType(stringClass);

	addConversionConstructor(stringClass, stringType.constPointer());
	addConversionConstructor(stringClass, stringType.constReference());
	addConversionConstructor(stringClass, LONG_TYPE);
	addConversionConstructor(stringClass, UNSIGNED_LONG_TYPE);
	addConversionConstructor(stringClass, INT_TYPE);
	addConversionConstructor(stringClass, UNSIGNED_INT_TYPE);

	const fromUtf8 = new Function("fromUtf8", stringType.pointer());
	fromUtf8.addFlags(Flags.Static);
	fromUtf8.addParameter(CONST_CHAR_POINTER_TYPE, "in");
	fromUtf8.addParameter(SIZE_TYPE, "len", "SIZE_MAX");
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

	const toUtf8 = new Function("toUtf8", STRING_TYPE);
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
	charConstructor.addParameter(CONST_CHAR_POINTER_TYPE, "x");
	charConstructor.addInitializer(stringClass.getName(), "fromUtf8(x)");
	charConstructor.setBody(``);

	stringClass.addMember(fromUtf8, Visibility.Public);
	stringClass.addMember(toUtf8, Visibility.Public);
	stringClass.addMember(charConstructor, Visibility.Public);
}

function addMapExtensions(parser: Parser, mapClass: Class): void {
	const keyType = new NamedType("K");
	const valueType = new NamedType("V");

	const getFunc = new Function("get", valueType);
	getFunc.addTypeParameter("K");
	getFunc.addTypeParameter("V");
	getFunc.addParameter(keyType, "k");
	
	const setFunc = new Function("set", VOID_TYPE);
	setFunc.addTypeParameter("K");
	setFunc.addTypeParameter("V");
	setFunc.addParameter(keyType, "k");
	setFunc.addParameter(valueType, "v");

	const hasFunc = new Function("has", BOOL_TYPE);
	hasFunc.addTypeParameter("K");
	hasFunc.addParameter(keyType, "k");

	const deleteFunc = new Function("delete_", VOID_TYPE);
	deleteFunc.addTypeParameter("K");
	deleteFunc.addParameter(keyType, "k");
	deleteFunc.setBody(`
bool out;
__asm__("%1.delete(%2)" : "=r"(out) : "r"(this), "r"(k));
return out;
	`);

	mapClass.addMember(getFunc, Visibility.Public);
	mapClass.addMember(setFunc, Visibility.Public);
	mapClass.addMember(hasFunc, Visibility.Public);
	mapClass.addMember(deleteFunc, Visibility.Public);
}

export function addExtensions(parser: Parser): void {
	const library = parser.getLibrary();
	const jsobjectFile = library.getFile("cheerp/jsobject.h")!;
	const typesFile = library.getFile("cheerp/types.h")!;
	const clientlibFile = library.getFile("cheerp/clientlib.h")!;

	typesFile.addInclude("string", true);
	jsobjectFile.addInclude("cstddef", true);
	jsobjectFile.addInclude("cstdint", true);

	const mapClass = parser.getRootClass("Map");
	const arrayBufferViewClass = parser.getRootClass("ArrayBufferView");

	if (parser.stringBuiltin.classObj) {
		addStringExtensions(parser, parser.stringBuiltin.classObj);
	}

	if (mapClass) {
		addMapExtensions(parser, mapClass);
	}

	if (arrayBufferViewClass) {
		addBase(parser, arrayBufferViewClass, "Int8Array");
		addBase(parser, arrayBufferViewClass, "Uint8Array");
		addBase(parser, arrayBufferViewClass, "Uint8ClampedArray");
		addBase(parser, arrayBufferViewClass, "Int16Array");
		addBase(parser, arrayBufferViewClass, "Uint16Array");
		addBase(parser, arrayBufferViewClass, "Int32Array");
		addBase(parser, arrayBufferViewClass, "Uint32Array");
		addBase(parser, arrayBufferViewClass, "Float32Array");
		addBase(parser, arrayBufferViewClass, "Float64Array");
		arrayBufferViewClass.computeVirtualBaseClasses();
	}

	for (const classObj of parser.getClasses()) {
		for (const child of classObj.getChildren()) {
			if (child instanceof Function && child.getName() === "get_length") {
				child.setType(INT_TYPE);
			}
		}
	}
}
