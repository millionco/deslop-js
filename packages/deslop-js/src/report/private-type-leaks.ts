import { readFileSync } from "node:fs";
import { parseSync } from "oxc-parser";
import type { DependencyGraph, PrivateTypeLeak } from "../types.js";

const isAstNode = (candidate: unknown): candidate is { type: string } =>
  typeof candidate === "object" && candidate !== null && "type" in candidate;

const computeLineStarts = (sourceText: string): number[] => {
  const lineStarts: number[] = [0];
  for (let charIndex = 0; charIndex < sourceText.length; charIndex++) {
    if (sourceText.charCodeAt(charIndex) === 10) lineStarts.push(charIndex + 1);
  }
  return lineStarts;
};

const offsetToLineColumn = (
  byteOffset: number,
  lineStarts: number[],
): { line: number; column: number } => {
  let lowIndex = 0;
  let highIndex = lineStarts.length - 1;
  while (lowIndex < highIndex) {
    const middleIndex = (lowIndex + highIndex + 1) >>> 1;
    if (lineStarts[middleIndex] <= byteOffset) lowIndex = middleIndex;
    else highIndex = middleIndex - 1;
  }
  return { line: lowIndex + 1, column: byteOffset - lineStarts[lowIndex] };
};

const extractIdentifierName = (node: unknown): string | undefined => {
  if (!isAstNode(node)) return undefined;
  if (node.type === "Identifier") {
    const identifierName = (node as Record<string, unknown>).name;
    return typeof identifierName === "string" ? identifierName : undefined;
  }
  return undefined;
};

const collectTypeReferenceNamesFromTypeNode = (typeNode: unknown, into: Set<string>): void => {
  if (!isAstNode(typeNode)) return;

  if (typeNode.type === "TSTypeReference") {
    const referencedTypeName = (typeNode as Record<string, unknown>).typeName;
    if (isAstNode(referencedTypeName) && referencedTypeName.type === "Identifier") {
      const name = (referencedTypeName as Record<string, unknown>).name;
      if (typeof name === "string") into.add(name);
    }
  }

  for (const key of Object.keys(typeNode as Record<string, unknown>)) {
    if (key === "type" || key === "start" || key === "end") continue;
    const value = (typeNode as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) collectTypeReferenceNamesFromTypeNode(item, into);
    } else if (value !== null && typeof value === "object") {
      collectTypeReferenceNamesFromTypeNode(value, into);
    }
  }
};

interface PublicSignatureReference {
  exportName: string;
  typeName: string;
  byteOffset: number;
}

const isExportedDeclaration = (statement: unknown): boolean => {
  if (!isAstNode(statement)) return false;
  return statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration";
};

const declarationOf = (statement: unknown): unknown => {
  if (!isAstNode(statement)) return undefined;
  return (statement as Record<string, unknown>).declaration;
};

const exportedNameOfDeclaration = (declarationNode: unknown): string | undefined => {
  if (!isAstNode(declarationNode)) return undefined;
  if (declarationNode.type === "FunctionDeclaration" || declarationNode.type === "ClassDeclaration") {
    return extractIdentifierName((declarationNode as Record<string, unknown>).id);
  }
  if (declarationNode.type === "VariableDeclaration") {
    const declarators = (declarationNode as Record<string, unknown>).declarations;
    if (Array.isArray(declarators) && declarators.length > 0) {
      const firstDeclarator = declarators[0];
      if (isAstNode(firstDeclarator)) {
        return extractIdentifierName((firstDeclarator as Record<string, unknown>).id);
      }
    }
  }
  if (declarationNode.type === "TSInterfaceDeclaration" || declarationNode.type === "TSTypeAliasDeclaration") {
    return extractIdentifierName((declarationNode as Record<string, unknown>).id);
  }
  return undefined;
};

const collectFromFunctionLikeSignature = (
  functionLikeNode: unknown,
  exportName: string,
  collected: PublicSignatureReference[],
): void => {
  if (!isAstNode(functionLikeNode)) return;
  const params = (functionLikeNode as Record<string, unknown>).params;
  if (Array.isArray(params)) {
    for (const param of params) collectFromParameter(param, exportName, collected);
  }
  const returnTypeAnnotation = (functionLikeNode as Record<string, unknown>).returnType;
  if (isAstNode(returnTypeAnnotation)) {
    const annotation = (returnTypeAnnotation as Record<string, unknown>).typeAnnotation;
    pushTypeReferences(annotation, exportName, collected, returnTypeAnnotation);
  }
};

