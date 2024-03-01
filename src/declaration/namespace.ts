import { Writer } from "../writer.js";
import { options } from "../utility.js";

export enum Flags {
	Static = 1,
	Extern = 2,
	Explicit = 4,
	Const = 8,
	Inline = 16,
	Noexcept = 32,
}

// A `Namespace` is anything that has a name, it is the root base class of all
// other declarations. Even declarations that do not have any children, such as
// `Function`, are still subclasses of `Namespace`. When used directly this
// class represents a c++ namespace.
// 
// A `Namespace` does not store its children, in this sense it is better to
// think of a namespace as an element in a linked list that describes the
// namespace of a declaration, rather than as an AST node.
//
// If "A <- B" means that "A.parent === B" then "A <- B <- C" refers to the C++
// path "A::B::C".
export class Namespace {
	// The [[cheerp::interface_name]] attribute is stored separately so that
	// it can be freely modified, and can be omited at write time when it turns
	// out to be the same as the real name.
	private interfaceName?: string;

	private name: string;
	private flags: Flags = 0 as Flags;
	private parent?: Namespace;
	private attributes?: Array<string>;
	
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

	public setInterfaceName(name?: string): void {
		this.interfaceName = name;
	}

	public getFlags(): Flags {
		return this.flags;
	}

	public addFlags(flags: Flags): void {
		this.flags |= flags;
	}

	// The path of a declaration starting at the namespace `namespace`.
	public getPathSafe(namespace?: Namespace): string {
		return this.parent && this.parent !== namespace ? `${this.parent.getPathSafe(namespace)}::${this.name}` : this.name;
	}

	// `getPathSafe` generates a full path when this is not a descendant of
	// `namespace`. This function tries to generate a shorter path by using
	// the common ancestor as the base.
	public getPath(namespace?: Namespace): string {
		// TODO: check for name conflicts

		if (options.useFullNames) {
			return this.getPathSafe(namespace);
		}

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
		return this.attributes ?? [];
	}

	public addAttribute(attribute: string): void {
		this.attributes ??= [];
		this.attributes.push(attribute);
	}

	public writeInterfaceName(writer: Writer): void {
		if (this.interfaceName && this.name !== this.interfaceName) {
			const interfaceName = this.interfaceName.replace(/"/g, "\\\"");
			writer.write(`[[cheerp::interface_name(("${interfaceName}"))]]`);
			writer.writeLine(false);
		}
	}

	public writeAttributes(writer: Writer): void {
		let first = true;
		writer.write("[[");

		for (const attribute of this.getAttributes()) {
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
		if (this.getAttributes().length > 0) {
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

	// Global declarations may be reordered such that not all members of a
	// namespace are consecutive. The `writeOpen`, `writeClose`, and
	// `writeChange` functions are used to efficiently change from one
	// namespace to another when they have a common ancestor.

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
