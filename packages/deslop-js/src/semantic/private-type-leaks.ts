import { sep } from "node:path";
import ts from "typescript";
import type { DependencyGraph, DeslopConfig, PrivateTypeLeak } from "../types.js";
import { SEMANTIC_TRACE_MAX_ENTRIES } from "../constants.js";
import { lookupSourceFile } from "./program.js";
import type { SemanticContext } from "./program.js";

interface ExportedValue {
  modulePath: string;
  exportName: string;
  declaration: ts.Declaration;
  isModuleEntry: boolean;
}

const NON_API_ENTRY_PATTERN =
  /\.(?:stories|story|spec|test|cy|bench)\.[cm]?[jt]sx?$|(?:^|\/)__tests__\/|(?:^|\/)__stories__\//;

const isPublicApiEntry = (modulePath: string): boolean => {
  if (NON_API_ENTRY_PATTERN.test(modulePath)) return false;
  return true;
};

const collectEntryExportedSymbols = (
  graph: DependencyGraph,
  context: SemanticContext,
): Set<ts.Symbol> => {
  const exposedSymbols = new Set<ts.Symbol>();
  for (const module of graph.modules) {
    if (!module.isEntryPoint) continue;
    if (!isPublicApiEntry(module.fileId.path)) continue;
    const sourceFile = lookupSourceFile(context, module.fileId.path);
    if (!sourceFile) continue;
    const moduleSymbol = context.checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;
    for (const exportedSymbol of context.checker.getExportsOfModule(moduleSymbol)) {
      const resolved =
        (exportedSymbol.flags & ts.SymbolFlags.Alias) !== 0
          ? context.checker.getAliasedSymbol(exportedSymbol)
          : exportedSymbol;
      exposedSymbols.add(resolved);
    }
  }
  return exposedSymbols;
};

const collectReachableExportedValues = (
  graph: DependencyGraph,
  context: SemanticContext,
): ExportedValue[] => {
  const values: ExportedValue[] = [];
  for (const module of graph.modules) {
    if (!module.isReachable) continue;
    if (module.isDeclarationFile) continue;
    if (!module.isEntryPoint) continue;
    if (!isPublicApiEntry(module.fileId.path)) continue;

    const sourceFile = lookupSourceFile(context, module.fileId.path);
    if (!sourceFile) continue;

    const moduleSymbol = context.checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;

    for (const exportedSymbol of context.checker.getExportsOfModule(moduleSymbol)) {
      const resolved =
        (exportedSymbol.flags & ts.SymbolFlags.Alias) !== 0
          ? context.checker.getAliasedSymbol(exportedSymbol)
          : exportedSymbol;
      if ((resolved.flags & ts.SymbolFlags.Value) === 0) continue;

      const declaration = resolved.declarations?.[0];
      if (!declaration) continue;

      values.push({
        modulePath: module.fileId.path,
        exportName: exportedSymbol.getName(),
        declaration,
        isModuleEntry: true,
      });
    }
  }
  return values;
};

const isExternalTypeSymbol = (declaration: ts.Declaration): boolean => {
  const fileName = declaration.getSourceFile().fileName;
  return fileName.includes(`${sep}node_modules${sep}`) || fileName.includes("/node_modules/");
};

const isPrimitiveOrLib = (typeSymbol: ts.Symbol): boolean => {
  const declarations = typeSymbol.declarations;
  if (!declarations || declarations.length === 0) return true;
  for (const declaration of declarations) {
    if (declaration.getSourceFile().hasNoDefaultLib) return true;
    if (declaration.getSourceFile().fileName.endsWith("lib.d.ts")) return true;
  }
  return false;
};