const collectFromParameter = (
  parameterNode: unknown,
  exportName: string,
  collected: PublicSignatureReference[],
): void => {
  if (!isAstNode(parameterNode)) return;
  const annotation = (parameterNode as Record<string, unknown>).typeAnnotation;
  if (isAstNode(annotation)) {
    const innerTypeNode = (annotation as Record<string, unknown>).typeAnnotation;
    pushTypeReferences(innerTypeNode, exportName, collected, annotation);
  }
};

const pushTypeReferences = (
  typeNode: unknown,
  exportName: string,
  collected: PublicSignatureReference[],
  spanFallbackNode: unknown,
): void => {
  if (!isAstNode(typeNode)) return;
  const referencedTypeNames = new Set<string>();
  collectTypeReferenceNamesFromTypeNode(typeNode, referencedTypeNames);
  for (const referencedName of referencedTypeNames) {
    const offset = (typeNode as Record<string, unknown>).start;
    const fallbackOffset =
      isAstNode(spanFallbackNode) && typeof (spanFallbackNode as Record<string, unknown>).start === "number"
        ? ((spanFallbackNode as Record<string, unknown>).start as number)
        : 0;
    collected.push({
      exportName,
      typeName: referencedName,
      byteOffset: typeof offset === "number" ? offset : fallbackOffset,
    });
  }
};

