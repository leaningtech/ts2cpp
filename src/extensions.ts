import { Flags, Namespace } from "./namespace.js";
import { Function } from "./function.js";
import { Variable } from "./variable.js";
import { Class, Visibility } from "./class.js";
import { Type, DeclaredType, NamedType, QualifiedType, TypeQualifier, TemplateType } from "./type.js";
import { LONG_TYPE, UNSIGNED_LONG_TYPE, INT_TYPE, UNSIGNED_INT_TYPE, CONST_CHAR_POINTER_TYPE, SIZE_TYPE, STRING_TYPE, DOUBLE_TYPE, VOID_TYPE, BOOL_TYPE, ANY_TYPE } from "./types.js";
import { Parser } from "./parser.js";
import { Library } from "./library.js";
import { State } from "./target.js";

// TODO: add constraints for type parameters in this file

function addConversionConstructor(classObj: Class, type: Type): void {
	const funcObj = new Function(classObj.getName());
	funcObj.addParameter(type, "x");
	classObj.addMember(funcObj, Visibility.Public);
}

function addObjectInitializerConstructor(classObj: Class, type: Type): Function {
	const funcObj = new Function(classObj.getName());
	funcObj.addParameter(type, "x");
	funcObj.addInitializer("Object", "x");
	funcObj.setBody(``);
	classObj.addMember(funcObj, Visibility.Public);
	return funcObj;
}

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
}

function addNumberExtensions(parser: Parser, numberClass: Class): void {
	const doubleConstructor = new Function(numberClass.getName());
	doubleConstructor.addParameter(DOUBLE_TYPE, "x");

	numberClass.addMember(doubleConstructor, Visibility.Public);
}

