// Utilities for printing errors.
//
// A `Reason` is a linked list where each element is a declaration that
// explains why the previous element is required. The first element will always
// refer to the same declaration as a later element, meaning that declaration
// eventually depends on itself, and completing the dependency cycle.
//
// For example, the linked list "A -> B -> C -> A" means that:
// - "A" must appear before "B"
// - "B" must appear before "C"
// - "C" must appear before "A"
//
// Another example of a dependency cycle can be found in "examples/cycle.d.ts".
// This would generate the following invalid c++ header.
//
// ```
// class Outer: public Outer::Inner {
// public:
//   class Inner: public Object {
//   };
// };
// ```
//
// When generating an inner class, the outer class usually only needs to
// forward declare it, and the actual implementation can come after. This makes
// it possible for an inner class to have its parent as a base class.
// The code in "examples/parentBase.d.ts" generates this valid c++ header.
//
// ```
// class Outer: public Object {
// public:
//   class Inner;
// };
// class Outer::Inner: public Outer {
// };
// ```
//
// But sometimes a member of `Outer` might require `Inner` to be complete, then
// forward declaring `Inner` is not possible and it must be fully implemented
// immediately within the outer class. When this causes a dependency cycle, the
// member that requires `Inner` to be complete is also stored. This forms
// a linked list where each class member requires the complete declaration of
// another class, which in turn has a member that requires the complete
// declaration of the previous class in the list. This linked list, if present
// is the "reference data" of a declaration.
//
// An example of this can be found in "examples/memberCycle.d.ts". The error
// here is that `Inner2` has `Outer` as a base class, but `Outer` cannot be
// completed before the complete declaration of `Inner2`. The reference data
// describes why the complete declaration of `Inner2` must exist within
// `Outer`, rather than only being forward declared as was the case in the
// previous example.
//
// ```
// class Outer: public Object {
// public:
//   class Inner2: public Outer {
//   public:
//     class Innest2;
//   };
//   class Inner1: public Object {
//   public:
//     Inner2::Innest2* getInnest2();
//     class Innest1;
//   };
//   Inner1::Innest1* getInnest1();
// };
// class Outer::Inner1::Innest1: public Object {
// };
// class Outer::Inner2::Innest2: public Object {
// };
// ```

import { Library } from "./library.js";
import { Options } from "./writer.js";
import { ReasonKind, Reason } from "./target.js";
import { ReferenceData } from "./declaration.js";

function getReferencedString(referenceData: ReferenceData, prevPath: string): string {
	const path = referenceData.getReferencedBy().getPath();

	switch (referenceData.getReasonKind()) {
	case ReasonKind.BaseClass:
		return `  because [${prevPath}] is referenced as a *base class* of [${path}]`;
	case ReasonKind.VariableType:
		return `  because [${prevPath}] is referenced as the *type* of [${path}]`;
	case ReasonKind.ReturnType:
		return `  because [${prevPath}] is referenced as the *return type* of [${path}]`;
	case ReasonKind.ParameterType:
		return `  because [${prevPath}] is referenced as a *parameter type* of [${path}]`;
	case ReasonKind.TypeAliasType:
		return `  because [${prevPath}] is referenced as the *alias type* of [${path}]`;
	case ReasonKind.Constraint:
		return `  because [${prevPath}] is referenced as a *constraint* of [${path}]`;
	default:
		return `  because [${prevPath}] is referenced by [${path}]`;
	}
}

function getRequiredString(reason: Reason, path: string): string {
	switch (reason.getKind()) {
	case ReasonKind.Inner:
		return `required to generate [${path}]`;
	case ReasonKind.Member:
		return `required as part of the declaration of [${path}]`;
	case ReasonKind.BaseClass:
		return `required as a *base class* of [${path}]`;
	case ReasonKind.VariableType:
		return `required as the *type* of [${path}]`;
	case ReasonKind.ReturnType:
		return `required as the *return type* of [${path}]`;
	case ReasonKind.ParameterType:
		return `required as a *parameter type* of [${path}]`;
	case ReasonKind.TypeAliasType:
		return `required as the *alias type* of [${path}]`;
	case ReasonKind.Constraint:
		return `required as a *constraint* of [${path}]`;
	default:
		return `required by ${path}`;
	}
}

function printReason(reason: Reason): void {
	let nextReason = reason.getNext();
	console.error(`dependency cycle detected while generating [${reason.getDeclaration().getPath()}]`);

	while (nextReason) {
		let path = reason.getDeclaration().getPath();
		console.error(getRequiredString(reason, nextReason.getDeclaration().getPath()));

		if (reason.getKind() === ReasonKind.Member) {
			let referenceData = reason.getDeclaration().getReferenceData();

			while (referenceData) {
				console.error(getReferencedString(referenceData, path));
				path = referenceData.getReferencedIn().getPath();
				referenceData = referenceData.getReferencedIn().getReferenceData();
			}
		}

		reason = nextReason;
		nextReason = reason.getNext();
	}
}

export function catchErrors(func: () => void): void {
	try {
		func();
	} catch (reason) {
		if (reason instanceof Reason) {
			printReason(reason);
		} else {
			throw reason;
		}
	}
}
