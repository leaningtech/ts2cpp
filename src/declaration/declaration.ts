import { State, Dependencies, ReasonKind, ResolverContext } from "../target.js";
import { Namespace } from "./namespace.js";
import { Writer } from "../writer.js";
import { Type } from "../type/type.js";
import { NamedType } from "../type/namedType.js";
import { removeDuplicateExpressions } from "../type/expression.js";
import * as ts from "typescript";

export class ReferenceData {
	// When a member in a class references another declaration, we say that the
	// declaration is referenced *in* the class, and that it is referenced *by*
	// the member. `referencedBy` and `referencedIn` can be the same when the
	// reference comes from the class itself, for example as a base class.
	//
	// Example:
	// ```
	// class ReferencedIn {
	//     class Declaration;
	//     Declaration* referencedBy();
	// };
	private readonly referencedBy: Declaration;
	private readonly referencedIn: Declaration;
	private readonly reasonKind: ReasonKind;

	public constructor(referencedBy: Declaration, referencedIn: Declaration, reasonKind: ReasonKind) {
		this.referencedBy = referencedBy;
		this.referencedIn = referencedIn;
		this.reasonKind = reasonKind;
	}

	public getReferencedBy(): Declaration {
		return this.referencedBy;
	}

	public getReferencedIn(): Declaration {
		return this.referencedIn;
	}

	public getReasonKind(): ReasonKind {
		return this.reasonKind;
	}
}

// `Declaration` is the base class for all types of declarations. Declarations
// form an AST-like tree structure that closely resembles the generated C++
// code. Note that namespaces are not seen as declarations, see
// "src/declaration/namespace.ts" for more information about how namespaces
// are stored.
//
// Like namespaces, `Declaration` does not store its own children, but it does
// provide an interface for querying the children. Currently the only type of
// declaration with children is `Class` (in "src/declaration/class.ts").
export abstract class Declaration extends Namespace {
	private referenceData?: ReferenceData;
	private id: number;
	private file?: string;

	private static count: number = 0;

	public static getCount(): number {
		return Declaration.count;
	}

	public constructor(name: string, parent?: Namespace) {
		super(name, parent);
		this.id = Declaration.count++;
	}

	public getId(): number {
		return this.id;
	}

	public getFile(): string | undefined {
		return this.file;
	}

	public setFile(file: string): void {
		this.file = file;
	}

	public setDeclaration(declaration: ts.Node): void {
		this.file = declaration.getSourceFile().fileName;
	}

	// Return the first parent that is not a declaration.
	public getNamespace(): Namespace | undefined {
		const parent = this.getParent();
		return parent instanceof Declaration ? parent.getNamespace() : parent;
	}

	// Return the parent, but only if it is a declaration.
	public getParentDeclaration(): Declaration | undefined {
		const parent = this.getParent();
		return parent instanceof Declaration ? parent : undefined;
	}

	public isReferenced(): boolean {
		return this.referenceData !== undefined;
	}

	public getReferenceData(): ReferenceData | undefined {
		return this.referenceData;
	}

	// This function computes internal references. An internal reference is
	// when a child of this declaration references (read: depends on) another
	// child of this declaration. We also handle indirect internal references.
	// An indirect reference is when a declaration references another
	// declaration, which in turn references another declaration, and so on.
	//
	// This information is used when resolving dependencies (see
	// "src/target.ts"), to determine if an inner class needs a complete
	// declaration because one of its members is referenced internally.
	// It is also used for printing dependency cycle error messages (see
	// "src/error.ts").
	public computeReferences(rootParam?: Declaration): void {
		// The `root` node is used when computing indirect references. It is
		// the declaration in which the original reference was made. An
		// internal indirect reference must not escape its root node, because
		// then it would not be internal.
		const root = rootParam ?? this;

		// 1. Visit references by this declaration, eg. base classes.
		for (const [declaration, dependency] of this.getDirectDependencies(State.Complete)) {
			const data = new ReferenceData(this, this, dependency.getReasonKind());
			declaration.setReferenced(root, dependency.getState(), data);
		}

		// 2. Visit references by children, eg. method return types.
		for (const child of this.getChildren()) {
			for (const [declaration, dependency] of child.getDirectDependencies(State.Partial)) {
				const data = new ReferenceData(child, this, dependency.getReasonKind());
				declaration.setReferenced(root, dependency.getState(), data);
			}
		}

		// 3. Also compute internal references of children. It is important
		// that this happens *after* computing indirect references of this
		// declaration, because these indirect references may reach further
		// (they have a higher root node), and we don't want them to be stopped
		// by the `!node.isReferenced()` check in `setReferenced`.
		for (const child of this.getChildren()) {
			if (!child.isReferenced()) {
				child.computeReferences();
			}
		}
	}

	// When `computeReferences` finds a referenced declaration, it calls this
	// function, which will store the reference data and call
	// `computeReferences` again to handle indirect references.
	public setReferenced(root: Declaration, state: State, data: ReferenceData): void {
		// 1. Determine which declaration needs to be completely resolved for
		// the reference to be valid, if the reference needs only a partial
		// declaration, then the complete declaration of its parent is enough.
		let node = state === State.Complete ? this : this.getParentDeclaration();

		// 2. Iterate over all parents of the node, until we reach the root
		// node. We stop at the root node because internal references should
		// not affect the world outside the declaration where they originated.
		for (; node && node.isDescendantOf(root); node = node.getParentDeclaration()) {
			if (!node.isReferenced()) {
				// 3. Store reference data in the referenced declaration.
				node.referenceData = data;

				// 4. Also compute internal references of the class we
				// referenced. This would otherwise also be done in
				// `computeReferences`, but here we keep the `root` value from
				// the current reference. This is important because an
				// indirect may also be the cause for needing a complete
				// declaration of an inner class.
				node.computeReferences(root);
			}
		}
	}

