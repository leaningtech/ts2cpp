// Utilities for automatically formatting code as it's being written to a file.
// Also supports writing to strings.

import * as fs from "fs";
import { Writable } from "stream";

export interface Options {
	pretty: boolean;
	tab: string;
	line: string;
	space: string;
}

export abstract class Writer {
	private depth: number = 0;
	private line: boolean = true;

	private readonly options: Options = {
		pretty: false,
		tab: "\t",
		line: "\n",
		space: " ",
	};

	public constructor(options?: Partial<Options>) {
		Object.assign(this.options, options);
	}

	public abstract writeStream(string: string): void;
	
	public write(string: string, depth: number = 0): void {
		if (this.line && this.options.pretty) {
			this.writeStream(this.options.tab.repeat(Math.max(0, this.depth + depth)));
		}

		this.writeStream(string);
		this.line = false;
	}

	public writeLine(required: boolean = true): void {
		if (required || this.options.pretty) {
			this.writeStream(this.options.line);
			this.line = true;
		}
	}

	public writeLineStart(required: boolean = true): void {
		if (!this.line) {
			this.writeLine(required);
		}
	}

	public writeSpace(required: boolean = true): void {
		if (required || this.options.pretty) {
			this.writeStream(this.options.space);
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

	public writeText(text: string): void {
		for (const line of text.trim().split("\n")) {
			this.writeLineStart(line.startsWith("#"));
			this.write(this.options.pretty ? line : line.trim());
			this.writeLine(line.startsWith("#"));
		}
	}

	public writeBody(body: string, semicolon: boolean = false): void {
		this.writeBlockOpen();

		if (body !== "") {
			this.writeText(body);
		}

		this.writeBlockClose(semicolon);
	}
}

export class StreamWriter extends Writer {
	private readonly stream: Writable;

	public constructor(path: fs.PathLike, options?: Partial<Options>) {
		super(options);
		this.stream = fs.createWriteStream(path);
	}
	
	public writeStream(string: string): void {
		this.stream.write(string);
	}
}

export class StringWriter extends Writer {
	private data: string = "";

	public writeStream(string: string): void {
		this.data += string;
	}

	public getString(): string {
		return this.data;
	}
}
