import { State, Dependencies } from "./target.js";
import { Namespace } from "./namespace.js";
import { Writer } from "./writer.js";

export abstract class Declaration extends Namespace {
	private state?: State;
	private referenced: boolean = false;

	public isResolved(state: State): boolean {
		return !!this.state && this.state >= state;
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

	public computeParents(): void {
		for (const child of this.getChildren()) {
			child.setParent(this);
			child.computeParents();
		}
	}

	public isReferenced(): boolean {
		return this.referenced;
	}

	private setReferencedDependency(root: Declaration, state: State): void {
		if (state === State.Complete) {
			if (!this.referenced && this.isDescendantOf(root)) {
				this.setReferenced(root);
			}
		} else {
			const parent = this.getParentDeclaration();

			if (parent && !parent.referenced && parent.isDescendantOf(root)) {
				parent.setReferenced(root);
			}
		}
	}

	public setReferenced(root: Declaration): void {
		const parent = this.getParentDeclaration();
		this.referenced = true;

		if (parent && !parent.referenced) {
			parent.setReferenced(root);
		}

		for (const [declaration, state] of this.getDirectDependencies(State.Complete)) {
			declaration.setReferencedDependency(root, state);
		}

		for (const child of this.getChildren()) {
			for (const [declaration, state] of child.getDirectDependencies(State.Partial)) {
				declaration.setReferencedDependency(root, state);
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

	public abstract getChildren(): ReadonlyArray<Declaration>;
	public abstract getDirectDependencies(state: State): Dependencies;
	public abstract write(writer: Writer, state: State, namespace?: Namespace): void;
}

export abstract class TemplateDeclaration extends Declaration {
}
