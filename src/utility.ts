// Some utility functions, including:
// - Parsing command line options.
// - Benchmarking.
// - The `removeDuplicates` function.

import { program } from "commander";

export interface Key {
	key(): string;
}

export let options: Options;

export interface Options {
	isPretty: boolean,
	isDefaultLib: boolean,
	isVerbose: boolean,
	ignoreErrors: boolean,
	listFiles: boolean,
	useConstraints: boolean,
	useFullNames: boolean,
	outputFile?: string,
	namespace?: string,
}

export function parseOptions(): Array<string> {
	program
		.option("--pretty")
		.option("--default-lib")
		.option("--out, -o <file>")
		.option("--ignore-errors")
		.option("--list-files")
		.option("--verbose, -v")
		.option("--namespace <namespace>")
		.option("--no-constraints")
		.option("--full-names");

	program.parse();

	const opts = program.opts();

	options = {
		isPretty: !!opts.pretty,
		isDefaultLib: !!opts.defaultLib,
		isVerbose: !!opts.V,
		ignoreErrors: !!opts.ignoreErrors,
		listFiles: !!opts.listFiles,
		useConstraints: !!opts.constraints,
		useFullNames: !!opts.fullnames,
		outputFile: opts.O,
		namespace: opts.namespace,
	};

	return program.args;
}

// Times the given function, forwarding the return value. Timing information is
// only output to console if "--verbose" is set.
export function withTimer<T>(name: string, func: () => T): T {
	if (options.isVerbose) {
		console.time(name);
	}

	const result = func();

	if (options.isVerbose) {
		console.timeEnd(name);
	}

	return result;
}

// Returns a new array where every key occurs at most once.
export function removeDuplicates<T extends Key>(expressions: ReadonlyArray<T>): ReadonlyArray<T> {
	const keys = new Set;

	return expressions.filter(expression => {
		const key = expression.key();
		return !keys.has(key) && keys.add(key);
	});
}
