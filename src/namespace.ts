import { Writer } from "./writer.js";

export class Namespace {
	private readonly name: string;
	private parent?: Namespace;
	
	public constructor(name: string, parent?: Namespace) {
		this.name = name;
		this.parent = parent;
	}

	public getName(): string {
		return this.name;
	}

	public getPath(namespace?: Namespace): string {
		return this.parent && this.parent !== namespace ? `${this.parent.getPath(namespace)}::${this.name}` : this.name;
	}

	public isDescendantOf(ancestor: Namespace): boolean {
		return this === ancestor || (!!this.parent && this.parent.isDescendantOf(ancestor));
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
			writer.writeSpace();
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
