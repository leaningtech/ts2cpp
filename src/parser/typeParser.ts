import { Parser } from "./parser.js";
import { Type } from "../type/type.js";
import { TypeInfo, TypeKind } from "./typeInfo.js";
import { QualifiedType } from "../type/qualifiedType.js";
import { TemplateType } from "../type/templateType.js";
import { NULLPTR_TYPE, FUNCTION_TYPE, ANY_TYPE, VOID_TYPE, DOUBLE_TYPE, BOOL_TYPE } from "../type/namedType.js";
import { FunctionType } from "../type/functionType.js";
import { asTypeReference } from "./generics.js";
import * as ts from "typescript";

export class TypeParser {
	private readonly parser: Parser;
	private readonly overrides: ReadonlyMap<ts.Type, Type>;
	private readonly visited: Map<ts.Type, Type> = new Map;

	public constructor(parser: Parser, overrides: ReadonlyMap<ts.Type, Type>) {
		this.parser = parser;
		this.overrides = overrides;
	}

	private addInfo(info: TypeInfo, type: ts.Type): void {
		const visitedType = this.visited.get(type);
		const overrideType = this.overrides.get(type);
		const basicClass = this.parser.getBasicDeclaredClass(type);
		const genericClass = this.parser.getGenericDeclaredClass(type);
		const callSignatures = type.getCallSignatures();
		const typeReference = asTypeReference(type);

		if (visitedType) {
			info.addType(visitedType, TypeKind.Class);
		} else if (overrideType && overrideType instanceof QualifiedType) {
			info.addType(overrideType.getInner(), TypeKind.Class);
		} else if (overrideType) {
			info.addType(overrideType, TypeKind.Generic);
		} else if (type.flags & ts.TypeFlags.Undefined) {
			info.setOptional();
		} else if (type.flags & ts.TypeFlags.Any) {
			info.addType(ANY_TYPE, TypeKind.Class);
			info.setOptional();
		} else if (type.flags & ts.TypeFlags.VoidLike) {
			info.addType(VOID_TYPE, TypeKind.Primitive);
		} else if (type.flags & ts.TypeFlags.NumberLike) {
			info.addType(DOUBLE_TYPE, TypeKind.Primitive);
		} else if (type.flags & ts.TypeFlags.BooleanLike) {
			info.addType(BOOL_TYPE, TypeKind.Primitive);
		} else if (type.flags & ts.TypeFlags.StringLike) {
			info.addType(this.parser.getRootType("String"), TypeKind.Class);
		} else if (type.flags & ts.TypeFlags.BigIntLike) {
			info.addType(this.parser.getRootType("BigInt"), TypeKind.Class);
		} else if (type.flags & ts.TypeFlags.ESSymbolLike) {
			info.addType(this.parser.getRootType("Symbol"), TypeKind.Class);
		} else if (genericClass && type.isClassOrInterface()) {
			const templateType = TemplateType.createUnsafe(genericClass);
			this.visited.set(type, templateType);

			(type.typeParameters ?? [])
				.map(typeParameter => this.getInfo(typeParameter).asTypeParameter())
				.forEach(type => templateType.addTypeParameterUnsafe(type));

			info.addType(templateType.internUnsafe(), TypeKind.Class);
		} else if (basicClass && type.isClassOrInterface()) {
			info.addType(basicClass, TypeKind.Class);
		} else if (callSignatures.length > 0) {
			info.addType(this.parser.getRootType("EventListener"), TypeKind.Function);
			info.addType(NULLPTR_TYPE, TypeKind.Function);

			for (const signature of callSignatures) {
				const declaration = signature.getDeclaration();
				const returnInfo = this.getNodeInfo(declaration.type);

				for (const returnType of returnInfo.asParameterTypes()) {
					for (let i = 0; i <= declaration.parameters.length; i++) {
						const parameterTypes = declaration.parameters.slice(0, i)
							.map(parameter => this.getNodeInfo(parameter.type))
							.map(info => info.asReturnType(this.parser));

						const functionType = TemplateType.create(
							FUNCTION_TYPE,
							FunctionType.create(returnType, ...parameterTypes)
						);

						if (i === declaration.parameters.length) {
							info.addType(functionType, TypeKind.Class);
						} else {
							info.addType(functionType, TypeKind.Function);
						}
					}
				}
			}
		} else if (type.isIntersection()) {
			this.addInfo(info, type.types[0]);
		} else if (type.isUnion()) {
			type.types.forEach(inner => this.addInfo(info, inner));
		} else if (typeReference) {
			const genericTarget = this.parser.getGenericDeclaredClass(typeReference.target);

			if (!genericTarget) {
				const basicTarget = this.parser.getBasicDeclaredClass(typeReference.target);
				info.addType(basicTarget ?? this.parser.getRootType("Object"), TypeKind.Class);
				return;
			}

			const templateType = TemplateType.createUnsafe(genericTarget);
			this.visited.set(type, templateType);

			this.parser.getTypeArguments(typeReference)
				.filter(typeArgument => !(typeArgument as any).isThisType)
				.map(typeArgument => this.getInfo(typeArgument).asTypeParameter())
				.forEach(type => templateType.addTypeParameterUnsafe(type));

			info.addType(templateType.internUnsafe(), TypeKind.Class);
		} else if (type.isTypeParameter()) {
			info.addType(ANY_TYPE, TypeKind.Class);
			info.addType(DOUBLE_TYPE, TypeKind.Primitive);
			info.setOptional();
		} else {
			info.addType(this.parser.getRootType("Object"), TypeKind.Class);
		}
	}

	public getInfo(type: ts.Type): TypeInfo {
		const info = new TypeInfo;
		this.addInfo(info, type);
		return info;
	}

	public getNodeInfo(node?: ts.TypeNode): TypeInfo {
		if (node) {
			const type = this.parser.getTypeFromTypeNode(node);
			return this.getInfo(ts.isThisTypeNode(node) ? type.getConstraint()! : type);
		} else {
			const info = new TypeInfo;
			info.addType(ANY_TYPE, TypeKind.Class);
			info.setOptional();
			return info;
		}
	}

	public getSymbol(type: ts.Type): [ts.Symbol | undefined, Map<ts.Type, Type>] {
		const typeReference = asTypeReference(type);

		if (typeReference) {
			const result = new Map(
				this.parser.getTypeArguments(typeReference)
					.map(typeArgument => this.getInfo(typeArgument).asTypeParameter())
					.map((type, i) => [typeReference.target.typeParameters![i], type])
			);

			return [typeReference.target.getSymbol(), result];
		} else {
			return [type.getSymbol(), new Map];
		}
	}
}
