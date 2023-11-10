import { Declaration } from "./declaration.js";

let ignoreErrors = false;

export enum State {
	Partial,
	Complete,
}

export enum ReasonKind {
	BaseClass,
	VariableType,
	ReturnType,
	ParameterType,
	TypeAliasType,
	Constraint,
	Root,
	Inner,
	Member,
}

export interface Target {
	getDeclaration(): Declaration;
	getTargetState(): State;
}

export class Dependency {
	private readonly state: State;
	private readonly reasonDeclaration: Declaration;
	private readonly reasonKind: ReasonKind;

	public constructor(state: State, reasonDeclaration: Declaration, reasonKind: ReasonKind) {
		this.state = state;
		this.reasonDeclaration = reasonDeclaration;
		this.reasonKind = reasonKind;
	}

	public getState(): State {
		return this.state;
	}

	public getReasonDeclaration(): Declaration {
		return this.reasonDeclaration;
	}

	public getReasonKind(): ReasonKind {
		return this.reasonKind;
	}

	public withState(state: State): Dependency {
		return new Dependency(state, this.reasonDeclaration, this.reasonKind);
	}
}

export class Dependencies {
	private readonly map: Map<Declaration, Dependency> = new Map;

	public constructor(entries?: ReadonlyArray<[Declaration, Dependency]>) {
		if (entries) {
			for (const [declaration, dependency] of entries) {
				this.add(declaration, dependency);
			}
		}
	}

	public add(declaration: Declaration, dependency: Dependency): void {
		const oldDependency = this.map.get(declaration);

		if (!oldDependency || dependency.getState() > oldDependency.getState()) {
			this.map.set(declaration, dependency);
		}
	}

	public [Symbol.iterator](): IterableIterator<[Declaration, Dependency]> {
		return this.map[Symbol.iterator]();
	}
}

export class Reason {
	private readonly declaration: Declaration;
	private readonly state: State;
	private readonly kind: ReasonKind;
	private readonly next?: Reason;

	public constructor(declaration: Declaration, state: State, kind: ReasonKind, next?: Reason) {
		this.declaration = declaration;
		this.state = state;
		this.kind = kind;
		this.next = next;
	}

	public getDeclaration(): Declaration {
		return this.declaration;
	}

	public getState(): State {
		return this.state;
	}

	public getKind(): ReasonKind {
		return this.kind;
	}

	public getNext(): Reason | undefined {
		return this.next;
	}
}

export type ResolveFunction<T> = (dependency: T, state: State) => void;

class DependencyResolver<T extends Target> {
	private readonly targets: Map<Declaration, T>;
	private readonly pending: Map<Declaration, Array<State>> = new Map;
	private readonly resolve: ResolveFunction<T>;

	public constructor(targets: ReadonlyArray<T>, resolve: ResolveFunction<T>) {
		this.targets = new Map(targets.map(target => [target.getDeclaration(), target]));
		this.resolve = resolve;
	}

	private resolveDependency(declaration: Declaration, target: T, state: State, kind: ReasonKind, reason?: Reason): void {
		const parentDeclaration = declaration.getParentDeclaration();
		const newReason = new Reason(declaration, state, kind, reason);

		if (parentDeclaration) {
			const parentTarget = this.targets.get(parentDeclaration);

			if (parentTarget) {
				this.resolveDependency(parentDeclaration, parentTarget, State.Complete, ReasonKind.Inner, newReason);
			}
		}

		if (!declaration.isResolved(state)) {
			let pendingStates = this.pending.get(declaration);

			if (!pendingStates) {
				pendingStates = new Array;
				this.pending.set(declaration, pendingStates);
			}

			const pendingState = pendingStates[pendingStates.length - 1];

			if (pendingState !== undefined && state >= pendingState) {
				if (ignoreErrors) {
					this.resolve(target, state);
					declaration.setState(state);
					return;
				} else {
					throw newReason;
				}
			}

			pendingStates.push(state);

			try {
				for (const [dependencyDeclaration, dependency] of declaration.getDependencies(state)) {
					let declaration: Declaration | undefined = dependencyDeclaration;
					let state = dependency.getState();
					const dependencyReason = new Reason(dependency.getReasonDeclaration(), state, ReasonKind.Member, newReason);

					while (declaration) {
						const target = this.targets.get(declaration);

						if (target) {
							this.resolveDependency(declaration, target, state, dependency.getReasonKind(), dependencyReason);
							break;
						}

						declaration = declaration.getParentDeclaration();
						state = State.Complete;
					}
				}

				if (!declaration.isResolved(state)) {
					this.resolve(target, state);
					declaration.setState(state);
				}
			} finally {
				pendingStates.pop();
			}
		}
	}

	public resolveDependencies(): void {
		for (const [declaration, target] of this.targets) {
			this.resolveDependency(declaration, target, target.getTargetState(), ReasonKind.Root)
		}
	}
}

export function setIgnoreErrors(value: boolean): void {
	ignoreErrors = value;
}

export function resolveDependencies<T extends Target>(targets: ReadonlyArray<T>, resolve: ResolveFunction<T>): void {
	new DependencyResolver(targets, resolve).resolveDependencies();
}

export function removeDuplicates<T extends Target>(targets: ReadonlyArray<T>): Array<T> {
	const keys = new Set;
	const newTargets = new Array;

	for (const target of targets) {
		const declaration = target.getDeclaration();
		const key = declaration.key();

		if (!keys.has(key)) {
			newTargets.push(target);
			keys.add(key);
		}
	}

	return newTargets;
}
