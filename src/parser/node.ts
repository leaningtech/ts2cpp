// Typescript declarations are a big mess. An interface can have multiple
// declarations in different files that all contribute to the interface.
//
// For example, the following code is actually only one interface with two
// methods, `hello` and `world`.
// ```
// // one.d.ts
// declare interface Foo {
//     hello(): void;
// }
//
// // two.d.ts
// declare interface Foo {
//     world(): void;
// }
// ```
//
// The same name can even have multiple declarations of different types!
// ```
// declare interface Foo {
//     hello(): void;
// }
//
// declare namespace Foo {
//     function world(): void;
// }
// ```
//
// The typescript compiler api parses these as separate files with separate
// declarations, making the task of converting them into C++ classes a total
// pain in the ass.
//
// This file exists to collect the scattered typescript declarations into a
// tree structure where every node represents one name, and holds a list of
// all the declarations of that name anywhere in any file.

import { getName } from "./name.js";
import { Class, Visibility } from "../declaration/class.js";
import { TypeAlias } from "../declaration/typeAlias.js";
import { Parser } from "./parser.js";
import { VOID_TYPE } from "../type/namedType.js";
import { DeclaredType } from "../type/declaredType.js";
import * as ts from "typescript";

export type ClassDeclaration = ts.InterfaceDeclaration | ts.ClassDeclaration;
export type FunctionDeclaration = ts.SignatureDeclarationBase;

// The root node has no name or declarations, it only contains other nodes.
export class Node {
	// The children of this node. The root node contains all top level names as
	// children. When a name has namespace declarations, the contents of the
	// namespace form the children of the node.
	private children?: Map<string, Child>;

	public getChildren(): Iterable<Child> {
		return this.children?.values() ?? [];
	}

	public getChild(name: string): Child | undefined {
		return this.children?.get(name);
	}

	public getSize(): number {
		return this.children?.size ?? 0;
	}

	// This function is called to get the node for a named declaration. If the
	// name was seen before, we return the already created note so that other
	// declarations of the same name will be added to the same node. If this is
	// a new name, we must create a new node.
	private getOrInsert(declaration: ts.NamedDeclaration): Child {
		const [_, name] = getName(declaration);
		let node = this.getChild(name);

		if (!node) {
			node = new Child(name);
			this.children ??= new Map;
			this.children.set(name, node);
		}

		return node;
	}

	// This function takes a `ts.Node` whose name matches this node (or does
	// not have a name in the case of the root node), and adds all child
	// declarations as children of this node. If multiple child declarations
	// have the same name they will only have one `Child` instance, through use
	// of the `getOrInsert` function.
	//
	// For class declarations, we already instantiate a C++ declaration here
	// and register it with the parser. In this way, when we get to generating
	// the rest of the declarations, we can get `DeclaredType` instances for
	// their types even if the declaration is generated before the class that
	// declares its type.
	public discover(parser: Parser, parent: ts.Node): void {
		ts.forEachChild(parent, node => {
			if (ts.isInterfaceDeclaration(node)) {
				// Add the interface declaration to the list of interface
				// declarations for this node. Also call `discoverClass`.
				const child = this.getOrInsert(node);
				child.interfaceDeclarations ??= [];
				child.interfaceDeclarations.push(node);
				child.discoverClass(parser, node);
			} else if (ts.isFunctionDeclaration(node)) {
				// Add the function declaration to the list of function
				// declarations for this node.
				const child = this.getOrInsert(node);
				child.functionDeclarations ??= [];
				child.functionDeclarations.push(node);
			} else if (ts.isVariableStatement(node)) {
				// For each declaration in the variable statement, set the
				// variable declaration of the corresponding node.
				if (parser.includesDeclaration(node)) {
					for (const declaration of node.declarationList.declarations) {
						const child = this.getOrInsert(declaration);
						child.variableDeclaration = declaration;
					}
				}
			} else if (ts.isTypeAliasDeclaration(node)) {
				// Set the type alias declaration of this node.
				//
				// We also instantiate a `TypeAlias` ahead of type just like we
				// do for classes, as explained in the comment above
				// `discover`. But it turns out this is not needed for type
				// aliases. Type aliases are not real types in typescript.
				// The compiler api offers no way to distinguish between `T`
				// and `U` when `type U = T;`. For example, when a function
				// declaration contains a type alias, we only see the aliased
				// type and not the type alias itself. So there is no point in
				// pre-instantiating `TypeAlias` because it will never be
				// referenced, but we still do it anyways.
				const child = this.getOrInsert(node);
				child.typeAliasDeclaration = node;
				child.basicTypeAlias = new TypeAlias(child.getName(), VOID_TYPE);

				if (node.typeParameters && node.typeParameters.length > 0) {
					child.genericTypeAlias = new TypeAlias(`T${child.getName()}`, VOID_TYPE);
					child.genericTypeAlias.setBasicVersion(child.basicTypeAlias);
				}
			} else if (ts.isModuleDeclaration(node)) {
				// For namespace declarations, add all child declarations of
				// the namespace as children of the node for that namespace by
				// recursively calling `discover`.
				//
				// `global` is a name for the global namespace, any
				// declarations inside of a namespace named `global` should
				// instead be added as children of the root node.
				if (node.name.text === "global") {
					parser.getRootNode().discover(parser, node.body!);
				} else {
					const child = this.getOrInsert(node);
					child.moduleDeclaration = node;
					child.discover(parser, node.body!);
				}
			} else if (ts.isClassDeclaration(node)) {
				// Set the class declaration for this node. Also call
				// `discoverClass`.
				const child = this.getOrInsert(node);
				child.classDeclaration = node;
				child.discoverClass(parser, node);
			}

			// other possible nodes:
			//   ts.SyntaxKind.EndOfFileToken
			//   ts.SyntaxKind.ExportDeclaration
			//   ts.SyntaxKind.ImportDeclaration
			//   ts.SyntaxKind.ExportAssignment
			//   ts.SyntaxKind.ImportEqualsDeclaration
		});
	}
}