const collectReferencedTypeSymbols = (
  typeNode: ts.Node,
  checker: ts.TypeChecker,
  out: Map<ts.Symbol, ts.Identifier>,
): void => {
  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node)) {
      const nameNode = node.typeName;
      const identifier = ts.isIdentifier(nameNode) ? nameNode : nameNode.right;
      const symbol = checker.getSymbolAtLocation(identifier);
      if (symbol) {
        const resolved =
          (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
        if (!out.has(resolved)) out.set(resolved, identifier);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(typeNode);
};

const collectSignatureTypeReferences = (
  declaration: ts.Declaration,
  checker: ts.TypeChecker,
): Map<ts.Symbol, ts.Identifier> => {
  const out = new Map<ts.Symbol, ts.Identifier>();

  if (ts.isFunctionLike(declaration)) {
    for (const parameter of declaration.parameters) {
      if (parameter.type) collectReferencedTypeSymbols(parameter.type, checker, out);
    }
    if (declaration.type) collectReferencedTypeSymbols(declaration.type, checker, out);
    return out;
  }

  if (ts.isVariableDeclaration(declaration)) {
    if (declaration.type) collectReferencedTypeSymbols(declaration.type, checker, out);
    if (declaration.initializer && ts.isArrowFunction(declaration.initializer)) {
      const arrowFn = declaration.initializer;
      for (const parameter of arrowFn.parameters) {
        if (parameter.type) collectReferencedTypeSymbols(parameter.type, checker, out);
      }
      if (arrowFn.type) collectReferencedTypeSymbols(arrowFn.type, checker, out);
    }
    return out;
  }

  if (ts.isClassDeclaration(declaration)) {
    if (declaration.heritageClauses) {
      for (const clause of declaration.heritageClauses) {
        for (const expressionWithTypeArguments of clause.types) {
          if (expressionWithTypeArguments.typeArguments) {
            for (const typeArgument of expressionWithTypeArguments.typeArguments) {
              collectReferencedTypeSymbols(typeArgument, checker, out);
            }
          }
        }
      }
    }
    for (const member of declaration.members) {
      if (ts.isPropertyDeclaration(member) && member.type) {
        collectReferencedTypeSymbols(member.type, checker, out);
      }
      if (
        (ts.isMethodDeclaration(member) ||
          ts.isGetAccessorDeclaration(member) ||
          ts.isSetAccessorDeclaration(member)) &&
        ts.canHaveModifiers(member)
      ) {
        const modifiers = ts.getModifiers(member);
        const isExposed = !modifiers?.some(
          (modifier) =>
            modifier.kind === ts.SyntaxKind.PrivateKeyword ||
            modifier.kind === ts.SyntaxKind.ProtectedKeyword,
        );
        if (!isExposed) continue;
        if (
          ts.isMethodDeclaration(member) ||
          ts.isGetAccessorDeclaration(member) ||
          ts.isSetAccessorDeclaration(member)
        ) {
          for (const parameter of member.parameters) {
            if (parameter.type) collectReferencedTypeSymbols(parameter.type, checker, out);
          }
          if (member.type) collectReferencedTypeSymbols(member.type, checker, out);
        }
      }
    }
  }

  return out;
};

const findLeakedDeclarationName = (
  symbol: ts.Symbol,
  exposedSymbols: Set<ts.Symbol>,
  checker: ts.TypeChecker,
): { name: string; path: string } | undefined => {
  if (exposedSymbols.has(symbol)) return undefined;
  if (isPrimitiveOrLib(symbol)) return undefined;
  if ((symbol.flags & ts.SymbolFlags.Type) === 0) return undefined;
  if ((symbol.flags & ts.SymbolFlags.TypeParameter) !== 0) return undefined;
  const declarations = symbol.declarations;
  if (!declarations || declarations.length === 0) return undefined;

  const firstDeclaration = declarations[0];
  if (isExternalTypeSymbol(firstDeclaration)) return undefined;

  const declaredName = ts.isInterfaceDeclaration(firstDeclaration)
    ? firstDeclaration.name.text
    : ts.isTypeAliasDeclaration(firstDeclaration)
      ? firstDeclaration.name.text
      : ts.isEnumDeclaration(firstDeclaration)
        ? firstDeclaration.name.text
        : symbol.getName();

  void checker;

  return {
    name: declaredName,
    path: firstDeclaration.getSourceFile().fileName,
  };
};

export const detectPrivateTypeLeaks = (
  graph: DependencyGraph,
  _config: DeslopConfig,
  context: SemanticContext,
): PrivateTypeLeak[] => {
  const exposedSymbols = collectEntryExportedSymbols(graph, context);
  if (exposedSymbols.size === 0) return [];

  const exportedValues = collectReachableExportedValues(graph, context);
  if (exportedValues.length === 0) return [];

  const leaks: PrivateTypeLeak[] = [];

  for (const exported of exportedValues) {
    const referenced = collectSignatureTypeReferences(exported.declaration, context.checker);
    for (const [typeSymbol, locationIdentifier] of referenced) {
      const leaked = findLeakedDeclarationName(typeSymbol, exposedSymbols, context.checker);
      if (!leaked) continue;

      const sourceFile = exported.declaration.getSourceFile();
      const lineAndChar = sourceFile.getLineAndCharacterOfPosition(
        locationIdentifier.getStart(sourceFile),
      );

      leaks.push({
        path: exported.modulePath,
        exportName: exported.exportName,
        leakedTypeName: leaked.name,
        leakedTypePath: leaked.path,
        line: lineAndChar.line + 1,
        column: lineAndChar.character,
        confidence: "high",
        reason: `exported value \`${exported.exportName}\` references unexported type \`${leaked.name}\``,
        trace: [
          `${exported.modulePath}: exports value \`${exported.exportName}\``,
          `signature references type \`${leaked.name}\` declared in ${leaked.path}`,
          "leaked type is not part of the entry's public surface",
        ].slice(0, SEMANTIC_TRACE_MAX_ENTRIES),
      });
    }
  }

  return leaks;
};
