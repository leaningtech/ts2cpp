// Parsing command line arguments. Also contains a `withTimer` function that
// logs some timing information when verbose mode is enabled.

import { program } from "commander";

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
