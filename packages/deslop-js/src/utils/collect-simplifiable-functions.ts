import type { SimplifiableFunctionKind } from "../types.js";
import { detectSimplifiableFunctionPatterns } from "./detect-simplifiable-function.js";

interface NodeLike {
  type: string;
  start?: number;
  [key: string]: unknown;
}

export interface SimplifiableFunctionCapture {
  kind: SimplifiableFunctionKind;
  functionName?: string;
  startOffset: number;
  reason: string;
  suggestion: string;
}

const isNode = (value: unknown): value is NodeLike =>
  Boolean(value) && typeof value === "object" && typeof (value as NodeLike).type === "string";

const getIdentifierName = (node: unknown): string | undefined => {
  if (!isNode(node)) return undefined;
  if (node.type === "Identifier") return node.name as string | undefined;
  return undefined;
};

const looksLikeFunction = (node: NodeLike): boolean =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression";

const inferFunctionName = (functionNode: NodeLike, parentContext: string | undefined): string | undefined => {
  const declaredId = (functionNode as { id?: { name?: string } }).id;
  if (declaredId?.name) return declaredId.name;
  return parentContext;
};

const visitFunctionAndDescend = (
  functionNode: NodeLike,
  captures: SimplifiableFunctionCapture[],
  contextName: string | undefined,
): void => {
  const functionName = inferFunctionName(functionNode, contextName);
  const detections = detectSimplifiableFunctionPatterns(functionNode);
  for (const detection of detections) {
    captures.push({
      kind: detection.kind,
      functionName,
      startOffset: detection.startOffset,
      reason: detection.reason,
      suggestion: detection.suggestion,
    });
  }
  const bodyNode = (functionNode as { body?: NodeLike }).body;
  if (isNode(bodyNode)) walkForFunctions(bodyNode, captures, functionName);
  const parameters = (functionNode as { params?: unknown[] }).params ?? [];
  for (const parameter of parameters) {
    if (isNode(parameter)) walkForFunctions(parameter, captures, functionName);
  }
};

const walkForFunctions = (
  node: NodeLike,
  captures: SimplifiableFunctionCapture[],
  contextName: string | undefined,
): void => {
  if (looksLikeFunction(node)) {
    visitFunctionAndDescend(node, captures, contextName);
    return;
  }

  let nextContext = contextName;
  if (node.type === "VariableDeclarator") {
    const declaredName = getIdentifierName((node as { id?: unknown }).id);
    if (declaredName) nextContext = declaredName;
  }
  if (node.type === "MethodDefinition" || node.type === "PropertyDefinition") {
    const propertyKeyName = getIdentifierName((node as { key?: unknown }).key);
    if (propertyKeyName) nextContext = propertyKeyName;
  }
  if (node.type === "ClassDeclaration") {
    const className = getIdentifierName((node as { id?: unknown }).id);
    if (className) nextContext = className;
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const element of value) {
        if (isNode(element)) walkForFunctions(element, captures, nextContext);
      }
    } else if (isNode(value)) {
      walkForFunctions(value, captures, nextContext);
    }
  }
};

export const collectSimplifiableFunctions = (
  programBody: unknown[],
): SimplifiableFunctionCapture[] => {
  const captures: SimplifiableFunctionCapture[] = [];
  for (const statement of programBody) {
    if (isNode(statement)) walkForFunctions(statement, captures, undefined);
  }
  return captures;
};
