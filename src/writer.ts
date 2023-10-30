import * as fs from "fs";
import { Writable } from "stream";

export interface Options {
	pretty: boolean;
	tab: string;
	line: string;
	space: string;
}

export class Writer {
	private readonly stream: Writable;
	private depth: number = 0;
	private line: boolean = true;

	private readonly options: Options = {
		pretty: false,
		tab: "\t",
		line: "\n",
		space: " ",
	};

	public constructor(path: fs.PathLike, options?: Partial<Options>) {
		this.stream = fs.createWriteStream(path);
		Object.assign(this.options, options);
	}

	public write(string: string, depth: number = 0): void {
		if (this.line && this.options.pretty) {
			this.stream.write(this.options.tab.repeat(this.depth + depth));
		}

		this.stream.write(string);
		this.line = false;
	}

	public writeLine(required: boolean = true): void {
		if (required || this.options.pretty) {
			this.stream.write(this.options.line);
			this.line = true;
		}
	}

	public writeSpace(required: boolean = true): void {
		if (required || this.options.pretty) {
			this.stream.write(this.options.space);
		}
	}

	public indent(count: number = 1): void {
		this.depth += count;
	}

	public dedent(count: number = 1): void {
		this.depth -= count;
	}

	public writeBlockOpen(): void {
		this.writeSpace(false);
		this.write("{");
		this.writeLine(false);
		this.indent();
	}

	public writeBlockClose(semicolon: boolean = false): void {
		this.dedent();
		this.write(semicolon ? "};" : "}");
		this.writeLine(false);
	}

	public writeBody(body: string, semicolon: boolean = false): void {
		this.writeBlockOpen();

		if (body !== "") {
			for (const line of body.trim().split("\n")) {
				this.write(this.options.pretty ? line : line.trim());
				this.writeLine(false);
			}
		}

		this.writeBlockClose(semicolon);
	}
}
