import { Writer } from "./writer.js";
import { parseNode, parseFile } from "./parse.js";

const writer = new Writer("clientlib.h", { pretty: true });
const node = parseNode(["test.d.ts"]);
// const node = parseNode(["/home/user/ts2cpp/node_modules/typescript/lib/lib.d.ts"]);
const file = parseFile(node);
file.write(writer);
