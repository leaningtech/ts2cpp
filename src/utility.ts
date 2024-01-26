// Some utility functions, including:
// - Parsing command line options.
// - Benchmarking.

import { program } from "commander";

export let options: Options;

export interface Options {
	isPretty: boolean,
	isDefaultLib: boolean,
	isVerbose: boolean,
	isVerboseProgress: boolean,
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
		.option("--verbose-progress")
		.option("--namespace <namespace>")
		.option("--no-constraints")
		.option("--full-names");

	program.parse();

	const opts = program.opts();

	options = {
		isPretty: !!opts.pretty,
		isDefaultLib: !!opts.defaultLib,
		isVerbose: !!opts.V,
		isVerboseProgress: !!opts.verboseProgress,
		ignoreErrors: !!opts.ignoreErrors,
		listFiles: !!opts.listFiles,
		useConstraints: !!opts.constraints,
		useFullNames: !!opts.fullNames,
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

		const memoryUsage = process.memoryUsage();

		console.info(`memory usage: ${JSON.stringify(memoryUsage)}`);
	}

	return result;
}
