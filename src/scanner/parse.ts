import { parseSync } from "oxc-parser";
import { readFileSync } from "node:fs";
import type {
  Statement,
  ImportDeclaration,
  ExportNamedDeclaration,
  ExportDefaultDeclaration,
  ExportAllDeclaration,
  Declaration,
  VariableDeclaration,
  BindingPattern,
  ModuleExportName,
  CallExpression,
  StaticMemberExpression,
  ImportExpression,
  StringLiteral,
  Expression,
  ModuleDeclaration,
} from "@oxc-project/types";
import type { ImportInfo, ExportInfo, ImportedName } from "../types.js";
import { getLineFromOffset, getColumnFromOffset } from "../utils/line-column.js";

export interface ParsedModule {
  imports: ImportInfo[];
  exports: ExportInfo[];
}

const IMPORT_EXPORT_LINE_PATTERN = /^[a-zA-Z{}\s,*'"`]/;

const extractMdxImportsExports = (sourceText: string): string => {
  const lines = sourceText.split("\n");
  const jsLines: string[] = [];
  for (const line of lines) {
    const trimmedLine = line.trim();
    const isLineContinuation = jsLines.length > 0
      && !jsLines[jsLines.length - 1].endsWith(";")
      && !trimmedLine.startsWith("#")
      && !trimmedLine.startsWith("<")
      && trimmedLine.length > 0
      && IMPORT_EXPORT_LINE_PATTERN.test(trimmedLine);

    if (
      trimmedLine.startsWith("import ") ||
      trimmedLine.startsWith("export ") ||
      trimmedLine.startsWith("from ") ||
      isLineContinuation
    ) {
      jsLines.push(line);
    }
  }
  return jsLines.join("\n");
};

const ASTRO_FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;

const extractAstroFrontmatter = (sourceText: string): string => {
  const frontmatterMatch = sourceText.match(ASTRO_FRONTMATTER_PATTERN);
  if (!frontmatterMatch) return "";
  return frontmatterMatch[1];
};

const getModuleExportNameValue = (exportName: ModuleExportName): string => {
  if (exportName.type === "Identifier") return exportName.name;
  if (exportName.type === "Literal") return exportName.value;
  return "default";
};

const CSS_EXTENSIONS = [".css", ".scss", ".less", ".sass"];

const CSS_IMPORT_PATTERN = /@import\s+(?:url\()?['"]([^'"]+)['"]\)?/g;

const parseCssImports = (filePath: string): ParsedModule => {
  const sourceText = readFileSync(filePath, "utf-8");
  const imports: ImportInfo[] = [];

  let match: RegExpExecArray | null;
  CSS_IMPORT_PATTERN.lastIndex = 0;
  while ((match = CSS_IMPORT_PATTERN.exec(sourceText)) !== null) {
    const specifier = match[1];
    if (specifier && !specifier.startsWith("http")) {
      imports.push({
        specifier,
        importedNames: [],
        isTypeOnly: false,
        isDynamic: false,
        isSideEffect: true,
        line: sourceText.substring(0, match.index).split("\n").length,
        column: 0,
      });
    }
  }

  return { imports, exports: [] };
};

export const parseModule = (filePath: string): ParsedModule => {
  const isCss = CSS_EXTENSIONS.some((ext) => filePath.endsWith(ext));
  if (isCss) {
    return parseCssImports(filePath);
  }

  const sourceText = readFileSync(filePath, "utf-8");
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];

  const isMdx = filePath.endsWith(".mdx");
  const isAstro = filePath.endsWith(".astro");
  const textToParse = isMdx
    ? extractMdxImportsExports(sourceText)
    : isAstro
      ? extractAstroFrontmatter(sourceText)
      : sourceText;
  const parseFileName = isMdx
    ? filePath.replace(/\.mdx$/, ".tsx")
    : isAstro
      ? filePath.replace(/\.astro$/, ".tsx")
      : filePath;

  let result = parseSync(parseFileName, textToParse);

  const hasJsxError = result.errors.length > 0
    && result.errors.some((parseError) => String(parseError.message ?? "").includes("JSX"))
    && (parseFileName.endsWith(".js") || parseFileName.endsWith(".mjs") || parseFileName.endsWith(".cjs"));

  if (hasJsxError) {
    const jsxFileName = parseFileName.replace(/\.(m?js|cjs)$/, ".jsx");
    result = parseSync(jsxFileName, textToParse);
  }

  if (result.errors.length > 0) {
    return { imports, exports };
  }

  const program = result.program;
  if (!program?.body) {
    return { imports, exports };
  }

  for (const node of program.body) {
    switch (node.type) {
      case "ImportDeclaration":
        extractImportDeclaration(node, sourceText, imports);
        break;
      case "ExportNamedDeclaration":
        extractNamedExportDeclaration(node, sourceText, exports);
        break;
      case "ExportDefaultDeclaration":
        extractDefaultExportDeclaration(node, sourceText, exports);
        break;
      case "ExportAllDeclaration":
        extractExportAllDeclaration(node, sourceText, exports);
        break;
    }
  }

  collectDynamicImports(program.body, sourceText, imports);

  return { imports, exports };
};

