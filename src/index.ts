import { Writer } from "./writer.js";
import { Namespace } from "./namespace.js";
import { Declaration } from "./declaration.js";
import { Class, Visibility } from "./class.js";
import { VoidType, DeclaredType } from "./type.js";
import { Function } from "./function.js";
import { File } from "./file.js";

const writer = new Writer("clientlib.h", { pretty: true });
const file = new File();
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

file.addGlobal(objectClass);
file.addGlobal(fooClass);
file.addGlobal(barClass);
file.addGlobal(bazClass);
file.addGlobal(quxClass);

file.write(writer);
