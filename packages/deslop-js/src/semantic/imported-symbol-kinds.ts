import ts from "typescript";
import type { DependencyGraph } from "../types.js";
import { lookupSourceFile } from "./program.js";
import type { SemanticContext } from "./program.js";
import { extractPackageName } from "../utils/package-name.js";

export interface ImportedSymbolUsage {
  packageName: string;
  importedName: string;
  isResolvedTypeOnly: boolean;
}

export interface ImportedSymbolIndex {
  byPackage: Map<string, ImportedSymbolUsage[]>;
  hasAnyValueImport: (packageName: string) => boolean;
}

const resolveSymbolFlags = (
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
): ts.SymbolFlags | undefined => {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (!symbol) return undefined;
  const resolved =
    (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
  return resolved.flags;
};

export const buildImportedSymbolIndex = (
  graph: DependencyGraph,
  context: SemanticContext,
): ImportedSymbolIndex => {
  const byPackage = new Map<string, ImportedSymbolUsage[]>();

  for (const module of graph.modules) {
    if (!module.isReachable) continue;
    if (module.isDeclarationFile) continue;

    const sourceFile = lookupSourceFile(context, module.fileId.path);
    if (!sourceFile) continue;

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;

      const specifier = statement.moduleSpecifier.text;
      const packageName = extractPackageName(specifier);
      if (!packageName) continue;
      if (specifier.startsWith(".") || specifier.startsWith("/")) continue;

      const importClause = statement.importClause;
      if (!importClause) continue;

      const isWholeClauseTypeOnly = Boolean(importClause.isTypeOnly);
      const usagesForPackage = byPackage.get(packageName) ?? [];

      if (importClause.name) {
        const defaultUsage: ImportedSymbolUsage = {
          packageName,
          importedName: "default",
          isResolvedTypeOnly: isWholeClauseTypeOnly,
        };
        if (!isWholeClauseTypeOnly) {
          const flags = resolveSymbolFlags(importClause.name, context.checker);
          if (flags !== undefined) {
            defaultUsage.isResolvedTypeOnly = (flags & ts.SymbolFlags.Value) === 0;
          }
        }
        usagesForPackage.push(defaultUsage);
      }

      if (importClause.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
        const namespaceUsage: ImportedSymbolUsage = {
          packageName,
          importedName: "*",
          isResolvedTypeOnly: isWholeClauseTypeOnly,
        };
        if (!isWholeClauseTypeOnly) {
          const flags = resolveSymbolFlags(importClause.namedBindings.name, context.checker);
          if (flags !== undefined) {
            namespaceUsage.isResolvedTypeOnly = (flags & ts.SymbolFlags.Value) === 0;
          }
        }
        usagesForPackage.push(namespaceUsage);
      }

      if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        for (const element of importClause.namedBindings.elements) {
          const elementTypeOnly = isWholeClauseTypeOnly || Boolean(element.isTypeOnly);
          const importedName = (element.propertyName ?? element.name).text;
          const usage: ImportedSymbolUsage = {
            packageName,
            importedName,
            isResolvedTypeOnly: elementTypeOnly,
          };
          if (!elementTypeOnly) {
            const flags = resolveSymbolFlags(element.name, context.checker);
            if (flags !== undefined) {
              usage.isResolvedTypeOnly = (flags & ts.SymbolFlags.Value) === 0;
            }
          }
          usagesForPackage.push(usage);
        }
      }

      byPackage.set(packageName, usagesForPackage);
    }
  }

  return {
    byPackage,
    hasAnyValueImport: (packageName: string) => {
      const usages = byPackage.get(packageName);
      if (!usages || usages.length === 0) return false;
      return usages.some((usage) => !usage.isResolvedTypeOnly);
    },
  };
};