const extractImportDeclaration = (
  node: ImportDeclaration,
  sourceText: string,
  imports: ImportInfo[],
): void => {
  const specifier = node.source.value;
  if (!specifier) return;

  const isTypeOnly = node.importKind === "type";
  const importedNames: ImportedName[] = [];

  for (const specifierNode of node.specifiers) {
    switch (specifierNode.type) {
      case "ImportDefaultSpecifier": {
        importedNames.push({
          name: "default",
          alias: specifierNode.local.name,
          isNamespace: false,
          isDefault: true,
          isTypeOnly,
        });
        break;
      }
      case "ImportNamespaceSpecifier": {
        importedNames.push({
          name: "*",
          alias: specifierNode.local.name,
          isNamespace: true,
          isDefault: false,
          isTypeOnly,
        });
        break;
      }
      case "ImportSpecifier": {
        const importedName = getModuleExportNameValue(specifierNode.imported);
        const localName = specifierNode.local.name;

        importedNames.push({
          name: importedName,
          alias: localName !== importedName ? localName : undefined,
          isNamespace: false,
          isDefault: importedName === "default",
          isTypeOnly: isTypeOnly || specifierNode.importKind === "type",
        });
        break;
      }
    }
  }

  const isSideEffectImport = importedNames.length === 0;

  if (isSideEffectImport) {
    importedNames.push({
      name: "*",
      alias: undefined,
      isNamespace: false,
      isDefault: false,
      isTypeOnly: false,
    });
  }

  imports.push({
    specifier,
    importedNames,
    isTypeOnly,
    isDynamic: false,
    isSideEffect: isSideEffectImport,
    line: getLineFromOffset(sourceText, node.start),
    column: getColumnFromOffset(sourceText, node.start),
  });
};

const extractNamedExportDeclaration = (
  node: ExportNamedDeclaration,
  sourceText: string,
  exports: ExportInfo[],
): void => {
  const isTypeOnly = node.exportKind === "type";
  const reExportSource = node.source?.value ?? undefined;

  if (node.declaration) {
    extractDeclarationNames(node.declaration, isTypeOnly, sourceText, exports, node.start);
  }

  for (const specifierNode of node.specifiers) {
    const exportedName = getModuleExportNameValue(specifierNode.exported);
    const localName = getModuleExportNameValue(specifierNode.local);

    exports.push({
      name: exportedName,
      isDefault: exportedName === "default",
      isTypeOnly: isTypeOnly || specifierNode.exportKind === "type",
      isReExport: reExportSource !== undefined,
      reExportSource,
      reExportOriginalName: reExportSource !== undefined ? localName : undefined,
      isNamespaceReExport: false,
      line: getLineFromOffset(sourceText, specifierNode.start ?? node.start),
      column: getColumnFromOffset(sourceText, specifierNode.start ?? node.start),
    });
  }
};

