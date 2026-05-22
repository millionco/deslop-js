import type { InlineTypeContext } from "../types.js";
import { normalizeTypeAstHash } from "./normalize-type-hash.js";

const MIN_MEMBER_COUNT_FOR_INLINE_TYPE = 3;

interface NodeLike {
  type: string;
  start?: number;
  [key: string]: unknown;
}

export interface InlineTypeLiteralCapture {
  structuralHash: string;
  memberCount: number;
  preview: string;
  context: InlineTypeContext;
  nearestName?: string;
  startOffset: number;
}

const isNode = (value: unknown): value is NodeLike =>
  Boolean(value) && typeof value === "object" && typeof (value as NodeLike).type === "string";

const isTypeLiteralNode = (node: NodeLike): boolean => node.type === "TSTypeLiteral";

const getIdentifierName = (node: unknown): string | undefined => {
  if (!isNode(node)) return undefined;
  if (node.type === "Identifier") return node.name as string | undefined;
  return undefined;
};

const buildPreview = (typeLiteralNode: NodeLike): string => {
  const members = (typeLiteralNode.members as unknown[]) ?? [];
  const propertyKeys: string[] = [];
  for (const memberCandidate of members) {
    if (!isNode(memberCandidate)) continue;
    if (memberCandidate.type !== "TSPropertySignature") continue;
    const keyNode = memberCandidate.key as { name?: string; value?: string } | undefined;
    const keyName = keyNode?.name ?? keyNode?.value;
    if (keyName) propertyKeys.push(String(keyName));
  }
  propertyKeys.sort();
  const truncatedKeys = propertyKeys.slice(0, 4);
  const suffix = propertyKeys.length > 4 ? `, +${propertyKeys.length - 4} more` : "";
  return `{ ${truncatedKeys.join(", ")}${suffix} }`;
};

const countPropertySignatures = (typeLiteralNode: NodeLike): number => {
  const members = (typeLiteralNode.members as unknown[]) ?? [];
  let signatureCount = 0;
  for (const memberCandidate of members) {
    if (!isNode(memberCandidate)) continue;
    if (memberCandidate.type === "TSPropertySignature") signatureCount++;
  }
  return signatureCount;
};

const captureIfTypeLiteral = (
  candidateNode: unknown,
  captures: InlineTypeLiteralCapture[],
  context: InlineTypeContext,
  nearestName: string | undefined,
): void => {
  if (!isNode(candidateNode)) return;
  if (!isTypeLiteralNode(candidateNode)) return;
  const memberCount = countPropertySignatures(candidateNode);
  if (memberCount < MIN_MEMBER_COUNT_FOR_INLINE_TYPE) return;
  captures.push({
    structuralHash: `inline:${normalizeTypeAstHash(candidateNode)}`,
    memberCount,
    preview: buildPreview(candidateNode),
    context,
    nearestName,
    startOffset: candidateNode.start ?? 0,
  });
};

const inspectTypeAnnotation = (
  typeAnnotationNode: unknown,
  captures: InlineTypeLiteralCapture[],
  context: InlineTypeContext,
  nearestName: string | undefined,
): void => {
  if (!isNode(typeAnnotationNode)) return;
  if (typeAnnotationNode.type === "TSTypeAnnotation") {
    captureIfTypeLiteral(
      typeAnnotationNode.typeAnnotation,
      captures,
      context,
      nearestName,
    );
    return;
  }
  captureIfTypeLiteral(typeAnnotationNode, captures, context, nearestName);
};

const visitFunctionParameters = (
  parameters: unknown[] | undefined,
  captures: InlineTypeLiteralCapture[],
  functionName: string | undefined,
): void => {
  if (!parameters) return;
  for (const parameter of parameters) {
    if (!isNode(parameter)) continue;
    const parameterIdentifierName = getIdentifierName(parameter);
    inspectTypeAnnotation(
      parameter.typeAnnotation,
      captures,
      "function-parameter",
      functionName ? `${functionName}(${parameterIdentifierName ?? "?"})` : parameterIdentifierName,
    );
  }
};

const visitFunctionLike = (
  functionNode: NodeLike,
  captures: InlineTypeLiteralCapture[],
  functionName: string | undefined,
): void => {
  const parameters = functionNode.params as unknown[] | undefined;
  visitFunctionParameters(parameters, captures, functionName);
  const returnTypeNode = functionNode.returnType as unknown;
  if (returnTypeNode) {
    inspectTypeAnnotation(returnTypeNode, captures, "function-return", functionName);
  }
  const bodyNode = functionNode.body as unknown;
  if (bodyNode) {
    walkBodyForInlineTypes(bodyNode, captures, functionName);
  }
};

const visitVariableDeclaration = (
  declarationNode: NodeLike,
  captures: InlineTypeLiteralCapture[],
  enclosingName: string | undefined,
): void => {
  const declarators = (declarationNode.declarations as unknown[]) ?? [];
  for (const declarator of declarators) {
    if (!isNode(declarator)) continue;
    const declarationName = getIdentifierName(declarator.id);
    inspectTypeAnnotation(
      declarator.typeAnnotation ?? (declarator.id && isNode(declarator.id) ? declarator.id.typeAnnotation : undefined),
      captures,
      "variable-annotation",
      declarationName,
    );
    const initializerNode = declarator.init;
    if (isNode(initializerNode)) {
      if (
        initializerNode.type === "ArrowFunctionExpression" ||
        initializerNode.type === "FunctionExpression"
      ) {
        visitFunctionLike(initializerNode, captures, declarationName ?? enclosingName);
      } else {
        walkExpressionForInlineTypes(initializerNode, captures, declarationName ?? enclosingName);
      }
    }
  }
};

