import { parseSync } from "oxc-parser";
import { readFileSync } from "node:fs";
import type { ImportInfo, ExportInfo, ImportedName } from "../types.js";
import { getLineFromOffset, getColumnFromOffset } from "../utils/line-column.js";

export interface ParsedModule {
  imports: ImportInfo[];
  exports: ExportInfo[];
}

interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

export const parseModule = (filePath: string): ParsedModule => {
  const sourceText = readFileSync(filePath, "utf-8");
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];

  const result = parseSync(filePath, sourceText);

  if (result.errors.length > 0) {
    return { imports, exports };
  }

  const program = result.program;
  if (!program?.body) {
    return { imports, exports };
  }

  for (const node of program.body as AstNode[]) {
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

  collectDynamicImports(program.body as AstNode[], sourceText, imports);

  return { imports, exports };
};

const extractImportDeclaration = (
  node: AstNode,
  sourceText: string,
  imports: ImportInfo[],
): void => {
  const sourceNode = node.source as AstNode | undefined;
  const specifier = (sourceNode as Record<string, unknown>)?.value as string | undefined;
  if (!specifier) return;

  const isTypeOnly = (node as Record<string, unknown>).importKind === "type";
  const specifiers = (node as Record<string, unknown>).specifiers as AstNode[] | undefined;
  const importedNames: ImportedName[] = [];

  if (specifiers) {
    for (const specifierNode of specifiers) {
      switch (specifierNode.type) {
        case "ImportDefaultSpecifier": {
          const localNode = specifierNode.local as AstNode | undefined;
          importedNames.push({
            name: "default",
            alias: (localNode as Record<string, unknown>)?.name as string | undefined,
            isNamespace: false,
            isDefault: true,
            isTypeOnly,
          });
          break;
        }
        case "ImportNamespaceSpecifier": {
          const localNode = specifierNode.local as AstNode | undefined;
          importedNames.push({
            name: "*",
            alias: (localNode as Record<string, unknown>)?.name as string | undefined,
            isNamespace: true,
            isDefault: false,
            isTypeOnly,
          });
          break;
        }
        case "ImportSpecifier": {
          const importedNode = specifierNode.imported as AstNode | undefined;
          const localNode = specifierNode.local as AstNode | undefined;
          const importedName =
            ((importedNode as Record<string, unknown>)?.name as string) ??
            ((importedNode as Record<string, unknown>)?.value as string) ??
            "default";
          const localName = (localNode as Record<string, unknown>)?.name as string | undefined;

          importedNames.push({
            name: importedName,
            alias: localName !== importedName ? localName : undefined,
            isNamespace: false,
            isDefault: importedName === "default",
            isTypeOnly:
              isTypeOnly ||
              (specifierNode as Record<string, unknown>).importKind === "type",
          });
          break;
        }
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
  node: AstNode,
  sourceText: string,
  exports: ExportInfo[],
): void => {
  const isTypeOnly = (node as Record<string, unknown>).exportKind === "type";
  const sourceNode = (node as Record<string, unknown>).source as AstNode | undefined;
  const reExportSource =
    ((sourceNode as Record<string, unknown>)?.value as string) ?? undefined;
  const declaration = (node as Record<string, unknown>).declaration as AstNode | undefined;
  const specifiers = (node as Record<string, unknown>).specifiers as AstNode[] | undefined;

  if (declaration) {
    extractDeclarationNames(declaration, isTypeOnly, sourceText, exports, node.start);
  }

  if (specifiers) {
    for (const specifierNode of specifiers) {
      const exportedNode = specifierNode.exported as AstNode | undefined;
      const localNode = specifierNode.local as AstNode | undefined;
      const exportedName =
        ((exportedNode as Record<string, unknown>)?.name as string) ??
        ((exportedNode as Record<string, unknown>)?.value as string) ??
        "default";
      const localName =
        ((localNode as Record<string, unknown>)?.name as string) ??
        ((localNode as Record<string, unknown>)?.value as string) ??
        exportedName;

      exports.push({
        name: exportedName,
        isDefault: exportedName === "default",
        isTypeOnly:
          isTypeOnly ||
          (specifierNode as Record<string, unknown>).exportKind === "type",
        isReExport: reExportSource !== undefined,
        reExportSource,
        reExportOriginalName: reExportSource !== undefined ? localName : undefined,
        isNamespaceReExport: false,
        line: getLineFromOffset(sourceText, specifierNode.start ?? node.start),
        column: getColumnFromOffset(sourceText, specifierNode.start ?? node.start),
      });
    }
  }
};

const extractDefaultExportDeclaration = (
  node: AstNode,
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
  node: AstNode,
  sourceText: string,
  exports: ExportInfo[],
): void => {
  const sourceNode = (node as Record<string, unknown>).source as AstNode | undefined;
  const reExportSource = (sourceNode as Record<string, unknown>)?.value as string | undefined;
  if (!reExportSource) return;

  const exportedNode = (node as Record<string, unknown>).exported as AstNode | undefined;
  const exportedName =
    ((exportedNode as Record<string, unknown>)?.name as string) ??
    ((exportedNode as Record<string, unknown>)?.value as string) ??
    undefined;

  exports.push({
    name: exportedName ?? "*",
    isDefault: false,
    isTypeOnly: (node as Record<string, unknown>).exportKind === "type",
    isReExport: true,
    reExportSource,
    reExportOriginalName: "*",
    isNamespaceReExport: !exportedName,
    line: getLineFromOffset(sourceText, node.start),
    column: getColumnFromOffset(sourceText, node.start),
  });
};

const extractDeclarationNames = (
  declaration: AstNode,
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
    const identifierNode = (declaration as Record<string, unknown>).id as AstNode | undefined;
    const declarationName = (identifierNode as Record<string, unknown>)?.name as string | undefined;
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
    const identifierNode = (declaration as Record<string, unknown>).id as AstNode | undefined;
    const declarationName = (identifierNode as Record<string, unknown>)?.name as string | undefined;
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
    const declarations = (declaration as Record<string, unknown>).declarations as AstNode[] | undefined;
    if (!declarations) return;

    for (const declarator of declarations) {
      const bindingPattern = (declarator as Record<string, unknown>).id as AstNode | undefined;
      if (!bindingPattern) continue;

      const names = extractBindingPatternNames(bindingPattern);
      for (const bindingName of names) {
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

const extractBindingPatternNames = (pattern: AstNode): string[] => {
  if (!pattern) return [];

  if (pattern.type === "Identifier") {
    const identifierName = (pattern as Record<string, unknown>).name as string | undefined;
    return identifierName ? [identifierName] : [];
  }

  if (pattern.type === "ObjectPattern") {
    const names: string[] = [];
    const properties = (pattern as Record<string, unknown>).properties as AstNode[] | undefined;
    if (!properties) return names;

    for (const property of properties) {
      if (property.type === "RestElement") {
        const argument = (property as Record<string, unknown>).argument as AstNode | undefined;
        if (argument) names.push(...extractBindingPatternNames(argument));
      } else {
        const valueNode =
          ((property as Record<string, unknown>).value as AstNode) ??
          ((property as Record<string, unknown>).key as AstNode);
        if (valueNode) names.push(...extractBindingPatternNames(valueNode));
      }
    }
    return names;
  }

  if (pattern.type === "ArrayPattern") {
    const names: string[] = [];
    const elements = (pattern as Record<string, unknown>).elements as (AstNode | null)[] | undefined;
    if (!elements) return names;

    for (const element of elements) {
      if (!element) continue;
      if (element.type === "RestElement") {
        const argument = (element as Record<string, unknown>).argument as AstNode | undefined;
        if (argument) names.push(...extractBindingPatternNames(argument));
      } else {
        names.push(...extractBindingPatternNames(element));
      }
    }
    return names;
  }

  if (pattern.type === "AssignmentPattern") {
    const leftNode = (pattern as Record<string, unknown>).left as AstNode | undefined;
    return leftNode ? extractBindingPatternNames(leftNode) : [];
  }

  return [];
};

const collectDynamicImports = (
  bodyNodes: AstNode[],
  sourceText: string,
  imports: ImportInfo[],
): void => {
  const walkNode = (node: unknown): void => {
    if (!node || typeof node !== "object") return;

    const astNode = node as Record<string, unknown>;

    if (astNode.type === "ImportExpression") {
      const sourceNode = astNode.source as AstNode | undefined;
      if (sourceNode?.type === "Literal") {
        const specifier = (sourceNode as Record<string, unknown>).value as string;
        if (specifier) {
          imports.push({
            specifier,
            importedNames: [
              {
                name: "*",
                alias: undefined,
                isNamespace: true,
                isDefault: false,
                isTypeOnly: false,
              },
            ],
            isTypeOnly: false,
            isDynamic: true,
            isSideEffect: false,
            line: getLineFromOffset(sourceText, (astNode as AstNode).start ?? 0),
            column: getColumnFromOffset(sourceText, (astNode as AstNode).start ?? 0),
          });
        }
      }
      return;
    }

    for (const value of Object.values(astNode)) {
      if (Array.isArray(value)) {
        for (const element of value) {
          walkNode(element);
        }
      } else if (value && typeof value === "object" && (value as Record<string, unknown>).type) {
        walkNode(value);
      }
    }
  };

  for (const topLevelNode of bodyNodes) {
    walkNode(topLevelNode);
  }
};
