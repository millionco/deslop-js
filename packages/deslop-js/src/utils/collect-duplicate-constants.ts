interface NodeLike {
  type: string;
  start?: number;
  [key: string]: unknown;
}

export interface DuplicateConstantCandidate {
  constantName: string;
  literalHash: string;
  literalPreview: string;
  startOffset: number;
}

const MIN_STRING_LITERAL_LENGTH = 8;
const MIN_NUMBER_LITERAL_VALUE = 1000;

const isNode = (value: unknown): value is NodeLike =>
  Boolean(value) && typeof value === "object" && typeof (value as NodeLike).type === "string";

const isLiteralCandidate = (node: NodeLike): boolean => {
  if (node.type === "Literal") {
    const value = (node as { value?: unknown }).value;
    if (typeof value === "string") {
      if (value.length < MIN_STRING_LITERAL_LENGTH) return false;
      return true;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return false;
      if (Math.abs(value) < MIN_NUMBER_LITERAL_VALUE) return false;
      return true;
    }
    return false;
  }
  if (node.type === "TemplateLiteral") {
    const expressions = (node as { expressions?: unknown[] }).expressions;
    if (Array.isArray(expressions) && expressions.length > 0) return false;
    const quasis = (node as { quasis?: Array<{ value?: { cooked?: string } }> }).quasis;
    if (!Array.isArray(quasis) || quasis.length === 0) return false;
    const cooked = quasis[0].value?.cooked ?? "";
    return cooked.length >= MIN_STRING_LITERAL_LENGTH;
  }
  if (node.type === "ArrayExpression") {
    const elements = (node as { elements?: unknown[] }).elements ?? [];
    if (elements.length === 0) return false;
    for (const element of elements) {
      if (!isNode(element)) return false;
      if (element.type !== "Literal") return false;
    }
    return true;
  }
  return false;
};

const hashLiteralNode = (node: NodeLike): string => {
  if (node.type === "Literal") {
    return `lit:${typeof (node as { value?: unknown }).value}:${JSON.stringify((node as { value?: unknown }).value)}`;
  }
  if (node.type === "TemplateLiteral") {
    const quasis = (node as { quasis?: Array<{ value?: { cooked?: string } }> }).quasis ?? [];
    return `tpl:${JSON.stringify(quasis[0]?.value?.cooked ?? "")}`;
  }
  if (node.type === "ArrayExpression") {
    const elements = (node as { elements?: unknown[] }).elements ?? [];
    const values = elements.map((element) => {
      if (!isNode(element)) return "?";
      if (element.type !== "Literal") return "?";
      return JSON.stringify((element as { value?: unknown }).value);
    });
    return `arr:[${values.join(",")}]`;
  }
  return "?";
};

const previewLiteralNode = (node: NodeLike): string => {
  if (node.type === "Literal") {
    const value = (node as { value?: unknown }).value;
    if (typeof value === "string") return `"${value.length > 60 ? value.slice(0, 57) + "..." : value}"`;
    return String(value);
  }
  if (node.type === "TemplateLiteral") {
    const quasis = (node as { quasis?: Array<{ value?: { cooked?: string } }> }).quasis ?? [];
    const cooked = quasis[0]?.value?.cooked ?? "";
    return `\`${cooked.length > 60 ? cooked.slice(0, 57) + "..." : cooked}\``;
  }
  if (node.type === "ArrayExpression") {
    const elements = (node as { elements?: unknown[] }).elements ?? [];
    const head = elements
      .slice(0, 3)
      .map((element) =>
        isNode(element) && element.type === "Literal"
          ? JSON.stringify((element as { value?: unknown }).value)
          : "?",
      )
      .join(", ");
    const suffix = elements.length > 3 ? `, +${elements.length - 3} more` : "";
    return `[${head}${suffix}]`;
  }
  return "<literal>";
};

const visitForConstants = (
  statementNode: unknown,
  candidates: DuplicateConstantCandidate[],
): void => {
  if (!isNode(statementNode)) return;
  const inner =
    (statementNode.type === "ExportNamedDeclaration" ||
      statementNode.type === "ExportDefaultDeclaration") &&
    (statementNode as { declaration?: unknown }).declaration
      ? (statementNode as { declaration?: unknown }).declaration
      : statementNode;
  if (!isNode(inner)) return;
  if (inner.type !== "VariableDeclaration") return;
  if ((inner as { kind?: string }).kind !== "const") return;
  const declarators = (inner as { declarations?: unknown[] }).declarations ?? [];
  for (const declarator of declarators) {
    if (!isNode(declarator)) continue;
    const idNode = (declarator as { id?: NodeLike }).id;
    const initializerNode = (declarator as { init?: NodeLike }).init;
    if (!idNode || !initializerNode) continue;
    if (idNode.type !== "Identifier") continue;
    const constantName = (idNode as { name?: string }).name;
    if (!constantName) continue;
    if (!isLiteralCandidate(initializerNode)) continue;
    candidates.push({
      constantName,
      literalHash: hashLiteralNode(initializerNode),
      literalPreview: previewLiteralNode(initializerNode),
      startOffset: declarator.start ?? inner.start ?? 0,
    });
  }
};

export const collectDuplicateConstantCandidates = (
  programBody: unknown[],
): DuplicateConstantCandidate[] => {
  const candidates: DuplicateConstantCandidate[] = [];
  for (const statement of programBody) {
    visitForConstants(statement, candidates);
  }
  return candidates;
};