const walkBodyForInlineTypes = (
  bodyNode: unknown,
  captures: InlineTypeLiteralCapture[],
  enclosingName: string | undefined,
): void => {
  if (!isNode(bodyNode)) return;
  const statements = (bodyNode.body as unknown[]) ?? [];
  if (!Array.isArray(statements)) return;
  for (const statement of statements) {
    if (!isNode(statement)) continue;
    if (statement.type === "VariableDeclaration") {
      visitVariableDeclaration(statement, captures, enclosingName);
    } else if (statement.type === "FunctionDeclaration") {
      const functionName = getIdentifierName(statement.id);
      visitFunctionLike(statement, captures, functionName ?? enclosingName);
    } else if (statement.type === "TSTypeAliasDeclaration") {
      const typeAliasName = getIdentifierName(statement.id);
      captureIfTypeLiteral(
        statement.typeAnnotation,
        captures,
        "local-type-alias",
        typeAliasName,
      );
    } else if (statement.type === "ReturnStatement") {
      walkExpressionForInlineTypes(statement.argument, captures, enclosingName);
    } else if (statement.type === "BlockStatement") {
      walkBodyForInlineTypes(statement, captures, enclosingName);
    } else if (statement.type === "ExpressionStatement") {
      walkExpressionForInlineTypes(statement.expression, captures, enclosingName);
    }
  }
};

const walkExpressionForInlineTypes = (
  expressionNode: unknown,
  captures: InlineTypeLiteralCapture[],
  enclosingName: string | undefined,
): void => {
  if (!isNode(expressionNode)) return;
  if (
    expressionNode.type === "ArrowFunctionExpression" ||
    expressionNode.type === "FunctionExpression"
  ) {
    visitFunctionLike(expressionNode, captures, enclosingName);
    return;
  }
  for (const value of Object.values(expressionNode)) {
    if (Array.isArray(value)) {
      for (const element of value) walkExpressionForInlineTypes(element, captures, enclosingName);
    } else if (isNode(value)) {
      walkExpressionForInlineTypes(value, captures, enclosingName);
    }
  }
};

const visitTopLevelStatement = (
  statementNode: unknown,
  captures: InlineTypeLiteralCapture[],
): void => {
  if (!isNode(statementNode)) return;

  const innerNode =
    statementNode.type === "ExportNamedDeclaration" || statementNode.type === "ExportDefaultDeclaration"
      ? ((statementNode.declaration as unknown) ?? statementNode)
      : statementNode;
  const targetNode = isNode(innerNode) ? innerNode : statementNode;

  if (targetNode.type === "FunctionDeclaration") {
    const functionName = getIdentifierName(targetNode.id);
    visitFunctionLike(targetNode, captures, functionName);
    return;
  }

  if (targetNode.type === "VariableDeclaration") {
    visitVariableDeclaration(targetNode, captures, undefined);
    return;
  }

  if (targetNode.type === "ClassDeclaration") {
    const className = getIdentifierName(targetNode.id);
    const bodyContainer = targetNode.body as { body?: unknown[] } | undefined;
    const members = bodyContainer?.body ?? [];
    for (const memberCandidate of members) {
      if (!isNode(memberCandidate)) continue;
      const memberKeyName =
        getIdentifierName((memberCandidate as { key?: unknown }).key) ?? undefined;
      const qualifiedName = className && memberKeyName ? `${className}.${memberKeyName}` : memberKeyName;
      if (memberCandidate.type === "PropertyDefinition") {
        inspectTypeAnnotation(
          (memberCandidate as { typeAnnotation?: unknown }).typeAnnotation,
          captures,
          "class-property",
          qualifiedName,
        );
        continue;
      }
      if (
        memberCandidate.type === "MethodDefinition" ||
        memberCandidate.type === "TSAbstractMethodDefinition"
      ) {
        const methodValue = (memberCandidate as { value?: NodeLike }).value;
        if (isNode(methodValue)) {
          visitFunctionLike(methodValue, captures, qualifiedName);
        }
      }
    }
    return;
  }

  if (targetNode.type === "TSInterfaceDeclaration") {
    const interfaceName = getIdentifierName(targetNode.id);
    const interfaceBodyContainer = targetNode.body as { body?: unknown[] } | undefined;
    const interfaceMembers = interfaceBodyContainer?.body ?? [];
    for (const memberCandidate of interfaceMembers) {
      if (!isNode(memberCandidate)) continue;
      if (memberCandidate.type !== "TSPropertySignature") continue;
      const memberKeyName =
        getIdentifierName((memberCandidate as { key?: unknown }).key) ?? undefined;
      const qualifiedName =
        interfaceName && memberKeyName ? `${interfaceName}.${memberKeyName}` : memberKeyName;
      inspectTypeAnnotation(
        (memberCandidate as { typeAnnotation?: unknown }).typeAnnotation,
        captures,
        "interface-property",
        qualifiedName,
      );
    }
  }
};

export const collectInlineTypeLiterals = (
  programBody: unknown[],
): InlineTypeLiteralCapture[] => {
  const captures: InlineTypeLiteralCapture[] = [];
  for (const statement of programBody) {
    visitTopLevelStatement(statement, captures);
  }
  return captures;
};
