// This poorly named file has everything to do with writing the AST such that
// declarations appear in the right order.
//
// It is not always sufficient to just forward declare every class. Sometimes
// one declaration requires the complete definition of another declaration. For
// example, in the case of inheritance. This is further complicated by nested
// classes whose complete definition may depend on or be depended on my another
// (possibly nested) class.
//
// The algorithm implemented here involves a recursive depth-first search
// through the dependency graph of a declaration with some extra state to
// detect dependency cycles, and making sure not to write the same declaration
// twice.
//
// A lengthy description of what sort of dependency cycles we might encounter
// is found in "src/error.ts".

import { Declaration } from "./declaration/declaration.js";
import { options } from "./utility.js";

// This enum represents how much of a declaration is written.
// Partial: it is only forward declared (eg. "class Object;").
// Complete: it is completely defined (eg. "class Object {};").
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
	Extra,
}

export interface Target {
	getDeclaration(): Declaration;
	getTargetState(): State;
}

export class Dependency {
	// Do we need a complete definition, or is a forward declaration enough?
	private readonly state: State;

	// What is the declaration that requires this dependency?
	// This is *NOT* the dependency itself, it is the *dependent*.
	private readonly reasonDeclaration: Declaration;

	// Why is it required?
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

// A map of dependencies. In the case that one declaration is depended on
// multiple times, the `add` function only stores the one with higher
// completion state.
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

// See "src/error.ts".
export class Reason {
	// What is the declaration that we were trying to resolve?
	private readonly declaration: Declaration;

	// How much of that declaration did we need?
	private readonly state: State;

	// In what way was the declaration referenced?
	private readonly kind: ReasonKind;

	// It was referenced by which other declaration?
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

export type ResolveFunction<T> = (context: ResolverContext, dependency: T, state: State) => void;

// The `ResolverContext` stores state that is persistent across multiple
// instances of `DependencyResolver`.
export class ResolverContext {
	// To which state is a particular declaration already resolved?
	//
	// This is used to implement a DFS search in `resolveDependency`, but
	// without visiting already-visited nodes.
	private readonly state: Map<Declaration, State> = new Map;

	public isResolved(declaration: Declaration, state: State): boolean {
		const declarationState = this.state.get(declaration);
		return declarationState !== undefined && declarationState >= state;
	}

	public getState(declaration: Declaration): State | undefined {
		return this.state.get(declaration);
	}

	public setState(declaration: Declaration, state: State): void {
		this.state.set(declaration, state);
	}
}

// This class stores the state required for the dependency resolution
// algorithm. It is generic so it can be used for types that wrap
// `Declaration`, for example the `Member` class in "src/declaration/class.ts".
//
// A separate `DependencyResolver` instance exists for every class to resolve
// internal dependencies inside of that class.
class DependencyResolver<T extends Target> {
	private readonly context: ResolverContext;
	private readonly targets: Map<Declaration, T>;
	private readonly pending: Map<Declaration, Array<State>> = new Map;
	private readonly resolve: ResolveFunction<T>;

	public constructor(context: ResolverContext, targets: ReadonlyArray<T>, resolve: ResolveFunction<T>) {
		this.context = context;
		this.targets = new Map(targets.map(target => [target.getDeclaration(), target]));
		this.resolve = resolve;
	}

