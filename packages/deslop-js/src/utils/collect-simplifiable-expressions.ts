import type { SimplifiableExpressionKind } from "../types.js";

interface NodeLike {
  type: string;
  start?: number;
  [key: string]: unknown;
}

export interface SimplifiableExpressionCapture {
  kind: SimplifiableExpressionKind;
  snippet: string;
  startOffset: number;
  reason: string;
  suggestion: string;
}

const isNode = (value: unknown): value is NodeLike =>
  Boolean(value) && typeof value === "object" && typeof (value as NodeLike).type === "string";

const memberAccessText = (node: NodeLike, depth = 0): string | undefined => {
  if (depth > 6) return undefined;
  if (node.type === "Identifier") return (node as { name?: string }).name;
  if (node.type === "ThisExpression") return "this";
  if (node.type === "MemberExpression") {
    const computed = (node as { computed?: boolean }).computed;
    if (computed) return undefined;
    const objectNode = (node as { object?: NodeLike }).object;
    const propertyNode = (node as { property?: NodeLike }).property;
    if (!objectNode || !propertyNode) return undefined;
    const objectText = memberAccessText(objectNode, depth + 1);
    const propertyText = propertyNode.type === "Identifier"
      ? (propertyNode as { name?: string }).name
      : undefined;
    if (!objectText || !propertyText) return undefined;
    return `${objectText}.${propertyText}`;
  }
  return undefined;
};

const isBooleanLiteral = (node: NodeLike, expected: boolean): boolean => {
  if (node.type !== "Literal") return false;
  return (node as { value?: unknown }).value === expected;
};

const detectSelfFallbackTernary = (
  conditionalNode: NodeLike,
): SimplifiableExpressionCapture | undefined => {
  if (conditionalNode.type !== "ConditionalExpression") return undefined;
  const testNode = (conditionalNode as { test?: NodeLike }).test;
  const consequentNode = (conditionalNode as { consequent?: NodeLike }).consequent;
  if (!testNode || !consequentNode) return undefined;
  const testText = memberAccessText(testNode);
  const consequentText = memberAccessText(consequentNode);
  if (!testText || !consequentText) return undefined;
  if (testText !== consequentText) return undefined;
  return {
    kind: "self-fallback-ternary",
    snippet: `${testText} ? ${consequentText} : ...`,
    startOffset: conditionalNode.start ?? 0,
    reason: `\`${testText} ? ${testText} : x\` is a self-fallback ternary`,
    suggestion: `use \`${testText} ?? x\` (nullish-only) or \`${testText} || x\` (falsy fallback) depending on intent`,
  };
};

const detectTernaryReturnsBoolean = (
  conditionalNode: NodeLike,
): SimplifiableExpressionCapture | undefined => {
  if (conditionalNode.type !== "ConditionalExpression") return undefined;
  const consequentNode = (conditionalNode as { consequent?: NodeLike }).consequent;
  const alternateNode = (conditionalNode as { alternate?: NodeLike }).alternate;
  if (!consequentNode || !alternateNode) return undefined;
  const isTrueFalse =
    isBooleanLiteral(consequentNode, true) && isBooleanLiteral(alternateNode, false);
  const isFalseTrue =
    isBooleanLiteral(consequentNode, false) && isBooleanLiteral(alternateNode, true);
  if (!isTrueFalse && !isFalseTrue) return undefined;
  return {
    kind: "ternary-returns-boolean",
    snippet: isTrueFalse ? "cond ? true : false" : "cond ? false : true",
    startOffset: conditionalNode.start ?? 0,
    reason: isTrueFalse
      ? "`cond ? true : false` collapses to `Boolean(cond)`"
      : "`cond ? false : true` collapses to `!cond`",
    suggestion: isTrueFalse ? "replace with `Boolean(cond)` or just `cond` when types match" : "replace with `!cond`",
  };
};

const detectDoubleBangBoolean = (
  unaryNode: NodeLike,
): SimplifiableExpressionCapture | undefined => {
  if (unaryNode.type !== "UnaryExpression") return undefined;
  if ((unaryNode as { operator?: string }).operator !== "!") return undefined;
  const inner = (unaryNode as { argument?: NodeLike }).argument;
  if (!inner || inner.type !== "UnaryExpression") return undefined;
  if ((inner as { operator?: string }).operator !== "!") return undefined;
  const coerced = (inner as { argument?: NodeLike }).argument;
  if (!coerced) return undefined;
  const coercedText = memberAccessText(coerced) ?? "expr";
  return {
    kind: "double-bang-boolean",
    snippet: `!!${coercedText}`,
    startOffset: unaryNode.start ?? 0,
    reason: "`!!x` is a double-negation boolean coercion",
    suggestion: `replace with \`Boolean(${coercedText})\``,
  };
};

const visit = (node: NodeLike, captures: SimplifiableExpressionCapture[], depth: number): void => {
  if (depth > 100) return;

  const conditionalCapture =
    detectSelfFallbackTernary(node) ?? detectTernaryReturnsBoolean(node);
  if (conditionalCapture) captures.push(conditionalCapture);

  const doubleBangCapture = detectDoubleBangBoolean(node);
  if (doubleBangCapture) captures.push(doubleBangCapture);

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const element of value) {
        if (isNode(element)) visit(element, captures, depth + 1);
      }
    } else if (isNode(value)) {
      visit(value, captures, depth + 1);
    }
  }
};

export const collectSimplifiableExpressions = (
  programBody: unknown[],
): SimplifiableExpressionCapture[] => {
  const captures: SimplifiableExpressionCapture[] = [];
  for (const statement of programBody) {
    if (isNode(statement)) visit(statement, captures, 0);
  }
  return captures;
};
