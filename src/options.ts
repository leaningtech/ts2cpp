import { program } from "commander";

export let options: any;

export class Timer {
	private readonly name: string;

	public constructor(name: string) {
		this.name = name;

		if (isVerbose()) {
			console.time(name);
		}
	}

	public end(): void {
		if (isVerbose()) {
			console.timeEnd(this.name);
		}
	}
}

export function parseOptions() {
	program
		.option("--pretty")
		.option("--default-lib")
		.option("--out, -o <file>")
		.option("--ignore-errors")
		.option("--list-files")
		.option("--verbose, -v")
		.option("--namespace <namespace>")
		.option("--no-class-constraints");

	program.parse();

	options = program.opts();
}

export function isVerbose(): boolean {
	return !!options.V;
}

export function ignoreErrors(): boolean {
	return !!options.ignoreErrors;
}

export function classConstraints(): boolean {
	return !!options.classConstraints;
}
