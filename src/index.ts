import { Writer } from "./writer.js";
import { parseNode, parseFile } from "./parse.js";
import { Reason, ReasonKind } from "./target.js";

const writer = new Writer("clientlib.h", { pretty: true });
const node = parseNode(["test.d.ts"]);
// const node = parseNode(["/home/user/ts2cpp/node_modules/typescript/lib/lib.d.ts"]);
const file = parseFile(node);

try {
	file.write(writer);
} catch (reason) {
	if (reason instanceof Reason) {
		console.error(`dependency cycle detected while generating ${reason.getDeclaration().getPath()}`);
		let kind = reason.getKind();
		let nextReason = reason.getNext();

		while (nextReason) {
			const path = nextReason.getDeclaration().getPath();

			switch (kind) {
			case ReasonKind.Inner:
				console.error(`required to generate [${path}]`);
				break;
			case ReasonKind.Member:
				console.error(`required as part of the declaration of [${path}]`);
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
			case ReasonKind.ArgumentType:
				console.error(`required as an *argument type* of [${path}]`);
				break;
			default:
				console.error(`required by ${path}`);
				break;
			}

			kind = nextReason.getKind();
			nextReason = nextReason.getNext();
		}
	} else {
		throw reason;
	}
}
