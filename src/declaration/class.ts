import { Namespace, Flags } from "./namespace.js";
import { Declaration, mergeDuplicateDeclarations } from "./declaration.js";
import { TemplateDeclaration } from "./templateDeclaration.js";
import { State, Target, Dependency, ReasonKind, Dependencies, ResolverContext, resolveDependencies } from "../target.js";
import { Expression } from "../type/expression.js";
import { Type } from "../type/type.js";
import { DeclaredType } from "../type/declaredType.js";
import { TemplateType } from "../type/templateType.js";
import { Function } from "./function.js";
import { Writer } from "../writer.js";
import { options } from "../utility.js";

export enum Visibility {
	Public,
	Protected,
	Private,
}

export const VISIBILITY_STRINGS = {
	[Visibility.Public]: "public",
	[Visibility.Protected]: "protected",
	[Visibility.Private]: "private",
};

export class Member implements Target {
	private readonly declaration: Declaration;
	private readonly visibility: Visibility;

	public constructor(declaration: Declaration, visibility: Visibility) {
		this.declaration = declaration;
		this.visibility = visibility;
	}

	public getDeclaration(): Declaration {
		return this.declaration;
	}

	public getVisibility(): Visibility {
		return this.visibility;
	}

	public getTargetState(): State {
		return this.declaration.isReferenced() ? State.Complete : State.Partial;
	}
}

export class Base {
	private readonly type: Type;
	private readonly visibility: Visibility;
	private virtual: boolean;

	public constructor(type: Type, visibility: Visibility, virtual: boolean = false) {
		this.type = type;
		this.visibility = visibility;
		this.virtual = virtual;
	}

	public getType(): Type {
		return this.type;
	}

	// Returns the base type without any template parameters.
	public getInnerType(): Type {
		let type = this.type;

		while (type instanceof TemplateType) {
			type = type.getInner();
		}

		return type;
	}

	public getVisibility(): Visibility {
		return this.visibility;
	}

	public isVirtual(): boolean {
		return this.virtual;
	}

	public setVirtual(virtual: boolean): void {
		this.virtual = virtual;
	}
}

export class Class extends TemplateDeclaration {
	private members?: Array<Member>;
	private bases?: Array<Base>;

	// Class constraints are written using `static_assert`.
	private constraints?: Array<Expression>;

	// Using declarations are required because method overloads can shadow
	// methods from the base class.
	private usingDeclarations?: Set<string>;

	public getMembers(): ReadonlyArray<Member> {
		return this.members ?? [];
	}

	public hasStaticMembers(): boolean {
		return this.getMembers().some(member => member.getDeclaration().getFlags() & Flags.Static);
	}

	public hasConstructor(): boolean {
		return this.getMembers().some(member => member.getDeclaration().getName() === this.getName());
	}

	public addMember(declaration: Declaration, visibility: Visibility): void {
		// A method cannot have the same name as its parent class.
		// TODO: emit a warning, maybe?
		if (declaration instanceof Function || declaration.getName() !== this.getName()) {
			this.members ??= [];
			this.members.push(new Member(declaration, visibility));
		}
	}

	public getBases(): ReadonlyArray<Base> {
		return this.bases ?? [];
	}

	// Add `type` as a base class with the given `visibility`.
	//
	// Two things of note:
	// - Any attempt to add the class itself as a base class is ignored.
	// - Any attempt to add a duplicate base class is ignored.
	public addBase(type: Type, visibility: Visibility): void {
		if (!(type instanceof DeclaredType) || type.getDeclaration() !== this) {
			this.bases ??= [];

			if (!this.bases.some(base => base.getType() === type)) {
				this.bases.push(new Base(type, visibility));
			}
		}
	}

	public getConstraints(): ReadonlyArray<Expression> {
		return this.constraints ?? [];
	}

	public hasConstraints(): boolean {
		return this.getConstraints().length > 0;
	}

	public addConstraint(expression: Expression): void {
		this.constraints ??= [];
		this.constraints.push(expression);
	}

	public getUsingDeclarations(): ReadonlySet<string> {
		return this.usingDeclarations ?? new Set;
	}

	public addUsingDeclaration(usingDeclaration: string): void {
		this.usingDeclarations ??= new Set;
		this.usingDeclarations.add(usingDeclaration);
	}

	public removeDuplicates(): void {
		this.members && this.members.splice(0, this.members.length, ...mergeDuplicateDeclarations(this.members));
	}

	public removeMember(name: string): void {
		this.members && this.members.splice(0, this.members.length, ...this.members.filter(member => member.getDeclaration().getName() !== name));
	}

	public maxState(): State {
		return State.Complete;
	}

	public getChildren(): ReadonlyArray<Declaration> {
		return this.getMembers().map(member => member.getDeclaration());
	}

	// The dependencies of a class are:
	// - partial for types used in any constraints on this class.
	// - complete for types used as base classes.
	// This function does *not* include dependencies of class members, to get
	// those as well, call `getDependencies`.
	protected getDirectDependencies(state: State): Dependencies {
		if (state === State.Complete) {
			const constraintReason = new Dependency(State.Partial, this, ReasonKind.Constraint);
			const baseReason = new Dependency(State.Complete, this, ReasonKind.BaseClass);

			return new Dependencies(
				this.getConstraints()
					.flatMap(constraint => [...constraint.getDependencies(constraintReason)])
					.concat(this.getBases().flatMap(base => [...base.getType().getDependencies(baseReason)]))
			);
		} else {
			return new Dependencies;
		}
	}

	protected getDirectReferencedTypes(): ReadonlyArray<Type> {
		return this.getConstraints()
			.concat(this.getBases().map(base => base.getType()))
			.flatMap(type => [...type.getReferencedTypes()]);
	}

