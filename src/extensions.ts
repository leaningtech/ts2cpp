import { Flags, Namespace } from "./declaration/namespace.js";
import { Function } from "./declaration/function.js";
import { Variable } from "./declaration/variable.js";
import { Class, Visibility } from "./declaration/class.js";
import { Type } from "./type/type.js";
import { DeclaredType } from "./type/declaredType.js";
import { NamedType, LONG_TYPE, UNSIGNED_LONG_TYPE, INT_TYPE, UNSIGNED_INT_TYPE, CONST_CHAR_POINTER_TYPE, SIZE_TYPE, STRING_TYPE, DOUBLE_TYPE, VOID_TYPE, BOOL_TYPE, ANY_TYPE } from "./type/namedType.js";
import { QualifiedType, TypeQualifier } from "./type/qualifiedType.js";
import { TemplateType } from "./type/templateType.js";
import { Parser } from "./parser.js";
import { Library } from "./library.js";
import { State } from "./target.js";

// TODO: add constraints for type parameters in this file

// Utility function, adds an extern variable named `name` of a type with the
// same name.
function addExtern(parser: Parser, name: string) {
	const declaration = parser.getRootClass(name);

	if (declaration) {
		const file = declaration.getFile();
		const varDecl = new Variable(name, new DeclaredType(declaration));

		if (file) {
			varDecl.setFile(file);
		}

		varDecl.addFlags(Flags.Extern);
		varDecl.setParent(declaration.getParent());
		parser.getLibrary().addGlobal(varDecl);
	}
}

// Utility function, adds a conversion constructor to `classObj` to convert
// from the type `type`.
function addConversionConstructor(classObj: Class, type: Type): void {
	const funcObj = new Function(classObj.getName());
	funcObj.addParameter(type, "x");
	classObj.addMember(funcObj, Visibility.Public);
}

// Utility function, adds a conversion constructor to `classObj` to convert
// from the type `type`, by simply forwarding it to the `Object` constructor.
// This is used for type casting hacks.
function addObjectInitializerConstructor(classObj: Class, type: Type): Function {
	const funcObj = new Function(classObj.getName());
	funcObj.addParameter(type, "x");
	funcObj.addInitializer("Object", "x");
	funcObj.setBody(``);
	classObj.addMember(funcObj, Visibility.Public);
	return funcObj;
}

// Add String extensions:
// - conversion from a variety of different types.
// - `fromUtf8`, and a `const char*` constructor that calls it.
// - `toUtf8`, and an `operator std::string` that calls it.
// - `makeString` implementation, forward declared in "cheerp/jshelper.h"
function addStringExtensions(parser: Parser, stringClass: Class): void {
	const stringType = new DeclaredType(stringClass);

	addConversionConstructor(stringClass, stringType.constPointer());
	addConversionConstructor(stringClass, stringType.constReference());
	addConversionConstructor(stringClass, LONG_TYPE);
	addConversionConstructor(stringClass, UNSIGNED_LONG_TYPE);
	addConversionConstructor(stringClass, INT_TYPE);
	addConversionConstructor(stringClass, UNSIGNED_INT_TYPE);
	addConversionConstructor(stringClass, DOUBLE_TYPE);

	const fromUtf8 = new Function("fromUtf8", stringType.pointer());
	fromUtf8.addAttribute("gnu::always_inline");
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
	toUtf8.addFlags(Flags.Const);
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
	
	const stringConversion = new Function("operator std::string");
	stringConversion.addFlags(Flags.Const | Flags.Explicit);
	stringConversion.setBody(`
return this->toUtf8();
	`);

	stringClass.addMember(fromUtf8, Visibility.Public);
	stringClass.addMember(toUtf8, Visibility.Public);
	stringClass.addMember(charConstructor, Visibility.Public);
	stringClass.addMember(stringConversion, Visibility.Public);

	const cheerpNamespace = new Namespace("cheerp");
	cheerpNamespace.addAttribute("cheerp::genericjs");

	const makeStringFunc = new Function("makeString", stringType.pointer(), cheerpNamespace);
	makeStringFunc.addParameter(CONST_CHAR_POINTER_TYPE, "str");
	makeStringFunc.setBody(`return new client::String(str);`);

	parser.getLibrary().addGlobal(makeStringFunc);
	parser.getLibrary().getFile("cheerp/types.h")!.addDeclaration(makeStringFunc);
}

// Add Number extensions:
// - conversion from `double`
function addNumberExtensions(parser: Parser, numberClass: Class): void {
	addConversionConstructor(numberClass, DOUBLE_TYPE);
}

