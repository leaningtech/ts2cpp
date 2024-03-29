import { State, Dependencies, ReasonKind, ResolverContext } from "../target.js";
import { Namespace } from "./namespace.js";
import { Writer } from "../writer.js";
import { Type } from "../type/type.js";
import { removeDuplicateExpressions } from "../type/expression.js";
import type { Target } from "../target.js";
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

	// If `lean` is false, this declaration will be wrapped in an
	// `#ifndef LEAN_CXX_LIB` block.
	private lean: boolean = true;

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

	public isLean(): boolean {
		return this.lean;
	}

	public setLean(lean: boolean): void {
		this.lean = lean;
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

	// Same as `writeImpl`, but also wraps the declaration in an
	// `#ifndef LEAN_CXX_LIB` block, if needed.
	public write(context: ResolverContext, writer: Writer, state: State, namespace?: Namespace): void {
		if (!this.lean) {
			writer.write("#ifndef LEAN_CXX_LIB", -Infinity);
			writer.writeLine();
		}

		this.writeImpl(context, writer, state, namespace);

		if (!this.lean) {
			writer.write("#endif", -Infinity);
			writer.writeLine();
		}
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
	protected abstract getDirectDependencies(state: State): Dependencies;

	// The *direct* referenced types of a declaration do not include types
	// referenced by its children, this function is called by
	// `getReferencedTypes` and should rarely be used otherwise.
	protected abstract getDirectReferencedTypes(): ReadonlyArray<Type>;

	// Write this declaration to a file. If `state` is Partial, only generate
	// a forward declaration. The `namespace` is the namespace in which the
	// declaration is being written, and can be used to abbreviate class
	// paths. The `context` is passed because class declarations need to
	// construct a `DependencyResolver` to generate their members in the
	// correct order.
	protected abstract writeImpl(context: ResolverContext, writer: Writer, state: State, namespace?: Namespace): void;

	// Merge this declaration with another declaration, this is used by
	// `mergeDuplicateDeclarations` to remove duplicate declarations and avoid
	// ambiguous overloads.
	//
	// The return value indicates whether the declaration could be merged.
	// Subclasses should return true if the declaration was succesfully merged,
	// indicating that the other declaration can be removed. And should return
	// false if the declaration could not be merged, and the other declaration
	// will stay.
	public merge(other: Declaration): boolean {
		return false;
	}

	public isGeneric(): boolean {
		return false;
	}
}

// For each declaration, try to merge it with every previous declaration with
// the same name, until one is found where the merge was successful.
//
// If the merge was successful, the declaration is not removed from the list of
// declarations. If the declaration could not be merged into any previous
// declaration, or there were no previous declarations, the declaration is
// added to the list of declarations.
//
// The actual merging behaviour is implemented in the `merge` function in
// subclasses of `Declaration`.
export function mergeDuplicateDeclarations<T extends Target>(targets: ReadonlyArray<T>): ReadonlyArray<T> {
	const map = new Map;

	for (const target of targets) {
		const declaration = target.getDeclaration();
		const path = declaration.getPath();
		let array = map.get(path);
		let merged = false;

		if (array === undefined) {
			array = new Array;
			map.set(path, array);
		}

		for (const other of array) {
			if (other.getDeclaration().merge(declaration)) {
				merged = true;
				break;
			}
		}

		if (!merged) {
			array.push(target);
		}
	}

	return [...map.values()].flat();
}
