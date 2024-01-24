import { Parser } from "./parser.js";
import { Type } from "./type/type.js";
import { NamedType } from "./type/namedType.js";
import * as ts from "typescript";

export function asTypeReference(type: ts.Type): ts.TypeReference | undefined {
	if (type.flags & ts.TypeFlags.Object) {
		const objectType = type as ts.ObjectType;

		if (objectType.objectFlags & ts.ObjectFlags.Reference) {
			return objectType as ts.TypeReference;
		}
	}
}

export function *getUsedTypes(parser: Parser, type: ts.Type): IterableIterator<ts.Type> {
	const callSignatures = type.getCallSignatures();
	const typeReference = asTypeReference(type);
	const typeChecker = parser.getTypeChecker();

	if (type.isClassOrInterface()) {
		yield *type.typeParameters ?? [];
	} else if (callSignatures.length > 0) {
		for (const signature of callSignatures) {
			const declaration = signature.getDeclaration();
			yield typeChecker.getTypeFromTypeNode(declaration.type!);

			for (const parameter of declaration.parameters) {
				yield typeChecker.getTypeFromTypeNode(parameter.type!);
			}
		}
	} else if (type.isUnion() || type.isIntersection()) {
		yield *type.types;
	} else if (typeReference) {
		yield typeReference.target;
		yield *typeChecker.getTypeArguments(typeReference);
	}
}

export function usesType(parser: Parser, type: ts.Type, other: ts.Type): boolean {
	const queue = [type];
	const visited = new Set(queue);

	for (let type = queue.pop(); type; type = queue.pop()) {
		if (type === other) {
			return true;
		}

		for (const inner of getUsedTypes(parser, type)) {
			if (!visited.has(inner)) {
				visited.add(inner);
				queue.push(inner);
			}
		}
	}

	return false;
}

export class Generics {
	private id: number;
	private types?: Map<ts.Type, Type>;

	public constructor(id?: number, types?: ReadonlyMap<ts.Type, Type>) {
		this.id = id ?? 0;
		this.types = types && new Map(types);
	}

	public clone(types?: ReadonlyMap<ts.Type, Type>): Generics {
		return new Generics(this.id, types ?? this.types);
	}

	public getTypes(): ReadonlyMap<ts.Type, Type> {
		return this.types ?? new Map;
	}

	public getType(type: ts.Type): Type | undefined {
		return this.types?.get(type);
	}

	public addType(type: ts.Type, override: Type): void {
		this.types ??= new Map;
		this.types.set(type, override);
	}

	public getOrInsert(type: ts.Type): NamedType {
		let override = this.getType(type);

		if (!override) {
			override = NamedType.create(`_T${this.id++}`);
			this.addType(type, override);
		}

		return override as NamedType;
	}
}