	private resolveDependency(declaration: Declaration, target: T, state: State, kind: ReasonKind, reason?: Reason): void {
		const parentDeclaration = declaration.getParentDeclaration();
		const newReason = new Reason(declaration, state, kind, reason);

		// 1. If this is an inner class, we must first resolve its parent.
		//
		// For example, this is an error:
		// ```
		// class Outer::Inner {}; // Error: `Outer` has not yet been defined.
		// class Outer { class Inner; };
		// ```
		if (parentDeclaration) {
			const parentTarget = this.targets.get(parentDeclaration);

			if (parentTarget) {
				this.resolveDependency(parentDeclaration, parentTarget, State.Complete, ReasonKind.Inner, newReason);
			}
		}

		if (!this.context.isResolved(declaration, state)) {
			let pendingStates = this.pending.get(declaration);

			if (!pendingStates) {
				pendingStates = new Array;
				this.pending.set(declaration, pendingStates);
			}

			const pendingState = pendingStates[pendingStates.length - 1];

			// 2. Check for dependency cycles.
			//
			// This is done using a map of stacks for each declaration. Each
			// stack stores to which completion state we were trying to resolve
			// the declaration.
			//
			// If the stack is non-empty, it means we have seen this
			// declaration before, and we must be resolving it again because
			// it depends on itself.
			//
			// If the current target state is *less than* the pending state,
			// this is ok. For example, a Complete declaration may depend on
			// the Partial declaration of itself.
			//
			// If the current target state is *greater than or equal to* the
			// pending state, this is an error. A declaration may not depend
			// on an equivalent or greater completion state of itself.
			if (pendingState !== undefined && state >= pendingState) {
				if (options.ignoreErrors) {
					this.resolve(this.context, target, state);
					this.context.setState(declaration, state);
					return;
				} else {
					throw newReason;
				}
			}

			pendingStates.push(state);

			try {
				// 3. Iterate over all dependencies and resolve them first.
				//
				// When running dependency resolution on the members of a
				// class, it sometimes happens that the declaration we depend
				// on is not in the list of targets. This can happen for one
				// of two reasons.
				//
				// First, the dependency could be an "uncle" (sibling of a
				// parent) of the dependent. These kind of dependencies are
				// also considered dependencies of the parent (by
				// `getDependencies`). So as we are resolving one of the
				// parent's children, the uncle dependency must already have
				// been resolved.
				//
				// Example of an uncle dependency, note that `Dependency` is
				// not in the list of targets when generating `Parent` because
				// it is outside of the `Parent` class:
				// ```
				// class Dependency;
				// class Parent {
				//     Dependency* dependent();
				// };
				// ```
				//
				// Second, the dependency could be a "nephew" (child of a
				// sibling) of the dependent. In this case we must find which
				// sibling the dependency is a child of and completely resolve
				// that sibling first. The complete resolution of that sibling
				// will imply the resolution of the nephew dependency.
				//
				// Example of a nephew dependency, note that `Dependency` is
				// not in the list of targets when generating `Parent` because
				// it is nested inside of the `Sibling` class:
				// ```
				// class Parent {
				//     class Sibling {
				//         class Dependency;
				//     };
				//     Sibling::Dependency* dependent();
				// };
				// ```
				//
				// There is a tricky case where the dependency is a grandchild
				// of one of the siblings of the dependent. The complete
				// resolution of the sibling may only partially resolve its
				// child, and not resolve the grandchild at all! This is solved
				// because declarations store how they are referenced
				// internally, and when a class detects that one of its
				// children is referenced in this way, then it knows that the
				// resolution of that child must always be complete.
				//
				// Example of a tricky nephew dependency:
				// ```
				// class Parent {
				//     class Sibling {
				//         class Nephew {
				//             class Dependency;
				//         };
				//     };
				//     Sibling::Nephew::Dependency* dependent();
				// };
				// ```
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

				// 4. Finally, after all dependencies have been resolved, we
				// resolve the original declaration.
				//
				// If, through a combination of recursion and magic, it turns
				// out that the declaration is already resolved to the required
				// completion state, then we don't need to do anything.
				if (!this.context.isResolved(declaration, state)) {
					this.resolve(this.context, target, state);
					this.context.setState(declaration, state);
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

export function resolveDependencies<T extends Target>(context: ResolverContext, targets: ReadonlyArray<T>, resolve: ResolveFunction<T>): void {
	new DependencyResolver(context, targets, resolve).resolveDependencies();
}

// Returns a new array where every key occurs at most once.
export function removeDuplicateDeclarations<T extends Target>(targets: ReadonlyArray<T>): ReadonlyArray<T> {
	const keys = new Set;

	return targets.filter(target => {
		const key = target.getDeclaration().key();
		return !keys.has(key) && keys.add(key);
	});
}

