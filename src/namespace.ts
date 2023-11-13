import { Writer } from "./writer.js";

export enum Flags {
	Static = 1,
	Extern = 2,
	Explicit = 4,
	Const = 8,
}

export class Namespace {
	private interfaceName?: string;
	private name: string;
	private flags: Flags = 0 as Flags;
	private parent?: Namespace;
	private attributes: Array<string> = new Array;
	
	public constructor(name: string, parent?: Namespace) {
		this.name = name;
		this.parent = parent;
	}

	public getName(): string {
		return this.name;
	}

	public setName(name: string): void {
		this.name = name;
	}

	public setInterfaceName(name: string): void {
		// TODO: set interface name for all types of declarations, not just functions
		this.interfaceName = name;
	}

	public getFlags(): Flags {
		return this.flags;
	}

	public addFlags(flags: Flags): void {
		this.flags |= flags;
	}

	public getPathSafe(namespace?: Namespace): string {
		return this.parent && this.parent !== namespace ? `${this.parent.getPath(namespace)}::${this.name}` : this.name;
	}

	public getPath(namespace?: Namespace): string {
		// TODO: check for name conflicts

		if (this === namespace) {
			return this.name;
		}

		return this.getPathSafe(Namespace.getCommonAncestor(this, namespace));
	}

	public isDescendantOf(ancestor: Namespace): boolean {
		return !!this.parent && (this.parent === ancestor || this.parent.isDescendantOf(ancestor));
	}

	public getParent(): Namespace | undefined {
		return this.parent;
	}

	public getDepth(): number {
		return this.parent ? this.parent.getDepth() + 1 : 0;
	}

	public setParent(parent?: Namespace): void {
		this.parent = parent;
	}

	public getAttributes(): ReadonlyArray<string> {
		return this.attributes;
	}

	public addAttribute(attribute: string): void {
		this.attributes.push(attribute);
	}

	public writeInterfaceName(writer: Writer): void {
		if (this.interfaceName && this.name !== this.interfaceName) {
			const interfaceName = this.interfaceName
				.replace(/"/g, "\\\"");

			writer.write(`[[cheerp::interface_name(("${interfaceName}"))]]`);
			writer.writeLine(false);
		}
	}

	public writeAttributes(writer: Writer): void {
		let first = true;
		writer.write("[[");

		for (const attribute of this.attributes) {
			if (!first) {
				writer.write(",");
				writer.writeSpace(false);
			}

			writer.write(attribute);
			first = false;
		}

		writer.write("]]");
	}

	public writeAttributesOrSpace(writer: Writer): void {
		if (this.attributes.length > 0) {
			writer.writeSpace(false);
			this.writeAttributes(writer);
			writer.writeSpace(false);
		} else {
			writer.writeSpace();
		}
	}

	public static getDepth(namespace?: Namespace): number {
		return namespace ? Namespace.getDepth(namespace.parent) + 1 : 0;
	}

	public static getCommonAncestor(lhs?: Namespace, rhs?: Namespace): Namespace | undefined {
		let lhsDepth = Namespace.getDepth(lhs);
		let rhsDepth = Namespace.getDepth(rhs);

		while (lhsDepth > rhsDepth) {
			lhs = lhs!.parent;
			lhsDepth -= 1;
		}

		while (rhsDepth > lhsDepth) {
			rhs = rhs!.parent;
			rhsDepth -= 1;
		}

		while (lhs !== rhs) {
			lhs = lhs!.parent;
			rhs = rhs!.parent;
		}

		return lhs;
	}

	public static writeOpen(writer: Writer, from?: Namespace, to?: Namespace): void {
		if (to && to !== from) {
			Namespace.writeOpen(writer, from, to.parent);
			writer.write("namespace");
			to.writeAttributesOrSpace(writer);
			writer.write(to.name);
			writer.writeBlockOpen();
		}
	}

	public static writeClose(writer: Writer, from?: Namespace, to?: Namespace): void {
		if (from && from !== to) {
			writer.writeBlockClose();
			Namespace.writeClose(writer, from.parent, to);
		}
	}

	public static writeChange(writer: Writer, from?: Namespace, to?: Namespace): void {
		const commonAncestor = Namespace.getCommonAncestor(from, to);
		Namespace.writeClose(writer, from, commonAncestor);
		Namespace.writeOpen(writer, commonAncestor, to);
	}
}
