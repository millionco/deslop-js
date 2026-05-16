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

const extractMdxImportsExports = (sourceText: string): string => {
  const statements: string[] = [];
  let isInMultiline = false;
  let braceDepth = 0;

  for (const line of sourceText.split("\n")) {
    const trimmedLine = line.trim();
    if (isInMultiline) {
      statements.push(line);
      for (const character of trimmedLine) {
        if (character === "{") braceDepth++;
        if (character === "}") braceDepth--;
      }
      const hasFromClause = trimmedLine.includes(" from ")
        || trimmedLine.includes(" from'")
        || trimmedLine.includes(" from\"");
      if (braceDepth <= 0 || trimmedLine.endsWith(";") || hasFromClause) {
        isInMultiline = false;
        braceDepth = 0;
      }
    } else if (
      trimmedLine.startsWith("import ") ||
      trimmedLine.startsWith("import{") ||
      trimmedLine.startsWith("export ") ||
      trimmedLine.startsWith("export{")
    ) {
      statements.push(line);
      for (const character of trimmedLine) {
        if (character === "{") braceDepth++;
        if (character === "}") braceDepth--;
      }
      if (braceDepth > 0 && !trimmedLine.includes(" from ")) {
        isInMultiline = true;
      }
    }
  }

  return statements.join("\n");
};

const ASTRO_FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;

const extractAstroFrontmatter = (sourceText: string): string => {
  const frontmatterMatch = sourceText.match(ASTRO_FRONTMATTER_PATTERN);
  if (!frontmatterMatch) return "";
  return frontmatterMatch[1];
};

const VUE_SCRIPT_PATTERN = /<script[^>]*(?:lang=["'](?:ts|tsx)["'][^>]*)?>([\s\S]*?)<\/script>/gi;

const extractVueScriptContent = (sourceText: string): string => {
  const scriptBlocks: string[] = [];
  let scriptMatch: RegExpExecArray | null;
  VUE_SCRIPT_PATTERN.lastIndex = 0;
  while ((scriptMatch = VUE_SCRIPT_PATTERN.exec(sourceText)) !== null) {
    if (scriptMatch[1]) {
      scriptBlocks.push(scriptMatch[1]);
    }
  }
  return scriptBlocks.join("\n");
};

const SVELTE_SCRIPT_PATTERN = /<script[^>]*>([\s\S]*?)<\/script>/gi;

const extractSvelteScriptContent = (sourceText: string): string => {
  const scriptBlocks: string[] = [];
  let scriptMatch: RegExpExecArray | null;
  SVELTE_SCRIPT_PATTERN.lastIndex = 0;
  while ((scriptMatch = SVELTE_SCRIPT_PATTERN.exec(sourceText)) !== null) {
    if (scriptMatch[1]) {
      scriptBlocks.push(scriptMatch[1]);
    }
  }
  return scriptBlocks.join("\n");
};

const getModuleExportNameValue = (exportName: ModuleExportName): string => {
  if (exportName.type === "Identifier") return exportName.name;
  if (exportName.type === "Literal") return exportName.value;
  return "default";
};

const CSS_EXTENSIONS = [".css", ".scss", ".less", ".sass"];

const CSS_IMPORT_PATTERN = /@import\s+(?:url\()?['"]([^'"]+)['"]\)?/g;
const SCSS_USE_FORWARD_PATTERN = /@(?:use|forward)\s+['"]([^'"]+)['"]/g;

const parseCssImports = (filePath: string): ParsedModule => {
  const sourceText = readFileSync(filePath, "utf-8");
  const imports: ImportInfo[] = [];

  const patterns = [CSS_IMPORT_PATTERN, SCSS_USE_FORWARD_PATTERN];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(sourceText)) !== null) {
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
  }

  return { imports, exports: [] };
};

const NON_JS_EXTENSIONS = [".graphql", ".gql"];