const extractDefaultExportDeclaration = (
  node: ExportDefaultDeclaration,
  sourceText: string,
  exports: ExportInfo[],
): void => {
  exports.push({
    name: "default",
    isDefault: true,
    isTypeOnly: false,
    isReExport: false,
    reExportSource: undefined,
    reExportOriginalName: undefined,
    isNamespaceReExport: false,
    line: getLineFromOffset(sourceText, node.start),
    column: getColumnFromOffset(sourceText, node.start),
  });
};

const extractExportAllDeclaration = (
  node: ExportAllDeclaration,
  sourceText: string,
  exports: ExportInfo[],
): void => {
  const reExportSource = node.source.value;
  if (!reExportSource) return;

  const exportedName = node.exported
    ? getModuleExportNameValue(node.exported)
    : undefined;

  exports.push({
    name: exportedName ?? "*",
    isDefault: false,
    isTypeOnly: node.exportKind === "type",
    isReExport: true,
    reExportSource,
    reExportOriginalName: "*",
    isNamespaceReExport: !exportedName,
    line: getLineFromOffset(sourceText, node.start),
    column: getColumnFromOffset(sourceText, node.start),
  });
};

const extractDeclarationNames = (
  declaration: Declaration,
  isTypeOnly: boolean,
  sourceText: string,
  exports: ExportInfo[],
  fallbackStart: number,
): void => {
  const declarationType = declaration.type;

  if (
    declarationType === "FunctionDeclaration" ||
    declarationType === "ClassDeclaration" ||
    declarationType === "TSEnumDeclaration"
  ) {
    const declarationWithId = declaration as { id: { name: string } | null; start: number };
    const declarationName = declarationWithId.id?.name;
    if (declarationName) {
      exports.push({
        name: declarationName,
        isDefault: false,
        isTypeOnly,
        isReExport: false,
        reExportSource: undefined,
        reExportOriginalName: undefined,
        isNamespaceReExport: false,
        line: getLineFromOffset(sourceText, declaration.start ?? fallbackStart),
        column: getColumnFromOffset(sourceText, declaration.start ?? fallbackStart),
      });
    }
    return;
  }

  if (
    declarationType === "TSTypeAliasDeclaration" ||
    declarationType === "TSInterfaceDeclaration"
  ) {
    const typeDeclaration = declaration as { id: { name: string }; start: number };
    const declarationName = typeDeclaration.id.name;
    if (declarationName) {
      exports.push({
        name: declarationName,
        isDefault: false,
        isTypeOnly: true,
        isReExport: false,
        reExportSource: undefined,
        reExportOriginalName: undefined,
        isNamespaceReExport: false,
        line: getLineFromOffset(sourceText, declaration.start ?? fallbackStart),
        column: getColumnFromOffset(sourceText, declaration.start ?? fallbackStart),
      });
    }
    return;
  }

  if (declarationType === "VariableDeclaration") {
    const variableDeclaration = declaration as VariableDeclaration;
    for (const declarator of variableDeclaration.declarations) {
      const bindingNames = extractBindingPatternNames(declarator.id);
      for (const bindingName of bindingNames) {
        exports.push({
          name: bindingName,
          isDefault: false,
          isTypeOnly,
          isReExport: false,
          reExportSource: undefined,
          reExportOriginalName: undefined,
          isNamespaceReExport: false,
          line: getLineFromOffset(sourceText, declarator.start ?? fallbackStart),
          column: getColumnFromOffset(sourceText, declarator.start ?? fallbackStart),
        });
      }
    }
  }
};

