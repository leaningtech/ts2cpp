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
		.option("--pretty", "format output files")
		.option("--default-lib", "generate headers for the default library")
		.option("--out, -o <file>", "path to output file")
		.option("--ignore-errors", "ignore errors")
		.option("--list-files", "write a list of all included .d.ts files")
		.option("--verbose, -v", "verbose output")
		.option("--verbose-progress", "verbose progress")
		.option("--namespace <namespace>", "wrap output in a namespace")
		.option("--no-constraints", "do not use std::enable_if or static_asserts")
		.option("--full-names", "always use fully qualified names");

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
