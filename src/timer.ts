let verbose = false;

export class Timer {
	private readonly name: string;

	public constructor(name: string) {
		this.name = name;

		if (verbose) {
			console.time(name);
		}
	}

	public end(): void {
		if (verbose) {
			console.timeEnd(this.name);
		}
	}
}

export function setVerbose(value: boolean): void {
	verbose = value;
}

export function isVerbose(): boolean {
	return verbose;
}