function addObjectExtensions(parser: Parser, objectClass: Class): void {
	const setFunc = new Function("set_", VOID_TYPE);
	setFunc.addParameter(parser.stringBuiltin.type.constReference(), "name");
	setFunc.addParameter(parser.objectBuiltin.type.constPointer(), "v");

	const genericSetFunc = new Function("set_", VOID_TYPE);
	genericSetFunc.addTypeParameter("T");
	genericSetFunc.addParameter(parser.stringBuiltin.type.constReference(), "name");
	genericSetFunc.addParameter(new NamedType("T"), "v");
	
	const indexFunc = new Function("operator[]", parser.objectBuiltin.type.pointer());
	indexFunc.addFlags(Flags.Const);
	indexFunc.addParameter(parser.stringBuiltin.type.constReference(), "name");
	
	const doubleConversion = new Function("operator double");
	doubleConversion.addFlags(Flags.Const | Flags.Explicit);
	doubleConversion.setBody(`
return this->cast<double>();
	`);

	const intConversion = new Function("operator int");
	intConversion.addFlags(Flags.Const | Flags.Explicit);
	intConversion.setBody(`
return this->cast<int>();
	`);

	objectClass.addMember(setFunc, Visibility.Public);
	objectClass.addMember(genericSetFunc, Visibility.Public);
	objectClass.addMember(indexFunc, Visibility.Public);
	// objectClass.addMember(doubleConversion, Visibility.Public);
	// objectClass.addMember(intConversion, Visibility.Public);
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

function addArrayExtensions(parser: Parser, arrayClass: Class, type: Type): void {
	const indexFunc = new Function("operator[]", type);
	indexFunc.addFlags(Flags.Const);
	indexFunc.addParameter(INT_TYPE, "index");
	indexFunc.setBody(`
return __builtin_cheerp_make_regular<${type.toString()}>(this, 0)[index];
	`);
	
	const indexRefFunc = new Function("operator[]", type.reference());
	indexRefFunc.addParameter(INT_TYPE, "index");
	indexRefFunc.setBody(`
return __builtin_cheerp_make_regular<${type.toString()}>(this, 0)[index];
	`);

	arrayClass.addMember(indexFunc, Visibility.Public);
	arrayClass.addMember(indexRefFunc, Visibility.Public);
}

function addTypedArrayExtensions(parser: Parser, arrayBufferViewClass: Class, name: string, type: string): void {
	const typedArrayClass = parser.getRootClass(name);

	if (typedArrayClass) {
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

function addFunctionExtensions(parser: Parser, functionClass: Class) {
	const eventListenerClass = parser.getRootClass("EventListener");

	if (eventListenerClass) {
		const constEventListenerConstructor = addObjectInitializerConstructor(functionClass, new DeclaredType(eventListenerClass).constPointer());
		constEventListenerConstructor.addExtraDependency(eventListenerClass, State.Complete);
		const eventListenerConstructor = addObjectInitializerConstructor(functionClass, new DeclaredType(eventListenerClass).pointer());
		eventListenerConstructor.addExtraDependency(eventListenerClass, State.Complete);
	}
}

function addConsoleLogExtensions(parser: Parser, consoleClass: Class, name: string) {
	const logFunc = new Function(`_${name}`, VOID_TYPE);
	logFunc.setInterfaceName(name);
	logFunc.addVariadicTypeParameter("_Args");
	logFunc.addParameter(new NamedType("_Args").rValueReference().expand(), "data");
	consoleClass.addMember(logFunc, Visibility.Private);

	for (const member of consoleClass.getMembers()) {
		const decl = member.getDeclaration();

		if (decl instanceof Function && decl.getName() === name) {
			const parameters = new Array;

			for (const parameter of decl.getParameters()) {
				const parameterType = parameter.getType();
				let name = parameter.getName();
				let suffix = "";

				if (parameterType instanceof QualifiedType) {
					const qualifier = parameterType.getQualifier();

					if (qualifier & TypeQualifier.Variadic) {
						suffix = "...";
					}
				}

				parameters.push(`cheerp::clientCast(${name})${suffix}`);
			}

			decl.setBody(`_${name}(${parameters.join(", ")});`);
		}
	}
}

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

export function addExtensions(parser: Parser): void {
	const library = parser.getLibrary();
	const jsobjectFile = library.getFile("cheerp/jsobject.h")!;
	const typesFile = library.getFile("cheerp/types.h")!;
	const clientlibFile = library.getFile("cheerp/clientlib.h")!;

	typesFile.addInclude("string", true);
	jsobjectFile.addInclude("cstddef", true);
	jsobjectFile.addInclude("cstdint", true);

	const mapClass = parser.getRootClass("Map");
	const arrayClass = parser.getRootClass("Array");
	const tArrayClass = parser.getGenericRootClass("Array");
	const arrayBufferViewClass = parser.getRootClass("ArrayBufferView");
	const consoleClass = parser.getRootClass("Console");
	const documentClass = parser.getRootClass("Document");

	if (parser.stringBuiltin.classObj) {
		addStringExtensions(parser, parser.stringBuiltin.classObj);
	}

	if (parser.numberBuiltin.classObj) {
		addNumberExtensions(parser, parser.numberBuiltin.classObj);
	}

	if (parser.objectBuiltin.classObj) {
		addObjectExtensions(parser, parser.objectBuiltin.classObj);
	}

	if (parser.functionBuiltin.classObj) {
		addFunctionExtensions(parser, parser.functionBuiltin.classObj);
	}

	if (mapClass) {
		addMapExtensions(parser, mapClass);
	}

	/*
	if (arrayClass) {
		addArrayExtensions(parser, arrayClass, parser.objectBuiltin.type.pointer());
	}

	if (tArrayClass) {
		addArrayExtensions(parser, tArrayClass, new NamedType("_To"));
	}
	*/

	if (arrayBufferViewClass) {
		addTypedArrayExtensions(parser, arrayBufferViewClass, "Int8Array", "char");
		addTypedArrayExtensions(parser, arrayBufferViewClass, "Uint8Array", "unsigned char");
		addTypedArrayExtensions(parser, arrayBufferViewClass, "Uint8ClampedArray", "double");
		addTypedArrayExtensions(parser, arrayBufferViewClass, "Int16Array", "short");
		addTypedArrayExtensions(parser, arrayBufferViewClass, "Uint16Array", "unsigned short");
		addTypedArrayExtensions(parser, arrayBufferViewClass, "Int32Array", "int");
		addTypedArrayExtensions(parser, arrayBufferViewClass, "Uint32Array", "unsigned int");
		addTypedArrayExtensions(parser, arrayBufferViewClass, "Float32Array", "float");
		addTypedArrayExtensions(parser, arrayBufferViewClass, "Float64Array", "double");
	}

	if (consoleClass) {
		/*
		addConsoleLogExtensions(parser, consoleClass, "debug");
		addConsoleLogExtensions(parser, consoleClass, "error");
		addConsoleLogExtensions(parser, consoleClass, "info");
		addConsoleLogExtensions(parser, consoleClass, "log");
		addConsoleLogExtensions(parser, consoleClass, "warn");
		addConsoleLogExtensions(parser, consoleClass, "trace");
		*/
	}

	if (documentClass) {
		addDocumentExtensions(parser, documentClass);
	}

	addExtern(parser, "URL");

	const keys = [
		parser.objectBuiltin.type.constReference().key(),
		parser.objectBuiltin.type.constPointer().key(),
		ANY_TYPE.constReference().key(),
		ANY_TYPE.constPointer().key(),
	];

	for (const classObj of parser.getClasses()) {
		const className = classObj.getName();

		for (const child of classObj.getChildren()) {
			if (child instanceof Function) {
				const name = child.getName();
				const parameters = child.getParameters();
				const type = parameters.length === 1 ? parameters[0].getType() : undefined;

				if (name === "get_length" || name === "get_size" || name === "indexOf" || name === "lastIndexOf" || name === "charCodeAt") {
					if (!(child.getFlags() & Flags.Static)) {
						child.addFlags(Flags.Const);
					}

					child.setType(INT_TYPE);
				} else if (name === "concat" || name === "_concat" || name === "localeCompare" || name === "split" || name == "replace" || name == "substring") {
					if (!(child.getFlags() & Flags.Static)) {
						child.addFlags(Flags.Const);
					}
				} else if (className === "String" && name === "String") {
					if (type && keys.includes(type.key())) {
						child.addFlags(Flags.Explicit);
					}
				}
			}
		}
	}
}
