import ts from "typescript";
import type { DependencyGraph, DeslopConfig, UnusedType } from "../types.js";
import { SEMANTIC_TRACE_MAX_ENTRIES } from "../constants.js";
import { lookupSourceFile } from "./program.js";
import type { SemanticContext } from "./program.js";
import { buildReferenceIndex } from "./utils/build-reference-index.js";

interface TypeCandidate {
  modulePath: string;
  exportName: string;
  line: number;
  column: number;
  isModuleEntry: boolean;
}

const collectModulesExposedViaWildcardReExport = (graph: DependencyGraph): Set<number> => {
  const exposedModuleIndices = new Set<number>();
  const visit = (moduleIndex: number, visited: Set<number>): void => {
    if (visited.has(moduleIndex)) return;
    visited.add(moduleIndex);
    for (const edge of graph.edges) {
      if (edge.source !== moduleIndex) continue;
      if (!edge.isReExportEdge) continue;
      if (!edge.reExportedNames.includes("*")) continue;
      exposedModuleIndices.add(edge.target);
      visit(edge.target, visited);
    }
  };
  for (const module of graph.modules) {
    if (!module.isEntryPoint) continue;
    visit(module.fileId.index, new Set());
  }
  return exposedModuleIndices;
};

const collectNamedReExportsFromEntries = (graph: DependencyGraph): Set<string> => {
  const exposed = new Set<string>();
  const visit = (moduleIndex: number, visited: Set<number>): void => {
    if (visited.has(moduleIndex)) return;
    visited.add(moduleIndex);
    const sourceModule = graph.modules[moduleIndex];
    if (!sourceModule) return;
    for (const edge of graph.edges) {
      if (edge.source !== moduleIndex) continue;
      if (!edge.isReExportEdge) continue;
      const targetModule = graph.modules[edge.target];
      if (!targetModule) continue;
      for (const mapping of edge.reExportMappings) {
        const originalName = mapping.originalName;
        if (originalName === "*") continue;
        exposed.add(`${targetModule.fileId.path}::${originalName}`);
      }
      visit(edge.target, visited);
    }
  };
  for (const module of graph.modules) {
    if (!module.isEntryPoint) continue;
    visit(module.fileId.index, new Set());
  }
  return exposed;
};

const collectTypeCandidates = (graph: DependencyGraph, config: DeslopConfig): TypeCandidate[] => {
  const candidates: TypeCandidate[] = [];
  const wildcardExposed = config.includeEntryExports
    ? new Set<number>()
    : collectModulesExposedViaWildcardReExport(graph);
  const namedExposed = config.includeEntryExports
    ? new Set<string>()
    : collectNamedReExportsFromEntries(graph);
  for (const module of graph.modules) {
    if (!module.isReachable) continue;
    if (module.isDeclarationFile) continue;
    if (module.isEntryPoint && !config.includeEntryExports) continue;
    if (!config.includeEntryExports && wildcardExposed.has(module.fileId.index)) continue;

    for (const exportInfo of module.exports) {
      if (exportInfo.isReExport) continue;
      if (exportInfo.isSynthetic) continue;
      if (!exportInfo.isTypeOnly) continue;
      if (exportInfo.isDefault) continue;

      if (
        !config.includeEntryExports &&
        namedExposed.has(`${module.fileId.path}::${exportInfo.name}`)
      ) {
        continue;
      }

      candidates.push({
        modulePath: module.fileId.path,
        exportName: exportInfo.name,
        line: exportInfo.line,
        column: exportInfo.column,
        isModuleEntry: module.isEntryPoint,
      });
    }
  }
  return candidates;
};

const lookupExportedSymbol = (
  context: SemanticContext,
  modulePath: string,
  exportName: string,
): { symbol: ts.Symbol; declaration: ts.Declaration; isInterface: boolean } | undefined => {
  const sourceFile = lookupSourceFile(context, modulePath);
  if (!sourceFile) return undefined;

  const moduleSymbol = context.checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) return undefined;

  const exportedSymbols = context.checker.getExportsOfModule(moduleSymbol);
  for (const exportedSymbol of exportedSymbols) {
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

export const detectUnusedTypes = (
  graph: DependencyGraph,
  config: DeslopConfig,
  context: SemanticContext,
): UnusedType[] => {
  const candidates = collectTypeCandidates(graph, config);
  if (candidates.length === 0) return [];

  const referenceIndex = buildReferenceIndex(context.program, context.checker);
  const unusedTypes: UnusedType[] = [];

  for (const candidate of candidates) {
    const lookup = lookupExportedSymbol(context, candidate.modulePath, candidate.exportName);
    if (!lookup) continue;

    const referenceSites = referenceIndex.get(lookup.symbol);
    const externalReferences = referenceSites.filter((site) => {
      if (site.isInsideDeclaration) return false;
      if (site.isInsideImportSpecifier) return false;
      if (site.isInsideExportSpecifier) return false;
      return true;
    });

    if (externalReferences.length > 0) continue;

    const trace: string[] = [
      `${candidate.modulePath}: declared ${lookup.isInterface ? "interface" : "type alias"} \`${candidate.exportName}\``,
      `0 non-declaration references across ${context.program.getSourceFiles().length} source files`,
    ];

    const importReferenceCount = referenceSites.filter(
      (site) => site.isInsideImportSpecifier || site.isInsideExportSpecifier,
    ).length;
    if (importReferenceCount > 0) {
      trace.push(`${importReferenceCount} import/export specifier mentions (no use sites)`);
    }

    unusedTypes.push({
      path: candidate.modulePath,
      name: candidate.exportName,
      line: candidate.line,
      column: candidate.column,
      kind: lookup.isInterface ? "interface" : "type-alias",
      confidence: "high",
      reason: "no non-declaration references found in TypeScript program",
      trace: trace.slice(0, SEMANTIC_TRACE_MAX_ENTRIES),
    });
  }

  return unusedTypes;
};