export const parseModule = (filePath: string): ParsedModule => {
  const isCss = CSS_EXTENSIONS.some((ext) => filePath.endsWith(ext));
  if (isCss) {
    return parseCssImports(filePath);
  }

  const isNonJsFile = NON_JS_EXTENSIONS.some((ext) => filePath.endsWith(ext));
  if (isNonJsFile) {
    return { imports: [], exports: [] };
  }

  const sourceText = readFileSync(filePath, "utf-8");
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];

  const isMdx = filePath.endsWith(".mdx");
  const isAstro = filePath.endsWith(".astro");
  const isVue = filePath.endsWith(".vue");
  const isSvelte = filePath.endsWith(".svelte");
  const textToParse = isMdx
    ? extractMdxImportsExports(sourceText)
    : isAstro
      ? extractAstroFrontmatter(sourceText)
      : isVue
        ? extractVueScriptContent(sourceText)
        : isSvelte
          ? extractSvelteScriptContent(sourceText)
          : sourceText;
  const parseFileName = (isMdx || isAstro || isVue || isSvelte)
    ? filePath.replace(/\.(mdx|astro|vue|svelte)$/, ".tsx")
    : filePath;

  let result = parseSync(parseFileName, textToParse);

  const isPlainJsFile = parseFileName.endsWith(".js") || parseFileName.endsWith(".mjs") || parseFileName.endsWith(".cjs");
  const hasJsxError = result.errors.length > 0
    && isPlainJsFile
    && result.errors.some((parseError) => {
      const errorMessage = String(parseError.message ?? "");
      return errorMessage.includes("JSX") || errorMessage.includes("Unexpected token");
    });

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
      isSynthetic: false,
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
    isSynthetic: false,
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
    isSynthetic: false,
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
        isSynthetic: false,
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
        isSynthetic: false,
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
          isSynthetic: false,
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
      } else if (sourceExpression.type === "TemplateLiteral") {
        const templateLiteral = sourceExpression as unknown as { quasis: Array<{ value: { cooked: string } }> };
        if (templateLiteral.quasis.length >= 2) {
          const globPattern = templateLiteral.quasis.map((quasi) => quasi.value.cooked).join("*");
          if (globPattern.startsWith("./") || globPattern.startsWith("../")) {
            imports.push({
              specifier: globPattern,
              importedNames: [createNamespaceImportedName()],
              isTypeOnly: false,
              isDynamic: true,
              isSideEffect: false,
              isGlob: true,
              line: getLineFromOffset(sourceText, importExpression.start),
              column: getColumnFromOffset(sourceText, importExpression.start),
            });
          }
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
          memberExpression.object.type === "Identifier" &&
          (memberExpression.object.name === "vi" || memberExpression.object.name === "jest") &&
          memberExpression.property.name === "mock"
        ) {
          const mockSpecifier = extractStringLiteralFromArgument(callExpression.arguments);
          if (mockSpecifier) {
            imports.push({
              specifier: mockSpecifier,
              importedNames: [createNamespaceImportedName()],
              isTypeOnly: false,
              isDynamic: true,
              isSideEffect: true,
              line: getLineFromOffset(sourceText, callExpression.start),
              column: getColumnFromOffset(sourceText, callExpression.start),
            });
          }
        }
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

    if (node.type === "NewExpression") {
      const newExpression = node as unknown as { callee: Expression; arguments: CallExpression["arguments"]; start: number };
      if (
        newExpression.callee.type === "Identifier" &&
        (newExpression.callee as { name: string }).name === "URL" &&
        newExpression.arguments.length >= 2
      ) {
        const secondArgument = newExpression.arguments[1];
        const isImportMetaUrl =
          secondArgument.type === "MemberExpression" &&
          (secondArgument as unknown as StaticMemberExpression).object.type === "MetaProperty" &&
          (secondArgument as unknown as StaticMemberExpression).property.name === "url";
        if (isImportMetaUrl) {
          const urlSpecifier = extractStringLiteralFromArgument(newExpression.arguments);
          if (urlSpecifier) {
            imports.push({
              specifier: urlSpecifier,
              importedNames: [createNamespaceImportedName()],
              isTypeOnly: false,
              isDynamic: true,
              isSideEffect: true,
              line: getLineFromOffset(sourceText, newExpression.start),
              column: getColumnFromOffset(sourceText, newExpression.start),
            });
          }
        }
      }
    }

    if (node.type === "Decorator") {
      const decoratorNode = node as unknown as { expression: WalkableNode };
      const expression = decoratorNode.expression;
      if (
        expression?.type === "CallExpression"
      ) {
        const callNode = expression as unknown as CallExpression;
        const callee = callNode.callee;
        if (callee.type === "Identifier" && (callee as { name: string }).name === "Component") {
          const objectArgument = callNode.arguments[0];
          if (objectArgument?.type === "ObjectExpression") {
            const objectProperties = (objectArgument as unknown as { properties: Array<WalkableNode> }).properties;
            for (const property of objectProperties) {
              if (property.type !== "ObjectProperty" && property.type !== "Property") continue;
              const propertyKey = (property as unknown as { key: { name?: string; value?: string } }).key;
              const propertyName = propertyKey?.name ?? propertyKey?.value;
              const propertyValue = (property as unknown as { value: WalkableNode }).value;
              if (propertyName === "templateUrl" && propertyValue?.type === "Literal") {
                const templatePath = (propertyValue as unknown as StringLiteral).value;
                if (templatePath) {
                  imports.push({
                    specifier: templatePath.startsWith(".") ? templatePath : `./${templatePath}`,
                    importedNames: [],
                    isTypeOnly: false,
                    isDynamic: false,
                    isSideEffect: true,
                    line: getLineFromOffset(sourceText, property.start),
                    column: getColumnFromOffset(sourceText, property.start),
                  });
                }
              }
              if ((propertyName === "styleUrl" || propertyName === "styleUrls") && propertyValue) {
                const styleUrlValues: string[] = [];
                if (propertyValue.type === "Literal") {
                  const singleValue = (propertyValue as unknown as StringLiteral).value;
                  if (singleValue) styleUrlValues.push(singleValue);
                } else if (propertyValue.type === "ArrayExpression") {
                  const arrayElements = (propertyValue as unknown as { elements: Array<WalkableNode> }).elements;
                  for (const element of arrayElements) {
                    if (element?.type === "Literal") {
                      const elementValue = (element as unknown as StringLiteral).value;
                      if (elementValue) styleUrlValues.push(elementValue);
                    }
                  }
                }
                for (const styleUrl of styleUrlValues) {
                  imports.push({
                    specifier: styleUrl.startsWith(".") ? styleUrl : `./${styleUrl}`,
                    importedNames: [],
                    isTypeOnly: false,
                    isDynamic: false,
                    isSideEffect: true,
                    line: getLineFromOffset(sourceText, property.start),
                    column: getColumnFromOffset(sourceText, property.start),
                  });
                }
              }
            }
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
