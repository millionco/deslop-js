import type { SourceToken } from "./token-types.js";

const NODES_DROPPED_FROM_TOKEN_STREAM = new Set<string>([
  "ImportDeclaration",
  "ExportAllDeclaration",
  "TSTypeAnnotation",
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSTypeParameterDeclaration",
  "TSTypeParameterInstantiation",
  "TSTypeReference",
  "TSAnyKeyword",
  "TSUnknownKeyword",
  "TSStringKeyword",
  "TSNumberKeyword",
  "TSBooleanKeyword",
  "TSVoidKeyword",
  "TSUndefinedKeyword",
  "TSNullKeyword",
  "TSNeverKeyword",
  "TSUnionType",
  "TSIntersectionType",
  "TSLiteralType",
  "TSArrayType",
  "TSTupleType",
  "TSTypeLiteral",
  "TSPropertySignature",
  "TSMethodSignature",
  "TSCallSignatureDeclaration",
  "TSConstructSignatureDeclaration",
  "TSIndexSignature",
  "TSConditionalType",
  "TSMappedType",
  "TSInferType",
  "TSImportType",
  "TSQualifiedName",
  "TSTypeOperator",
  "TSTypePredicate",
  "TSFunctionType",
  "TSConstructorType",
]);

const isAstNode = (candidate: unknown): candidate is { type: string } => {
  return typeof candidate === "object" && candidate !== null && "type" in candidate;
};

const visitChildrenRaw = (node: unknown, visit: (child: unknown) => void): void => {
  if (!isAstNode(node)) return;
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") {
      continue;
    }
    const value = (node as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (value !== null && typeof value === "object") {
      visit(value);
    }
  }
};

const safeNumberOrZero = (candidate: unknown): number => (typeof candidate === "number" ? candidate : 0);

/**
 * Walk an oxc AST and emit a flat token stream suitable for suffix-array-based
 * clone detection. Two structurally-identical regions of code produce the same
 * token sequence (modulo identifier/literal-value normalization, applied later
 * in `normalize.ts`).
 *
 * Implementation note: instead of porting fallow's hand-written keyword/operator
 * lexer-style visitor (~750 LOC of Rust), we walk the AST generically and emit
 * one `node-enter` token per visited node. This trades a slightly different
 * token-density profile for ~10x less code. AST-shape tokens still distinguish
 * `function add(a, b) { return a + b }` from `const add = (a, b) => a + b`,
 * which fallow's keyword-based stream would also distinguish. Identifiers and
 * value literals get dedicated tokens so semantic-mode normalization can blind
 * them.
 *
 * Imports and type-only constructs are dropped to keep import-block boilerplate
 * and ambient type declarations from inflating the noise floor (matches
 * fallow's `skip_imports` + `strip_types` defaults).
 */
export const tokenizeAst = (program: unknown): SourceToken[] => {
  const tokens: SourceToken[] = [];

  const visit = (node: unknown): void => {
    if (!isAstNode(node)) return;
    const nodeType = node.type;
    if (NODES_DROPPED_FROM_TOKEN_STREAM.has(nodeType)) return;

    const start = safeNumberOrZero((node as Record<string, unknown>).start);
    const end = safeNumberOrZero((node as Record<string, unknown>).end);

    if (nodeType === "Identifier" || nodeType === "PrivateIdentifier") {
      const identifierName = (node as Record<string, unknown>).name;
      tokens.push({
        kind: "identifier",
        payload: typeof identifierName === "string" ? identifierName : "",
        start,
        end,
      });
      return;
    }

    if (nodeType === "Literal") {
      const literalValue = (node as Record<string, unknown>).value;
      if (typeof literalValue === "string") {
        tokens.push({ kind: "string-literal", payload: literalValue, start, end });
      } else if (typeof literalValue === "number") {
        tokens.push({ kind: "numeric-literal", payload: String(literalValue), start, end });
      } else if (typeof literalValue === "boolean") {
        tokens.push({ kind: "boolean-literal", payload: literalValue ? "true" : "false", start, end });
      } else if (literalValue === null) {
        tokens.push({ kind: "null-literal", payload: "null", start, end });
      } else if ((node as Record<string, unknown>).regex) {
        tokens.push({ kind: "regexp-literal", payload: "regex", start, end });
      } else {
        tokens.push({ kind: "node-enter", payload: nodeType, start, end });
      }
      return;
    }

    if (nodeType === "TemplateLiteral") {
      tokens.push({ kind: "template-literal", payload: "tpl", start, end });
      visitChildrenRaw(node, visit);
      return;
    }

    tokens.push({ kind: "node-enter", payload: nodeType, start, end });
    visitChildrenRaw(node, visit);
  };

  visit(program);
  return tokens;
};