	protected writeImpl(context: ResolverContext, writer: Writer, state: State, namespace?: Namespace): void {
		// 1. Write the template<...> line, if needed.
		this.writeTemplate(writer, state, namespace);

		// 2. Write the class keyword.
		writer.write("class");

		// 3. Write attributes.
		this.writeAttributesOrSpace(writer);

		// 4. Write the name of the class.
		writer.write(this.getPath(namespace));

		if (state === State.Complete) {
			let first = true;
			let visibility = Visibility.Private;

			// 5. Write base class specifiers.
			for (const base of this.getBases()) {
				writer.write(first ? ":" : ",");
				first = false;
				writer.writeSpace(false);
				const baseVisibility = base.getVisibility();

				if (baseVisibility !== Visibility.Private) {
					writer.write(VISIBILITY_STRINGS[baseVisibility]);
					writer.writeSpace();
				}

				if (base.isVirtual()) {
					writer.write("virtual");
					writer.writeSpace();
				}

				base.getType().write(writer, this.getParent());
			}

			writer.writeBlockOpen();

			// 6. Write class constraints.
			if (options.useConstraints) {
				for (const constraint of this.getConstraints()) {
					writer.write("static_assert(");
					constraint.write(writer, namespace);
					writer.write(");");
					writer.writeLine(false);
				}
			}

			// 7. Write class members.
			resolveDependencies(context, this.getMembers(), (context, member, state) => {
				const memberVisibility = member.getVisibility();

				if (memberVisibility !== visibility) {
					writer.write(VISIBILITY_STRINGS[memberVisibility], -1);
					writer.write(":");
					writer.writeLine(false);
					visibility = memberVisibility;
				}

				member.getDeclaration().write(context, writer, state, this);
			});

			// 8. Write "using" declarations.
			if (this.getUsingDeclarations().size > 0) {
				writer.write(VISIBILITY_STRINGS[Visibility.Public], -1);
				writer.write(":");
				writer.writeLine(false);

				for (const declaration of this.getUsingDeclarations()) {
					writer.write("using");
					writer.writeSpace(true);
					writer.write(declaration);
					writer.write(";");
					writer.writeLine(false);
				}
			}

			writer.writeBlockClose(true);
		} else {
			writer.write(";");
			writer.writeLine(false);
		}
	}

	// Recursively find all base types, and count how many times each one
	// occurs.
	private countRecursiveBases(map: Map<Type, number>): void {
		for (const base of this.getBases()) {
			const type = base.getInnerType();
			const value = map.get(type) ?? 0;
			map.set(type, value + 1);

			if (value === 0 && type instanceof DeclaredType) {
				const declaration = type.getDeclaration();

				if (declaration instanceof Class) {
					declaration.countRecursiveBases(map);
				}
			}
		}
	}

	// Returns all bases, along with their class declarations.
	private getBaseClasses(): ReadonlyArray<[Base, Class]> {
		return this.getBases()
			.map(base => [base, base.getInnerType()])
			.filter(([base, type]) => type instanceof DeclaredType)
			.map(([base, type]) => [base, (type as DeclaredType).getDeclaration()])
			.filter(([base, declaration]) => declaration instanceof Class) as [Base, Class][];
	}

	public computeVirtualBaseClasses(keys?: ReadonlySet<Type>): void {
		if (!keys) {
			// 1. Count how many times each base class appears in the
			// inheritance tree, recursively.
			const map = new Map<Type, number>;
			this.countRecursiveBases(map);

			// 2. Filter out bases that only occur once, they do not need to be
			// virtual.
			keys = new Set(
				[...map.entries()]
					.filter(([key, count]) => count >= 2)
					.map(([key, count]) => key)
			);
		}

		// 3. If any of our base classes occurs anywhere else in the
		// inheritance tree, mark it as virtual.
		for (const base of this.getBases()) {
			if (keys.has(base.getInnerType())) {
				base.setVirtual(true);
			}
		}

		// 4. Repeat step 3-4 for all base classes.
		for (const [base, declaration] of this.getBaseClasses()) {
			declaration.computeVirtualBaseClasses(keys);
		}
	}

	// For each base class, find all its members and add the base class name
	// to a set of which classes declare that member.
	private findRecursiveBaseMembers(map: Map<string, Set<string>>): void {
		for (const [base, declaration] of this.getBaseClasses()) {
			for (const member of declaration.getMembers()) {
				const declaration = member.getDeclaration();

				if (member.getVisibility() === Visibility.Public) {
					const name = declaration.getName();
					let set = map.get(name);

					if (!set) {
						set = new Set;
						map.set(name, set);
					}

					set.add(base.getType().toString());
				}
			}

			declaration.findRecursiveBaseMembers(map);
		}
	}

	// Generate the list of `usingDeclarations`.
	public useBaseMembers(): void {
		// A list of which base members to generate using declarations for.
		//
		// TODO: This could be more generic, instead of hardcoding the list.
		const useBaseMembers = [
			"operator[]",
		];

		// 1. Get the names of all declarations in all base classes,
		// recursively.
		const baseMembers = new Map;
		this.findRecursiveBaseMembers(baseMembers);

		// 2. Iterate over all members of this class
		for (const member of this.getMembers()) {
			const name = member.getDeclaration().getName();
			const set = baseMembers.get(name);

			// 3. Add using declarations for all base classes that declare a
			// member that is in the useBaseMembers list.
			if (useBaseMembers.includes(name) && set) {
				for (const baseName of set) {
					this.addUsingDeclaration(`${baseName}::${name}`);
				}
			}
		}
	}
}