// Add Object extensions:
// - `operator[]` and `set_` to get and set fields of the object.
function addObjectExtensions(parser: Parser, objectClass: Class): void {
	const stringType = parser.getRootType("String");
	const objectType = parser.getRootType("Object");

	const setFunc = new Function("set_", VOID_TYPE);
	setFunc.addParameter(stringType.constReference(), "name");
	setFunc.addParameter(objectType.constPointer(), "v");

	const genericSetFunc = new Function("set_", VOID_TYPE);
	genericSetFunc.addTypeParameter("T");
	genericSetFunc.addParameter(stringType.constReference(), "name");
	genericSetFunc.addParameter(new NamedType("T"), "v");
	
	const indexFunc = new Function("operator[]", objectType.pointer());
	indexFunc.addFlags(Flags.Const);
	indexFunc.addParameter(stringType.constReference(), "name");
	
	objectClass.addMember(setFunc, Visibility.Public);
	objectClass.addMember(genericSetFunc, Visibility.Public);
	objectClass.addMember(indexFunc, Visibility.Public);
}

// Add Map extensions:
// - `get`, `set`, `has`, and `delete` with template parameters.
//
// These functions are not used anywhere in cheerpx or cheerpj. They are only
// used in one specific cheerp test case that explicitly lists the template
// parameters, rather than calling the overloads generated from typescript that
// are both nicer to use and more type safe.
// TODO: it is probably better to just modify the test case and remove these.
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

	const deleteFunc = new Function("delete_", BOOL_TYPE);
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

// Add typed array extensions:
// - `operator[]` that returns the correct c++ type for the typed array.
// - a copy constructor.
//
// The copy constructor is needed because typescript only defines a constructor
// from `TArrayLike<double>`.
// TODO: this may no longer be needed after making some changes to TArrayLike.
function addTypedArrayExtensions(parser: Parser, name: string, type: string): void {
	const arrayBufferViewClass = parser.getRootClass("ArrayBufferView");
	const typedArrayClass = parser.getRootClass(name);

	if (arrayBufferViewClass && typedArrayClass) {
		typedArrayClass.addBase(new DeclaredType(arrayBufferViewClass), Visibility.Public);
		typedArrayClass.removeMember("operator[]");

		const indexFunc = new Function("operator[]", new NamedType(type));
		indexFunc.addFlags(Flags.Const);
		indexFunc.addParameter(DOUBLE_TYPE, "index");
		indexFunc.setBody(`
return __builtin_cheerp_make_regular<${type}>(this, 0)[static_cast<int>(index)];
		`);
		
		const indexRefFunc = new Function("operator[]", new NamedType(type).reference());
		indexRefFunc.addParameter(DOUBLE_TYPE, "index");
		indexRefFunc.setBody(`
return __builtin_cheerp_make_regular<${type}>(this, 0)[static_cast<int>(index)];
		`);

		const copyConstructor = new Function(typedArrayClass.getName());
		copyConstructor.addParameter(new DeclaredType(typedArrayClass).constPointer(), "array");

		typedArrayClass.addMember(indexFunc, Visibility.Public);
		typedArrayClass.addMember(indexRefFunc, Visibility.Public);
		typedArrayClass.addMember(copyConstructor, Visibility.Public);
	}
}

// Add Function extensions:
// - conversion from `EventListener*`.
//
// TODO: this may no longer be needed after replacing `Callback` with
// `Callback2`.
function addFunctionExtensions(parser: Parser, functionClass: Class) {
	const eventListenerClass = parser.getRootClass("EventListener");

	if (eventListenerClass) {
		const constEventListenerConstructor = addObjectInitializerConstructor(functionClass, new DeclaredType(eventListenerClass).constPointer());
		constEventListenerConstructor.addExtraDependency(eventListenerClass, State.Complete);
		const eventListenerConstructor = addObjectInitializerConstructor(functionClass, new DeclaredType(eventListenerClass).pointer());
		eventListenerConstructor.addExtraDependency(eventListenerClass, State.Complete);
	}
}

// Add Document extensions:
// - set return type of `createElement` and `getElementsByTagName` to use
// `HTMLElement` instead of just `Element`.
//
// The typescript declarations have some complex expressions for this that the
// parser does not fully understand, so we manually set the correct type here.
function addDocumentExtensions(parser: Parser, documentClass: Class) {
	const htmlElementClass = parser.getRootClass("HTMLElement");
	const htmlCollectionOfClass = parser.getGenericRootClass("HTMLCollectionOf");

	if (htmlElementClass && htmlCollectionOfClass) {
		const htmlElementType = new DeclaredType(htmlElementClass).pointer();
		const htmlCollectionOfTemplate = new TemplateType(new DeclaredType(htmlCollectionOfClass));

		htmlCollectionOfTemplate.addTypeParameter(htmlElementType);

		const htmlCollectionOfType = htmlCollectionOfTemplate.pointer();

		for (const member of documentClass.getMembers()) {
			const decl = member.getDeclaration();

			if (decl instanceof Function) {
				if (decl.getName() === "createElement") {
					decl.setType(htmlElementType);
				}

				if (decl.getName() === "getElementsByTagName") {
					decl.setType(htmlCollectionOfType);
				}
			}
		}
	}
}

