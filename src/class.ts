import { Namespace } from "./namespace.js";
import { Declaration, TemplateDeclaration } from "./declaration.js";
import { State, Target, Dependencies, resolveDependencies } from "./target.js";
import { Type } from "./type.js";
import { Writer } from "./writer.js";

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

	public constructor(type: Type, visibility: Visibility) {
		this.type = type;
		this.visibility = visibility;
	}

	public getType(): Type {
		return this.type;
	}

	public getVisibility(): Visibility {
		return this.visibility;
	}
}

export class Class extends TemplateDeclaration {
	private readonly members: Array<Member> = new Array;
	private readonly bases: Array<Base> = new Array;

	public getMembers(): ReadonlyArray<Member> {
		return this.members;
	}

	public addMember(declaration: Declaration, visibility: Visibility): void {
		this.members.push(new Member(declaration, visibility));
	}

	public getBases(): ReadonlyArray<Base> {
		return this.bases;
	}

	public addBase(type: Type, visibility: Visibility): void {
		this.bases.push(new Base(type, visibility));
	}

	public getChildren(): ReadonlyArray<Declaration> {
		return this.members.map(member => member.getDeclaration());
	}

	public getDirectDependencies(state: State): Dependencies {
		if (state === State.Complete) {
			return new Dependencies(
				this.bases
					.map(base => base.getType().getDeclaration())
					.filter((declaration): declaration is Declaration => !!declaration)
					.map(declaration => [declaration, State.Complete])
			);
		} else {
			return new Dependencies;
		}
	}

	public write(writer: Writer, state: State, namespace?: Namespace): void {
		writer.write("class");
		writer.writeSpace();
		writer.write(this.getPath(namespace));

		if (state === State.Complete) {
			let first = true;
			let visibility = Visibility.Private;

			for (const base of this.bases) {
				writer.write(first ? ":" : ",");
				writer.writeSpace(false);

				const baseVisibility = base.getVisibility();

				if (baseVisibility !== Visibility.Private) {
					writer.write(VISIBILITY_STRINGS[baseVisibility]);
					writer.writeSpace();
				}

				writer.write(base.getType().getPath(this.getParent()));
			}

			writer.writeBlockOpen();

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
}
