import { Writer } from "./writer.js";
import { Namespace } from "./namespace.js";
import { Declaration } from "./declaration.js";
import { Class, Visibility } from "./class.js";
import { State, Target, resolveDependencies } from "./target.js";
import { VoidType, DeclaredType } from "./type.js";
import { Function } from "./function.js";

class Global implements Target {
	private readonly declaration: Declaration;

	public constructor(declaration: Declaration) {
		this.declaration = declaration;
	}

	public getDeclaration(): Declaration {
		return this.declaration;
	}

	public getTargetState(): State {
		return this.declaration.maxState();
	}
}

const writer = new Writer("clientlib.h", { pretty: true });
const clientNamespace = new Namespace("client");
const objectClass = new Class("Object", clientNamespace);
const fooClass = new Class("Foo", clientNamespace);
const barClass = new Class("Bar");
const bazClass = new Class("Baz");
const quxClass = new Class("Qux");
const helloFunction = new Function("hello", new VoidType);

clientNamespace.addAttribute("cheerp::genericjs");
objectClass.addAttribute("cheerp::client_layout");

fooClass.addMember(barClass, Visibility.Public);
fooClass.addMember(bazClass, Visibility.Public);
fooClass.addMember(helloFunction, Visibility.Public);
barClass.addMember(quxClass, Visibility.Public);
fooClass.addBase(new DeclaredType(objectClass), Visibility.Public);
barClass.addBase(new DeclaredType(objectClass), Visibility.Public);
quxClass.addBase(new DeclaredType(objectClass), Visibility.Public);
bazClass.addBase(new DeclaredType(barClass), Visibility.Public);
helloFunction.addArgument(new DeclaredType(quxClass).pointer(), "obj");

fooClass.computeParents();
fooClass.computeReferences();

// bazClass.setReferenced(fooClass);

const globals = [
	new Global(objectClass),
	new Global(fooClass),
	new Global(barClass),
	new Global(bazClass),
	new Global(quxClass),
];

let namespace: Namespace | undefined = undefined;

resolveDependencies(globals, (global, state) => {
	const newNamespace = global.getDeclaration().getNamespace();

	Namespace.writeChange(writer, namespace, newNamespace);
	namespace = newNamespace;
	global.getDeclaration().write(writer, state, namespace);
});

Namespace.writeChange(writer, namespace, undefined);
