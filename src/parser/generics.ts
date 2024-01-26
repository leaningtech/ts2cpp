import { Parser } from "./parser.js";
import { Type } from "../type/type.js";
import { NamedType } from "../type/namedType.js";
import { Expression } from "../type/expression.js";
import { options } from "../utility.js";
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

	if (type.isClassOrInterface()) {
		yield *type.typeParameters ?? [];
	} else if (callSignatures.length > 0) {
		for (const signature of callSignatures) {
			const declaration = signature.getDeclaration();
			yield parser.getTypeFromTypeNode(declaration.type!);

			for (const parameter of declaration.parameters) {
				yield parser.getTypeFromTypeNode(parameter.type!);
			}
		}
	} else if (type.isUnion() || type.isIntersection()) {
		yield *type.types;
	} else if (typeReference) {
		yield typeReference.target;
		yield *parser.getTypeArguments(typeReference);
	}
}

export function usesType(parser: Parser, types: ReadonlySet<ts.Type>, other: ts.Type): boolean {
	const queue = [...types];
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

function isFunctionLike(node: ts.Node): boolean {
	return ts.isMethodDeclaration(node) || ts.isConstructSignatureDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isIndexSignatureDeclaration(node) || ts.isMethodSignature(node) || ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node);
}

function isTypeAliasLike(node: ts.Node): boolean {
	return ts.isTypeAliasDeclaration(node);
}

function isClassLike(node: ts.Node): boolean {
	return ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node);
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

	public createParameters(parser: Parser, declarations: ReadonlyArray<any>): [Array<NamedType>, Set<Expression>] {
		const types = new Array<NamedType>;
		const constraints = new Set<Expression>;
		const returnTypes = new Set<ts.Type>;

		for (const declaration of declarations) {
			if (isFunctionLike(declaration) && declaration.type) {
				returnTypes.add(parser.getTypeFromTypeNode(declaration.type));
			} else if (isTypeAliasLike(declaration)) {
				returnTypes.add(parser.getTypeFromTypeNode(declaration.type));
			}
		}

		for (const declaration of declarations) {
			const typeParameters = ts.getEffectiveTypeParameterDeclarations(declaration);

			for (const [i, typeParameter] of typeParameters.entries()) {
				const type = parser.getTypeAtLocation(typeParameter);
				const constraint = ts.getEffectiveConstraintOfTypeParameter(typeParameter);
				const info = constraint && parser.getTypeNodeInfo(constraint, this);

				if (isClassLike(declaration) || usesType(parser, returnTypes, type)) {
					types[i] ??= NamedType.create(`_T${this.id++}`);
					this.addType(type, types[i]);

					if (info && options.useConstraints) {
						constraints.add(info.asTypeConstraint(types[i]));
					}
				} else if (info) {
					this.addType(type, info.asTypeParameter());
				}
			}
		}

		return [types.filter(type => type), constraints];
	}

	public createConstraints(parser: Parser, declarations: ReadonlyArray<any>): void {
		for (const declaration of declarations) {
			const typeParameters = ts.getEffectiveTypeParameterDeclarations(declaration);

			for (const typeParameter of typeParameters) {
				const type = parser.getTypeAtLocation(typeParameter);
				const constraint = ts.getEffectiveConstraintOfTypeParameter(typeParameter);
				const info = constraint && parser.getTypeNodeInfo(constraint, this);

				if (info && !this.getType(type)) {
					this.addType(type, info.asTypeParameter());
				}
			}
		}
	}
}