	// Return all external dependencies of this declaration, including
	// external dependencies from children. An external dependency is one that
	// reaches outside of this declaration, rather than referencing another
	// child of this declaration.
	public getDependencies(state: State): Dependencies {
		if (state === State.Complete) {
			return new Dependencies(
				this.getChildren()
					.map(child => Array.from(child.getDependencies(child.isReferenced() ? State.Complete : State.Partial)))
					.reduce((acc, dependencies) => acc.concat(dependencies), [])
					.filter(([declaration, dependency]) => !declaration.isDescendantOf(this))
					.concat([...this.getDirectDependencies(State.Complete)])
					.filter(([declaration, dependency]) => declaration !== this || dependency.getState() !== State.Partial)
			);
		} else {
			// The dependencies of a partial declaration do not include
			// dependencies of its children.
			return this.getDirectDependencies(State.Partial);
		}
	}

	// Returns all the types that are referenced by this declaration,
	// recursively, including template arguments, pointer element types, etc.
	// This is used by `removeUnusedTypeParameters`.
	public getReferencedTypes(): ReadonlyArray<Type> {
		return removeDuplicateExpressions(
			this.getChildren()
				.flatMap(child => [...child.getReferencedTypes()])
				.concat([...this.getDirectReferencedTypes()])
		);
	}

	// Returns the maximum state of a declaration, this is only Complete for
	// class declarations, and Partial for every other declaration, where a
	// forward declaration is all we ever generate.
	public abstract maxState(): State;

	// Returns the children (class members) of this declaration.
	public abstract getChildren(): ReadonlyArray<Declaration>;

	// The *direct* dependencies of a declaration do not include dependencies
	// of its children, this function is called by `getDependencies` and should
	// rarely be used otherwise.
	public abstract getDirectDependencies(state: State): Dependencies;

	// The *direct* referenced types of a declaration do not include types
	// referenced by its children, this function is called by
	// `getReferencedTypes` and should rarely be used otherwise.
	public abstract getDirectReferencedTypes(): ReadonlyArray<Type>;

	// Write this declaration to a file. If `state` is Partial, only generate
	// a forward declaration. The `namespace` is the namespace in which the
	// declaration is being written, and can be used to abbreviate class
	// paths. The `context` is passed because class declarations need to
	// construct a `DependencyResolver` to generate their members in the
	// correct order.
	public abstract write(context: ResolverContext, writer: Writer, state: State, namespace?: Namespace): void;

	// Returns a key that identifies this declaration, it is used for removing
	// duplicate declarations. The key should be specific enough so we don't
	// remove any declarations that aren't actually duplicates, but it should
	// should not allow conflicting overloads to exist together.
	public abstract key(): string;
}

export class TypeParameter {
	private readonly name: string;
	private readonly variadic: boolean;

	public constructor(name: string, variadic: boolean) {
		this.name = name;
		this.variadic = variadic;
	}

	public getName(): string {
		return this.name;
	}

	public isVariadic(): boolean {
		return this.variadic;
	}
}

// A declaration that may be templated.
export abstract class TemplateDeclaration extends Declaration {
	private typeParameters?: Array<TypeParameter>;

	// For some declarations we generate both basic and generic (prefixed with
	// "T") versions. For the generic versions of these declarations,
	// `basicVersion` stores a reference to the basic version.
	private basicVersion?: this;

	public getTypeParameters(): ReadonlyArray<TypeParameter> {
		return this.typeParameters ?? [];
	}

	public addTypeParameter(name: string): void {
		this.typeParameters ??= [];
		this.typeParameters.push(new TypeParameter(name, false));
	}

	public addVariadicTypeParameter(name: string): void {
		this.typeParameters ??= [];
		this.typeParameters.push(new TypeParameter(name, true));
	}

	// We only check the last parameter for if it's variadic.
	public isVariadic(): boolean {
		return !!this.typeParameters && this.typeParameters.length > 0 && this.typeParameters[this.typeParameters.length - 1]?.isVariadic();
	}

	public setBasicVersion(declaration: this): void {
		this.basicVersion = declaration;
	}

	public getBasicVersion(): this | undefined {
		return this.basicVersion;
	}

	public isGenericVersion(): boolean {
		return !!this.basicVersion;
	}

	public static writeParameters(writer: Writer, parameters: ReadonlyArray<TypeParameter>): void {
		let first = true;
		writer.write("<");

		for (const typeParameter of parameters) {
			if (!first) {
				writer.write(",");
				writer.writeSpace(false);
			}

			if (typeParameter.isVariadic()) {
				writer.write("class...");
			} else {
				writer.write("class");
			}

			writer.writeSpace();
			writer.write(typeParameter.getName());
			first = false;
		}

		writer.write(">");
	}

	public writeTemplate(writer: Writer): void {
		if (this.getTypeParameters().length > 0) {
			writer.write("template");
			TemplateDeclaration.writeParameters(writer, this.getTypeParameters());
			writer.writeLine(false);
		}
	}

	public templateKey(): string {
		return this.getTypeParameters()
			.map(typeParameter => typeParameter.getName() + ";").join("");
	}

	public removeUnusedTypeParameters(): void {
		// Get all referenced types.
		const referencedTypes = new Set(
			this.getReferencedTypes()
				.filter((type): type is NamedType => type instanceof NamedType)
				.map(type => type.getName())
		);

		// Filter out template parameters that aren't referenced.
		const typeParameters = this.getTypeParameters().filter(typeParameter => {
			return referencedTypes.has(typeParameter.getName());
		});

		if (this.typeParameters) {
			this.typeParameters.splice(0, this.typeParameters.length, ...typeParameters);
		}
	}
}
