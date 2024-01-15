import { State, Dependencies, ReasonKind, ResolverContext } from "./target.js";
import { Namespace } from "./namespace.js";
import { Writer } from "./writer.js";
import { Type, NamedType, unique } from "./type.js";
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
	//     Declaration *referencedBy();
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
// "src/namespace.ts" for more information about how namespaces are stored.
//
// Like namespaces, `Declaration` does not store its own children, but it does
// provide an interface for querying the children. Currently the only type of
// declaration with children in `Class` (in "src/class.ts").
export abstract class Declaration extends Namespace {
	private referenceData?: ReferenceData;
	private id: number;
	private file?: string;

	private static count: number = 0;

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

	public setDecl(decl: ts.Node): void {
		this.file = decl.getSourceFile().fileName;
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
	// child of this declaration. External references are ignored.
	//
	// This information is used when resolving dependencies (see
	// "src/target.ts"), to determine if an inner class needs a complete
	// declaration because one of its members is referenced internally.
	//
	// It is also used for printing dependency cycle error messages (see
	// "src/error.ts").
	public computeReferences(rootParam?: Declaration): void {
		const root = rootParam ?? this;

		// 1. Visit direct references, eg. base classes.
		for (const [declaration, dependency] of this.getDirectDependencies(State.Complete)) {
			const data = new ReferenceData(this, this, dependency.getReasonKind());
			declaration.setReferenced(root, dependency.getState(), data);
		}

		for (const child of this.getChildren()) {
			// 2. Visit references by children, eg. member function return types.
			for (const [declaration, dependency] of child.getDirectDependencies(State.Partial)) {
				const data = new ReferenceData(child, this, dependency.getReasonKind());
				declaration.setReferenced(root, dependency.getState(), data);
			}

			// 3. Also compute internal references inside all of the children.
			child.computeReferences();
		}
	}

	// When `computeReferences` finds a referenced declaration, it calls this function.
	public setReferenced(root: Declaration, state: State, data: ReferenceData): void {
		// 1. Determine which declaration needs to be completely resolved for
		// the reference to be valid, if the reference needs only a partial
		// declaration, then the complete declaration of its parent is enough.
		let node = state === State.Complete ? this : this.getParentDeclaration();

		// 2. Iterate over all parents of the node, until we reach the root
		// node. The root node is the node where the internal reference began.
		// An internal reference inside of a class should not have any effect
		// on its parent. External references are handled elsewhere.
		for (; node && node.isDescendantOf(root); node = node.getParentDeclaration()) {
			if (!node.isReferenced()) {
				// 3. Store reference data in this declaration.
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
		return unique(
			this.getChildren()
				.flatMap(child => [...child.getReferencedTypes()])
				.concat([...this.getDirectReferencedTypes()])
		);
	}

	public abstract maxState(): State;
	public abstract getChildren(): ReadonlyArray<Declaration>;
	public abstract getDirectDependencies(state: State): Dependencies;
	public abstract getDirectReferencedTypes(): ReadonlyArray<Type>;
	public abstract write(context: ResolverContext, writer: Writer, state: State, namespace?: Namespace): void;
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

export abstract class TemplateDeclaration extends Declaration {
	private readonly typeParameters: Array<TypeParameter> = new Array;
	private variadic: boolean = false;

	public getTypeParameters(): ReadonlyArray<TypeParameter> {
		return this.typeParameters;
	}

	public addTypeParameter(name: string): void {
		this.typeParameters.push(new TypeParameter(name, false));
	}

	public addVariadicTypeParameter(name: string): void {
		this.typeParameters.push(new TypeParameter(name, true));
		this.variadic = true;
	}

	public isVariadic(): boolean {
		return this.variadic;
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
		if (this.typeParameters.length > 0) {
			writer.write("template");
			TemplateDeclaration.writeParameters(writer, this.typeParameters);
			writer.writeLine(false);
		}
	}

	public templateKey(): string {
		return this.typeParameters
			.map(typeParameter => typeParameter.getName() + ";").join("");
	}

	public removeUnusedTypeParameters(): void {
		const namedTypes = new Set(
			this.getReferencedTypes()
				.filter((type): type is NamedType => type instanceof NamedType)
				.map(type => type.getName())
		);

		const typeParameters = this.typeParameters.filter(typeParameter => {
			return namedTypes.has(typeParameter.getName());
		});

		this.typeParameters.splice(0, this.typeParameters.length, ...typeParameters);
	}
}
