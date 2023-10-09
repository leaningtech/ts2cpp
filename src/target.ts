import { Declaration } from "./declaration.js";

export enum State {
	Partial,
	Complete,
}

export interface Target {
	getDeclaration(): Declaration;
	getTargetState(): State;
}

export class Dependencies {
	private readonly map: Map<Declaration, State> = new Map;

	public constructor(entries?: ReadonlyArray<[Declaration, State]>) {
		if (entries) {
			for (const [declaration, state] of entries) {
				this.add(declaration, state);
			}
		}
	}

	public add(declaration: Declaration, state: State): void {
		const oldState = this.map.get(declaration);

		if (!oldState || state > oldState) {
			this.map.set(declaration, state);
		}
	}

	public [Symbol.iterator](): IterableIterator<[Declaration, State]> {
		return this.map[Symbol.iterator]();
	}
}

export type ResolveFunction<T> = (dependency: T, state: State) => void;

class DependencyResolver<T extends Target> {
	private readonly targets: Map<Declaration, T>;
	private readonly resolve: ResolveFunction<T>;

	public constructor(targets: ReadonlyArray<T>, resolve: ResolveFunction<T>) {
		this.targets = new Map(targets.map(target => [target.getDeclaration(), target]));
		this.resolve = resolve;
	}

	private resolveDependency(declaration: Declaration, target: T, state: State): void {
		if (!declaration.isResolved(state)) {
			for (const [dependencyDeclaration, dependencyState] of declaration.getDependencies(state)) {
				let declaration: Declaration | undefined = dependencyDeclaration;
				let state = dependencyState;

				while (declaration) {
					const target = this.targets.get(declaration);

					if (target) {
						this.resolveDependency(declaration, target, state);
						break;
					}

					declaration = declaration.getParentDeclaration();
					state = State.Complete;
				}
			}

			this.resolve(target, state);
			declaration.setState(state);
		}
	}

	public resolveDependencies(): void {
		for (const [declaration, target] of this.targets) {
			this.resolveDependency(declaration, target, target.getTargetState())
		}
	}
}

export function resolveDependencies<T extends Target>(targets: ReadonlyArray<T>, resolve: ResolveFunction<T>): void {
	new DependencyResolver(targets, resolve).resolveDependencies();
}
