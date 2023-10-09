import { Writer } from "./writer.js";
import { Namespace } from "./namespace.js";
import { Declaration } from "./declaration.js";
import { Class, Visibility } from "./class.js";
import { State, Target, resolveDependencies } from "./target.js";
import { DeclaredType } from "./type.js";

class Global implements Target {
	private readonly declaration: Declaration;

	public constructor(declaration: Declaration) {
		this.declaration = declaration;
	}

	public getDeclaration(): Declaration {
		return this.declaration;
	}

	public getTargetState(): State {
		return State.Complete;
	}
}

const writer = new Writer("clientlib.h", { pretty: true });
const clientNamespace = new Namespace("client");
const fooClass = new Class("Foo", clientNamespace);
const barClass = new Class("Bar");
const bazClass = new Class("Baz");

fooClass.addMember(barClass, Visibility.Public);
fooClass.addMember(bazClass, Visibility.Public);
bazClass.addBase(new DeclaredType(barClass), Visibility.Public);

fooClass.computeParents();
fooClass.computeReferences();

// bazClass.setReferenced(fooClass);

const globals = [
	new Global(fooClass),
	new Global(barClass),
	new Global(bazClass),
];

let namespace: Namespace | undefined = undefined;

resolveDependencies(globals, (global, state) => {
	const newNamespace = global.getDeclaration().getNamespace();

	Namespace.writeChange(writer, namespace, newNamespace);
	namespace = newNamespace;
	global.getDeclaration().write(writer, state, namespace);
});

Namespace.writeChange(writer, namespace, undefined);
