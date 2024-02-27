import { Namespace } from "./namespace.js";
import { Declaration } from "./declaration.js";
import { Writer } from "../writer.js";
import { GenericType } from "../type/genericType.js";
import { Type } from "../type/type.js";

export class TypeParameter {
	private readonly name: string;
	private readonly variadic: boolean;
	private readonly defaultType?: Type;

	public constructor(name: string, variadic: boolean, defaultType?: Type) {
		this.name = name;
		this.variadic = variadic;
		this.defaultType = defaultType;
	}

	public getName(): string {
		return this.name;
	}

	public isVariadic(): boolean {
		return this.variadic;
	}

	public getDefaultType(): Type | undefined {
		return this.defaultType;
	}
}

// A declaration that may be templated.
export abstract class TemplateDeclaration extends Declaration {
	private typeParameters?: Array<TypeParameter>;

	// For some declarations we generate both basic and generic (prefixed with
	// "T") versions. For the generic versions of these declarations,
	// `basicVersion` stores a reference to the basic version.
	private basicVersion?: this;

	// This is set for the generic version of a declaration after it is
	// discovered, so that when we parse it we know that this is the generic
	// version and we should add type parameters. The basic version will not
	// have type parameters.
	private generic: boolean = false;

	public getTypeParameters(): ReadonlyArray<TypeParameter> {
		return this.typeParameters ?? [];
	}

	public addTypeParameter(name: string, defaultType?: Type): void {
		this.typeParameters ??= [];
		this.typeParameters.push(new TypeParameter(name, false, defaultType));
	}

	public addVariadicTypeParameter(name: string): void {
		this.typeParameters ??= [];
		this.typeParameters.push(new TypeParameter(name, true));
	}

	// We only check the last parameter for if it's variadic.
	public isVariadic(): boolean {
		return !!this.typeParameters && this.typeParameters.length > 0 && this.typeParameters[this.typeParameters.length - 1]?.isVariadic();
	}

	public getBasicVersion(): this | undefined {
		return this.basicVersion;
	}

	public setBasicVersion(declaration: this): void {
		this.basicVersion = declaration;
	}

	public isGeneric(): boolean {
		return this.generic;
	}

	public setGeneric(generic: boolean): void {
		this.generic = generic;
	}

	public static writeParameters(writer: Writer, parameters: ReadonlyArray<TypeParameter>, namespace?: Namespace): void {
		let first = true;
		writer.write("<");

		for (const typeParameter of parameters) {
			if (!first) {
				writer.write(",");
				writer.writeSpace(false);
			}

			if (typeParameter.isVariadic()) {
				writer.write("class...");
			} else {
				writer.write("class");
			}

			writer.writeSpace();
			writer.write(typeParameter.getName());

			const defaultType = typeParameter.getDefaultType();

			if (defaultType) {
				writer.writeSpace(false);
				writer.write("=");
				writer.writeSpace(false);
				defaultType.write(writer, namespace);
			}

			first = false;
		}

		writer.write(">");
	}

	public writeTemplate(writer: Writer, namespace?: Namespace): void {
		if (this.getTypeParameters().length > 0) {
			writer.write("template");
			TemplateDeclaration.writeParameters(writer, this.getTypeParameters(), namespace);
			writer.writeLine(false);
		}
	}

	public removeUnusedTypeParameters(): void {
		// Get all referenced types.
		const referencedTypes = new Set(
			this.getReferencedTypes()
				.filter((type): type is GenericType => type instanceof GenericType)
				.map(type => type.getName())
		);

		// Filter out template parameters that aren't referenced.
		const typeParameters = this.getTypeParameters().filter(typeParameter => {
			return referencedTypes.has(typeParameter.getName());
		});

		if (this.typeParameters) {
			this.typeParameters.splice(0, this.typeParameters.length, ...typeParameters);
		}
	}
}