// Patch some functions for compatibility or ease of use:
// - Set return type of some functions to `int`.
// - Add `const` flag to some functions.
// - Add `explicit` flag to some String constructors.
//
// This whole thing is pretty ugly but I don't see a way around it.
function patchFunctions(parser: Parser) {
	const objectType = parser.getRootType("Object");

	const explicitStringConstructorKeys = [
		objectType.constReference().key(),
		objectType.constPointer().key(),
		ANY_TYPE.constReference().key(),
		ANY_TYPE.constPointer().key(),
	];

	for (const funcObj of parser.getFunctions()) {
		const classObj = funcObj.getParentDeclaration();

		if (classObj) {
			switch (funcObj.getName()) {
			case "get_length":
			case "get_size":
			case "indexOf":
			case "lastIndexOf":
			case "charCodeAt":
				funcObj.setType(INT_TYPE);
			case "concat":
			case "_concat":
			case "localeCompare":
			case "split":
			case "replace":
			case "substring":
				funcObj.addFlags((funcObj.getFlags() & Flags.Static) ? 0 as Flags : Flags.Const);
				break;
			case "String":
				if (classObj.getName() === "String") {
					const params = funcObj.getParameters();

					if (params.length === 1 && explicitStringConstructorKeys.includes(params[0].getType().key())) {
						funcObj.addFlags(Flags.Explicit);
					}
				}

				break;
			}
		}
	}
}

// TODO: pixelStorei extension (or add int overload to all functions that
// take both double and bool).
export function addExtensions(parser: Parser): void {
	const library = parser.getLibrary();
	const jsobjectFile = library.addFile("cheerp/jsobject.h")!;
	const typesFile = library.addFile("cheerp/types.h")!;
	const clientlibFile = library.getDefaultFile();

	const objectClass = parser.getRootClass("Object");
	const stringClass = parser.getRootClass("String");
	const numberClass = parser.getRootClass("Number");
	const arrayClass = parser.getRootClass("Array");
	const genericArrayClass = parser.getGenericRootClass("Array");
	const mapClass = parser.getRootClass("Map");
	const genericMapClass = parser.getGenericRootClass("Map");
	const functionClass = parser.getRootClass("Function");
	const documentClass = parser.getRootClass("Document");

	// 1. Add includes for types that are assumed to exist.
	library.addGlobalInclude("jshelper.h", false);
	typesFile.addInclude("string", true);
	typesFile.addInclude("jsobject.h", false, jsobjectFile);
	jsobjectFile.addInclude("cstddef", true);
	jsobjectFile.addInclude("cstdint", true);
	clientlibFile.addInclude("types.h", false, typesFile);
	clientlibFile.addInclude("function.h", false);
	
	// 2. For some declarations, set which file they should be written to.
	objectClass && jsobjectFile.addDeclaration(objectClass);
	stringClass && typesFile.addDeclaration(stringClass);
	numberClass && typesFile.addDeclaration(numberClass);
	arrayClass && typesFile.addDeclaration(arrayClass);
	genericArrayClass && typesFile.addDeclaration(genericArrayClass);
	mapClass && typesFile.addDeclaration(mapClass);
	genericMapClass && typesFile.addDeclaration(genericMapClass);
	functionClass && typesFile.addDeclaration(functionClass);

	// 3. Add extensions for specific classes.
	objectClass && addObjectExtensions(parser, objectClass);
	stringClass && addStringExtensions(parser, stringClass);
	numberClass && addNumberExtensions(parser, numberClass);
	mapClass && addMapExtensions(parser, mapClass);
	functionClass && addFunctionExtensions(parser, functionClass);
	documentClass && addDocumentExtensions(parser, documentClass);

	// 4. Add extensions for typed arrays.
	addTypedArrayExtensions(parser, "Int8Array", "char");
	addTypedArrayExtensions(parser, "Uint8Array", "unsigned char");
	addTypedArrayExtensions(parser, "Uint8ClampedArray", "double");
	addTypedArrayExtensions(parser, "Int16Array", "short");
	addTypedArrayExtensions(parser, "Uint16Array", "unsigned short");
	addTypedArrayExtensions(parser, "Int32Array", "int");
	addTypedArrayExtensions(parser, "Uint32Array", "unsigned int");
	addTypedArrayExtensions(parser, "Float32Array", "float");
	addTypedArrayExtensions(parser, "Float64Array", "double");

	// 5. Add an extern variable `URL` so that functions on it can be called
	// with `.` instead of `::`, this makes us more compatible with the old
	// clientlib, and does not have any downsides as far as I could tell.
	addExtern(parser, "URL");

	// 6. Patch some functions for compatibility or ease of use.
	patchFunctions(parser);
}