const collectPublicSignatureReferences = (programNode: unknown): PublicSignatureReference[] => {
  const collected: PublicSignatureReference[] = [];
  if (!isAstNode(programNode)) return collected;
  const programBody = (programNode as Record<string, unknown>).body;
  if (!Array.isArray(programBody)) return collected;

  for (const statement of programBody) {
    if (!isExportedDeclaration(statement)) continue;
    const declarationNode = declarationOf(statement);
    if (declarationNode === undefined || declarationNode === null) continue;

    const exportedName = exportedNameOfDeclaration(declarationNode);
    if (!exportedName) continue;

    if (isAstNode(declarationNode)) {
      if (
        declarationNode.type === "FunctionDeclaration" ||
        declarationNode.type === "ArrowFunctionExpression" ||
        declarationNode.type === "FunctionExpression"
      ) {
        collectFromFunctionLikeSignature(declarationNode, exportedName, collected);
        continue;
      }
      if (declarationNode.type === "VariableDeclaration") {
        const declarators = (declarationNode as Record<string, unknown>).declarations;
        if (Array.isArray(declarators)) {
          for (const declarator of declarators) {
            if (!isAstNode(declarator)) continue;
            const id = (declarator as Record<string, unknown>).id;
            if (isAstNode(id)) {
              const annotation = (id as Record<string, unknown>).typeAnnotation;
              if (isAstNode(annotation)) {
                const inner = (annotation as Record<string, unknown>).typeAnnotation;
                pushTypeReferences(inner, exportedName, collected, annotation);
              }
            }
            const init = (declarator as Record<string, unknown>).init;
            if (
              isAstNode(init) &&
              (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")
            ) {
              collectFromFunctionLikeSignature(init, exportedName, collected);
            }
          }
        }
        continue;
      }
      if (declarationNode.type === "ClassDeclaration") {
        const classBody = (declarationNode as Record<string, unknown>).body;
        if (isAstNode(classBody)) {
          const members = (classBody as Record<string, unknown>).body;
          if (Array.isArray(members)) {
            for (const member of members) {
              if (!isAstNode(member)) continue;
              if (member.type === "MethodDefinition") {
                const value = (member as Record<string, unknown>).value;
                collectFromFunctionLikeSignature(value, exportedName, collected);
              } else if (member.type === "PropertyDefinition") {
                const annotation = (member as Record<string, unknown>).typeAnnotation;
                if (isAstNode(annotation)) {
                  const inner = (annotation as Record<string, unknown>).typeAnnotation;
                  pushTypeReferences(inner, exportedName, collected, annotation);
                }
              }
            }
          }
        }
      }
    }
  }

  return collected;
};

const collectLocalTypeNames = (programNode: unknown): { localTypeNames: Set<string>; exportedNames: Set<string> } => {
  const localTypeNames = new Set<string>();
  const exportedNames = new Set<string>();
  if (!isAstNode(programNode)) return { localTypeNames, exportedNames };
  const programBody = (programNode as Record<string, unknown>).body;
  if (!Array.isArray(programBody)) return { localTypeNames, exportedNames };

  for (const statement of programBody) {
    if (!isAstNode(statement)) continue;
    if (statement.type === "TSInterfaceDeclaration" || statement.type === "TSTypeAliasDeclaration") {
      const name = extractIdentifierName((statement as Record<string, unknown>).id);
      if (name) localTypeNames.add(name);
      continue;
    }
    if (statement.type === "ExportNamedDeclaration") {
      const declarationNode = (statement as Record<string, unknown>).declaration;
      if (isAstNode(declarationNode)) {
        if (
          declarationNode.type === "TSInterfaceDeclaration" ||
          declarationNode.type === "TSTypeAliasDeclaration"
        ) {
          const name = extractIdentifierName((declarationNode as Record<string, unknown>).id);
          if (name) exportedNames.add(name);
          continue;
        }
        const declaredName = exportedNameOfDeclaration(declarationNode);
        if (declaredName) exportedNames.add(declaredName);
      }
      const specifiers = (statement as Record<string, unknown>).specifiers;
      if (Array.isArray(specifiers)) {
        for (const specifier of specifiers) {
          if (!isAstNode(specifier)) continue;
          if (specifier.type === "ExportSpecifier") {
            const exported = (specifier as Record<string, unknown>).exported;
            const exportedNameValue = extractIdentifierName(exported);
            if (exportedNameValue) exportedNames.add(exportedNameValue);
          }
        }
      }
    }
  }

  return { localTypeNames, exportedNames };
};

/**
 * Storybook CSF3 convention: a story file declares
 *
 *   const meta = { ... } satisfies Meta<...>;
 *   export default meta;
 *   type Story = StoryObj<typeof meta>;
 *   export const Primary: Story = { ... };
 *
 * `Story` is intentionally a local alias — consumers don't import it; the
 * Storybook runtime reads the default export. Flagging this as a leak
 * produces near-100% false positives on Storybook codebases, so skip
 * `*.stories.{ts,tsx,js,jsx,mts,mjs,cts,cjs}` files entirely.
 */
const STORYBOOK_STORY_FILE_PATTERN = /\.stories\.(?:[cm]?ts|[cm]?js|tsx|jsx)$/;

const isStorybookStoryFile = (filePath: string): boolean =>
  STORYBOOK_STORY_FILE_PATTERN.test(filePath);

/**
 * Detect TypeScript "private type leak": an exported declaration's signature
 * references a type that was declared locally in the same module but is not
 * itself exported. Consumers of the export need that type to satisfy the
 * signature, but cannot import it.
 *
 * Skips declaration files (`.d.ts`) — they are pure type modules where this
 * pattern is the norm. Keeps it simple: doesn't try to chase aliased re-export
 * paths (deslop-js's broader resolver work covers that elsewhere); a leak
 * that's actually re-exported gets filtered out at the `exportedNames` set.
 */
export const detectPrivateTypeLeaks = (graph: DependencyGraph): PrivateTypeLeak[] => {
  const findings: PrivateTypeLeak[] = [];

  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;
    if (module.isConfigFile) continue;
    if (!module.isReachable) continue;
    if (isStorybookStoryFile(module.fileId.path)) continue;

    let sourceText: string;
    try {
      sourceText = readFileSync(module.fileId.path, "utf-8");
    } catch {
      continue;
    }
    let parseResult: ReturnType<typeof parseSync>;
    try {
      parseResult = parseSync(module.fileId.path, sourceText);
    } catch {
      continue;
    }

    const programNode = parseResult.program;
    const { localTypeNames, exportedNames } = collectLocalTypeNames(programNode);
    if (localTypeNames.size === 0) continue;

    const publicSignatureReferences = collectPublicSignatureReferences(programNode);
    if (publicSignatureReferences.length === 0) continue;

    const lineStarts = computeLineStarts(sourceText);
    const seenPairs = new Set<string>();

    for (const reference of publicSignatureReferences) {
      if (!localTypeNames.has(reference.typeName)) continue;
      if (exportedNames.has(reference.typeName)) continue;
      const pairKey = `${reference.exportName}::${reference.typeName}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      const { line, column } = offsetToLineColumn(reference.byteOffset, lineStarts);
      findings.push({
        path: module.fileId.path,
        exportName: reference.exportName,
        typeName: reference.typeName,
        line,
        column,
        confidence: "high",
        reason: `${reference.exportName}'s signature references ${reference.typeName}, declared locally but not exported — consumers can't satisfy the type without importing it`,
      });
    }
  }

  findings.sort((leftLeak, rightLeak) => {
    if (leftLeak.path !== rightLeak.path) return leftLeak.path.localeCompare(rightLeak.path);
    return leftLeak.line - rightLeak.line;
  });
  return findings;
};