// Every named thing is an instance of `Child`. `Child` extends `Node` and so
// children can have their own children.
//
// It is important to note that even declarations that don't have children
// (which is all of them except for namespace declarations) are instances of
// `Child`. This is because a `Child` does not correspond with a single
// declaration, but rather a set of declarations that all have the same name.
//
// So for example, these typescript declarations:
// ```
// declare interface Foo {}
//
// declare namespace Foo {
//     declare interface Bar {}
// }
// ```
//
// Turn into this tree structure:
// ```
// {
//     children: {
//         "Foo": {
//             name: "Foo",
//             interfaceDeclarations: [<ts.InterfaceDeclaration>],
//             children: {
//                 "Bar": {
//                     name: "Bar",
//                     interfaceDeclarations: [<ts.InterfaceDeclaration>],
//                 }
//             }
//         }
//     }
// }
// ```
//
// To reiterate:
// - The root node only has children.
// - The "Foo" and "Bar" node each have one interface declaration.
// - The "Foo" node also has children, from the namespace declaration.
export class Child extends Node {
	private readonly name: string;
	public interfaceDeclarations?: Array<ts.InterfaceDeclaration>;
	public functionDeclarations?: Array<ts.FunctionDeclaration>;
	public moduleDeclaration?: ts.ModuleDeclaration;
	public classDeclaration?: ts.ClassDeclaration;
	public variableDeclaration?: ts.VariableDeclaration;
	public typeAliasDeclaration?: ts.TypeAliasDeclaration;
	public basicClass?: Class;
	public genericClass?: Class;
	public basicTypeAlias?: TypeAlias;
	public genericTypeAlias?: TypeAlias;

	public constructor(name: string) {
		super();
		this.name = name;
	}

	public getName(): string {
		return this.name;
	}

	// Return all class *AND* interface declarations for this node. Class and
	// interface declarations have mostly the same structure and are treated
	// as equivalent in most cases.
	public getClassDeclarations(): ReadonlyArray<ClassDeclaration> {
		if (this.classDeclaration) {
			return [this.classDeclaration, ...this.interfaceDeclarations ?? []];
		} else {
			return this.interfaceDeclarations ?? [];
		}
	}

	public getFunctionDeclarations(): ReadonlyArray<FunctionDeclaration> {
		return this.functionDeclarations ?? [];
	}

	// `discoverClass` is called for both class and interface declarations. If
	// we find a class or interface declaration for this name we must
	// instantiate and register a C++ class declaration for it, as explained in
	// the comment above `discover`. If a class has already been instantiated,
	// this function does nothing.
	public discoverClass(parser: Parser, node: ts.Node): void {
		if (!this.basicClass) {
			const type = parser.getTypeAtLocation(node) as ts.InterfaceType;
			this.basicClass = new Class(this.name);
			const basicType = DeclaredType.create(this.basicClass);
			parser.addBasicDeclaredClass(type, basicType);

			if (type.typeParameters && type.typeParameters.length > 0) {
				this.genericClass = new Class(`T${this.name}`);
				this.genericClass.setBasicVersion(this.basicClass);
				this.genericClass.addBase(basicType, Visibility.Public);
				parser.addGenericDeclaredClass(type, DeclaredType.create(this.genericClass));
			}
		}
	}
}
