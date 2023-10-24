import { Writer } from "./writer.js";
import { parse } from "./parser.js";
import { Reason, ReasonKind } from "./target.js";

// TODO: split header files so clientlib.h just includes other stuff but they can be included separately too

const library = parse(["/home/user/ts2cpp/node_modules/typescript/lib/lib.d.ts"]);
// const file = parse(["test.d.ts"]);
// const node = parseNode(["test.d.ts"]);
// const node = parseNode(["/home/user/ts2cpp/node_modules/typescript/lib/lib.d.ts"]);
// const file = parseFile(node);

try {
	library.write({ pretty: true });
} catch (reason) {
	if (reason instanceof Reason) {
		let kind = reason.getKind();
		let prevDeclaration = reason.getDeclaration();
		let nextReason = reason.getNext();
		
		console.error(`dependency cycle detected while generating [${prevDeclaration.getPath()}]`);

		while (nextReason) {
			let prevPath = prevDeclaration.getPath();
			const path = nextReason.getDeclaration().getPath();

			switch (kind) {
			case ReasonKind.Inner:
				console.error(`required to generate [${path}]`);
				break;
			case ReasonKind.Member:
				let referenceData = prevDeclaration.getReferenceData();
				console.error(`required as part of the declaration of [${path}]`);
				
				while (referenceData) {
					const referencedByPath = referenceData.getReferencedBy().getPath();
					const referencedIn = referenceData.getReferencedIn();
					
					switch (referenceData.getReasonKind()) {
					case ReasonKind.BaseClass:
						console.error(`  because [${prevPath}] is referenced as a *base class* of [${referencedByPath}]`);
						break;
					case ReasonKind.VariableType:
						console.error(`  because [${prevPath}] is referenced as the *type* of [${referencedByPath}]`);
						break;
					case ReasonKind.ReturnType:
						console.error(`  because [${prevPath}] is referenced as the *return type* of [${referencedByPath}]`);
						break;
					case ReasonKind.ParameterType:
						console.error(`  because [${prevPath}] is referenced as an *parameter type* of [${referencedByPath}]`);
						break;
					default:
						console.error(`  because [${prevPath}] is referenced by [${referencedByPath}]`);
						break;
					}

					prevPath = referencedIn.getPath();
					referenceData = referencedIn.getReferenceData();
				}

				break;
			case ReasonKind.BaseClass:
				console.error(`required as a *base class* of [${path}]`);
				break;
			case ReasonKind.VariableType:
				console.error(`required as the *type* of [${path}]`);
				break;
			case ReasonKind.ReturnType:
				console.error(`required as the *return type* of [${path}]`);
				break;
			case ReasonKind.ParameterType:
				console.error(`required as an *parameter type* of [${path}]`);
				break;
			default:
				console.error(`required by ${path}`);
				break;
			}

			kind = nextReason.getKind();
			prevDeclaration = nextReason.getDeclaration();
			nextReason = nextReason.getNext();
		}
	} else {
		throw reason;
	}
}
