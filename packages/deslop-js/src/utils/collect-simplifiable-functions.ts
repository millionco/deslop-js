import type { SimplifiableFunctionKind } from "../types.js";
import { MAX_AST_WALK_DEPTH } from "../constants.js";
import { detectSimplifiableFunctionPatterns } from "./detect-simplifiable-function.js";
import { getIdentifierName, isOxcAstNode, type OxcAstNode } from "./oxc-ast-node.js";

export interface SimplifiableFunctionCapture {
  kind: SimplifiableFunctionKind;
  functionName?: string;
  startOffset: number;
  reason: string;
  suggestion: string;
}

const looksLikeFunction = (node: OxcAstNode): boolean =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression";

const inferFunctionName = (
  functionNode: OxcAstNode,
  parentContext: string | undefined,
): string | undefined => {
  const declaredId = (functionNode as { id?: { name?: string } }).id;
  if (declaredId?.name) return declaredId.name;
  return parentContext;
};

const visitFunctionAndDescend = (
  functionNode: OxcAstNode,
  captures: SimplifiableFunctionCapture[],
  contextName: string | undefined,
  recursionDepth: number,
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
  const bodyNode = (functionNode as { body?: OxcAstNode }).body;
  if (isOxcAstNode(bodyNode))
    walkForFunctions(bodyNode, captures, functionName, recursionDepth + 1);
  const parameters = (functionNode as { params?: unknown[] }).params ?? [];
  for (const parameter of parameters) {
    if (isOxcAstNode(parameter))
      walkForFunctions(parameter, captures, functionName, recursionDepth + 1);
  }
};

const walkForFunctions = (
  node: OxcAstNode,
  captures: SimplifiableFunctionCapture[],
  contextName: string | undefined,
  recursionDepth: number = 0,
): void => {
  if (recursionDepth > MAX_AST_WALK_DEPTH) return;
  if (looksLikeFunction(node)) {
    visitFunctionAndDescend(node, captures, contextName, recursionDepth);
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
        if (isOxcAstNode(element))
          walkForFunctions(element, captures, nextContext, recursionDepth + 1);
      }
    } else if (isOxcAstNode(value)) {
      walkForFunctions(value, captures, nextContext, recursionDepth + 1);
    }
  }
};

export const collectSimplifiableFunctions = (
  programBody: unknown[],
): SimplifiableFunctionCapture[] => {
  const captures: SimplifiableFunctionCapture[] = [];
  for (const statement of programBody) {
    if (isOxcAstNode(statement)) walkForFunctions(statement, captures, undefined, 0);
  }
  return captures;
};
