import * as fs from "fs";

export interface Options {
	pretty: boolean;
	tab: string;
	line: string;
	space: string;
}

export class Writer {
	private readonly fd: number;
	private depth: number = 0;
	private line: boolean = true;

	private readonly options: Options = {
		pretty: false,
		tab: "\t",
		line: "\n",
		space: " ",
	};

	public constructor(path: fs.PathLike, options?: Partial<Options>) {
		this.fd = fs.openSync(path, "w");
		Object.assign(this.options, options);
	}

	public write(string: string, depth: number = 0): void {
		if (this.line && this.options.pretty) {
			fs.writeSync(this.fd, this.options.tab.repeat(this.depth + depth));
		}

		fs.writeSync(this.fd, string);
		this.line = false;
	}

	public writeLine(required: boolean = true): void {
		if (required || this.options.pretty) {
			fs.writeSync(this.fd, this.options.line);
			this.line = true;
		}
	}

	public writeSpace(required: boolean = true): void {
		if (required || this.options.pretty) {
			fs.writeSync(this.fd, this.options.space);
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
}
