import { Namespace } from "./namespace.js";
import { Declaration, TemplateDeclaration } from "./declaration.js";
import { State, Target, Dependency, ReasonKind, Dependencies, resolveDependencies, removeDuplicates } from "./target.js";
import { Expression, Type, DeclaredType, TemplateType } from "./type.js";
import { Function } from "./function.js";
import { Writer } from "./writer.js";
import { useConstraints } from "./options.js";

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
	private readonly members: Array<Member> = new Array;
	private readonly bases: Array<Base> = new Array;
	private readonly constraints: Array<Expression> = new Array;

	public getMembers(): ReadonlyArray<Member> {
		return this.members;
	}

	public hasConstructor(): boolean {
		return this.members.some(member => member.getDeclaration().getName() == this.getName());
	}

	public addMember(declaration: Declaration, visibility: Visibility): void {
		// TODO: emit a warning, maybe?

		if (declaration instanceof Function || declaration.getName() !== this.getName()) {
			this.members.push(new Member(declaration, visibility));
			declaration.setParent(this);
		}
	}

	public getBases(): ReadonlyArray<Base> {
		return this.bases;
	}

	public getBaseClasses(): ReadonlyArray<Class> {
		return this.bases
			.map(base => base.getType())
			.filter((type): type is DeclaredType => type instanceof DeclaredType)
			.map(type => type.getDeclaration())
			.filter((declaration): declaration is Class => declaration instanceof Class);
	}

	public addBase(type: Type, visibility: Visibility): void {
		if (!(type instanceof DeclaredType) || type.getDeclaration() !== this) {
			this.bases.push(new Base(type, visibility));
		}
	}

	public getConstraints(): ReadonlyArray<Expression> {
		return this.constraints;
	}

	public hasConstraints(): boolean {
		return this.constraints.length > 0;
	}

	public addConstraint(expression: Expression): void {
		this.constraints.push(expression);
	}

	public removeDuplicates(): void {
		this.bases.splice(0, this.bases.length, ...new Map(this.bases.map(base => [base.getType().key(), base])).values());
		this.members.splice(0, this.members.length, ...removeDuplicates(this.members));
	}

	public maxState(): State {
		return State.Complete;
	}

	public getChildren(): ReadonlyArray<Declaration> {
		return this.members.map(member => member.getDeclaration());
	}

	public getDirectDependencies(state: State): Dependencies {
		if (state === State.Complete) {
			const constraintReason = new Dependency(State.Partial, this, ReasonKind.Constraint);
			const baseReason = new Dependency(State.Complete, this, ReasonKind.BaseClass);

			return new Dependencies(
				this.constraints
					.flatMap(constraint => [...constraint.getDependencies(constraintReason)])
					.concat(this.bases.flatMap(base => [...base.getType().getDependencies(baseReason)]))
			);
		} else {
			return new Dependencies;
		}
	}

	public getDirectNamedTypes(): ReadonlySet<string> {
		return new Set(
			this.constraints
				.concat(this.bases.map(base => base.getType()))
				.flatMap(type => [...type.getNamedTypes()])
		);
	}

	public write(writer: Writer, state: State, namespace?: Namespace): void {
		this.writeTemplate(writer);
		writer.write("class");
		this.writeAttributesOrSpace(writer);
		writer.write(this.getPath(namespace));

		if (state === State.Complete) {
			let first = true;
			let visibility = Visibility.Private;

			for (const base of this.bases) {
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

			if (useConstraints()) {
				for (const constraint of this.constraints) {
					writer.write("static_assert(");
					constraint.write(writer, namespace);
					writer.write(");");
					writer.writeLine(false);
				}
			}

			resolveDependencies(this.members, (member, state) => {
				const memberVisibility = member.getVisibility();

				if (memberVisibility !== visibility) {
					writer.write(VISIBILITY_STRINGS[memberVisibility], -1);
					writer.write(":");
					writer.writeLine(false);
					visibility = memberVisibility;
				}

				member.getDeclaration().write(writer, state, this);
			});

			writer.writeBlockClose(true);
		} else {
			writer.write(";");
			writer.writeLine(false);
		}
	}

	public key(): string {
		return `C${this.getPath()};`;
	}

	private getRecursiveBaseKeys(map: Map<string, number>): void {
		for (const base of this.bases) {
			const type = base.getInnerType();
			const key = type.key();
			const value = map.get(key) ?? 0;
			map.set(key, value + 1);

			if (value === 0 && type instanceof DeclaredType) {
				const declaration = type.getDeclaration();

				if (declaration instanceof Class) {
					declaration.getRecursiveBaseKeys(map);
				}
			}
		}
	}

	public computeVirtualBaseClasses(keys?: ReadonlySet<string>): void {
		if (!keys) {
			const map = new Map<string, number>;
			this.getRecursiveBaseKeys(map);

			keys = new Set(
				[...map.entries()]
					.filter(([key, count]) => count >= 2)
					.map(([key, count]) => key)
			);
		}

		for (const base of this.bases) {
			if (keys.has(base.getInnerType().key())) {
				base.setVirtual(true);
			}
		}

		for (const declaration of this.getBaseClasses()) {
			declaration.computeVirtualBaseClasses(keys);
		}
	}
}