const extractBindingPatternNames = (pattern: BindingPattern): string[] => {
  if (!pattern) return [];

  if (pattern.type === "Identifier") {
    return pattern.name ? [pattern.name] : [];
  }

  if (pattern.type === "ObjectPattern") {
    const names: string[] = [];
    for (const property of pattern.properties) {
      if (property.type === "RestElement") {
        names.push(...extractBindingPatternNames(property.argument));
      } else {
        names.push(...extractBindingPatternNames(property.value));
      }
    }
    return names;
  }

  if (pattern.type === "ArrayPattern") {
    const names: string[] = [];
    for (const element of pattern.elements) {
      if (!element) continue;
      if (element.type === "RestElement") {
        names.push(...extractBindingPatternNames(element.argument));
      } else {
        names.push(...extractBindingPatternNames(element));
      }
    }
    return names;
  }

  if (pattern.type === "AssignmentPattern") {
    return extractBindingPatternNames(pattern.left);
  }

  return [];
};

const createNamespaceImportedName = (): ImportedName => ({
  name: "*",
  alias: undefined,
  isNamespace: true,
  isDefault: false,
  isTypeOnly: false,
});

interface WalkableNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

const isWalkableNode = (value: unknown): value is WalkableNode =>
  Boolean(value) && typeof value === "object" && typeof (value as WalkableNode).type === "string";

const extractStringLiteralFromArgument = (
  callArguments: CallExpression["arguments"],
): string | undefined => {
  const firstArgument = callArguments[0];
  if (!firstArgument) return undefined;
  if (firstArgument.type === "SpreadElement") return undefined;
  if (firstArgument.type !== "Literal") return undefined;
  const literalValue = (firstArgument as StringLiteral).value;
  return typeof literalValue === "string" ? literalValue : undefined;
};

const collectDynamicImports = (
  bodyNodes: Array<Statement | ModuleDeclaration>,
  sourceText: string,
  imports: ImportInfo[],
): void => {
  const walkNode = (node: WalkableNode): void => {
    if (node.type === "ImportExpression") {
      const importExpression = node as unknown as ImportExpression;
      const sourceExpression = importExpression.source;
      if (sourceExpression.type === "Literal") {
        const specifierValue = (sourceExpression as StringLiteral).value;
        if (specifierValue) {
          imports.push({
            specifier: specifierValue,
            importedNames: [createNamespaceImportedName()],
            isTypeOnly: false,
            isDynamic: true,
            isSideEffect: false,
            line: getLineFromOffset(sourceText, importExpression.start),
            column: getColumnFromOffset(sourceText, importExpression.start),
          });
        }
      }
      return;
    }

    if (node.type === "CallExpression") {
      const callExpression = node as unknown as CallExpression;

      if (callExpression.callee.type === "Identifier" && callExpression.callee.name === "require") {
        const requireSpecifier = extractStringLiteralFromArgument(callExpression.arguments);
        if (requireSpecifier) {
          imports.push({
            specifier: requireSpecifier,
            importedNames: [createNamespaceImportedName()],
            isTypeOnly: false,
            isDynamic: true,
            isSideEffect: false,
            line: getLineFromOffset(sourceText, callExpression.start),
            column: getColumnFromOffset(sourceText, callExpression.start),
          });
        }
      }

      if (callExpression.callee.type === "MemberExpression" && !callExpression.callee.computed) {
        const memberExpression = callExpression.callee as StaticMemberExpression;
        if (
          memberExpression.object.type === "MetaProperty" &&
          memberExpression.property.name === "glob"
        ) {
          const globSpecifier = extractStringLiteralFromArgument(callExpression.arguments);
          if (globSpecifier) {
            imports.push({
              specifier: globSpecifier,
              importedNames: [createNamespaceImportedName()],
              isTypeOnly: false,
              isDynamic: true,
              isSideEffect: false,
              isGlob: true,
              line: getLineFromOffset(sourceText, callExpression.start),
              column: getColumnFromOffset(sourceText, callExpression.start),
            });
          }
        }
      }
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const element of value) {
          if (isWalkableNode(element)) walkNode(element);
        }
      } else if (isWalkableNode(value)) {
        walkNode(value);
      }
    }
  };

  for (const topLevelNode of bodyNodes) {
    if (isWalkableNode(topLevelNode)) walkNode(topLevelNode);
  }
};
