import { State, Dependencies, ReasonKind } from "./target.js";
import { Namespace } from "./namespace.js";
import { Writer } from "./writer.js";

export class ReferenceData {
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

export abstract class Declaration extends Namespace {
	private state?: State;
	private referenced: boolean = false;
	private referenceData?: ReferenceData;

	public isResolved(state: State): boolean {
		return this.state !== undefined && this.state >= state;
	}

	public getState(): State | undefined {
		return this.state;
	}

	public setState(state: State): void {
		this.state = state;
	}

	public getNamespace(): Namespace | undefined {
		const parent = this.getParent();
		return parent instanceof Declaration ? parent.getNamespace() : parent;
	}

	public getParentDeclaration(): Declaration | undefined {
		const parent = this.getParent();
		return parent instanceof Declaration ? parent : undefined;
	}

	public isReferenced(): boolean {
		return this.referenced;
	}

	public getReferenceData(): ReferenceData | undefined {
		return this.referenceData;
	}

	private setReferencedDependency(root: Declaration, state: State, data: ReferenceData): void {
		if (state === State.Complete) {
			if (!this.referenced && this.isDescendantOf(root)) {
				this.setReferenced(root, data);
			}
		} else {
			const parent = this.getParentDeclaration();

			if (parent && !parent.referenced && parent.isDescendantOf(root)) {
				parent.setReferenced(root, data);
			}
		}
	}

	public setReferenced(root: Declaration, data?: ReferenceData): void {
		const parent = this.getParentDeclaration();
		this.referenced = true;
		this.referenceData = data;

		if (parent && !parent.referenced) {
			parent.setReferenced(root, data);
		}

		for (const [declaration, dependency] of this.getDirectDependencies(State.Complete)) {
			const data = new ReferenceData(this, this, dependency.getReasonKind());
			declaration.setReferencedDependency(root, dependency.getState(), data);
		}

		for (const child of this.getChildren()) {
			for (const [declaration, dependency] of child.getDirectDependencies(State.Partial)) {
				const data = new ReferenceData(child, this, dependency.getReasonKind());
				declaration.setReferencedDependency(root, dependency.getState(), data);
			}
		}
	}

	public computeReferences(): void {
		this.setReferenced(this);
	}

	public getDependencies(state: State): Dependencies {
		if (state === State.Complete) {
			return new Dependencies(
				this.getChildren()
					.map(child => Array.from(child.getDependencies(child.referenced ? State.Complete : State.Partial)))
					.reduce((acc, dependencies) => acc.concat(dependencies), Array.from(this.getDirectDependencies(State.Complete)))
					.filter(([declaration, state]) => !declaration.isDescendantOf(this))
			);
		} else {
			return this.getDirectDependencies(State.Partial);
		}
	}

	public abstract maxState(): State;
	public abstract getChildren(): ReadonlyArray<Declaration>;
	public abstract getDirectDependencies(state: State): Dependencies;
	public abstract write(writer: Writer, state: State, namespace?: Namespace): void;
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

	public getTypeParameters(): ReadonlyArray<TypeParameter> {
		return this.typeParameters;
	}

	public addTypeParameter(name: string): void {
		this.typeParameters.push(new TypeParameter(name, false));
	}

	public addVariadicTypeParameter(name: string): void {
		this.typeParameters.push(new TypeParameter(name, true));
	}

	public writeTemplate(writer: Writer): void {
		if (this.typeParameters.length > 0) {
			let first = true;
			writer.write("template<");

			for (const typeParameter of this.typeParameters) {
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
			writer.writeLine(false);
		}
	}
}
