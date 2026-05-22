import ts from "typescript";
import { lookupSourceFile } from "../program.js";
import type { SemanticContext } from "../program.js";

export interface ExportedTypeSymbolLookup {
  symbol: ts.Symbol;
  declaration: ts.Declaration;
  isInterface: boolean;
}

export const resolveExportedTypeSymbol = (
  context: SemanticContext,
  modulePath: string,
  exportName: string,
): ExportedTypeSymbolLookup | undefined => {
  const sourceFile = lookupSourceFile(context, modulePath);
  if (!sourceFile) return undefined;

  const moduleSymbol = context.checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) return undefined;

  for (const exportedSymbol of context.checker.getExportsOfModule(moduleSymbol)) {
    if (exportedSymbol.getName() !== exportName) continue;
    const resolvedSymbol =
      (exportedSymbol.flags & ts.SymbolFlags.Alias) !== 0
        ? context.checker.getAliasedSymbol(exportedSymbol)
        : exportedSymbol;
    const declaration = resolvedSymbol.declarations?.[0];
    if (!declaration) continue;
    const isInterface = ts.isInterfaceDeclaration(declaration);
    const isTypeAlias = ts.isTypeAliasDeclaration(declaration);
    if (!isInterface && !isTypeAlias) continue;
    return { symbol: resolvedSymbol, declaration, isInterface };
  }
  return undefined;
};
