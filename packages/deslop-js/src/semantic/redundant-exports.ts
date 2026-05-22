import ts from "typescript";
import type { DependencyGraph, DeslopConfig, RedundantExport } from "../types.js";
import { SEMANTIC_TRACE_MAX_ENTRIES } from "../constants.js";
import { lookupSourceFile, createSemanticContext } from "./program.js";

const SKIP_NAMES = new Set(["default", "*"]);

const isExternallyConsumed = (
  modulePath: string,
  exportName: string,
  reverseEdgesByTarget: Map<number, number[]>,
  graph: DependencyGraph,
): boolean => {
  const moduleIndex = graph.fileIdMap.get(modulePath);
  if (moduleIndex === undefined) return false;

  const importers = reverseEdgesByTarget.get(moduleIndex);
  if (!importers || importers.length === 0) return false;

  for (const edge of graph.edges) {
    if (edge.target !== moduleIndex) continue;
    if (edge.isReExportEdge) continue;
    const importer = graph.modules[edge.source];
    if (!importer) continue;
    for (const symbol of edge.importedSymbols) {
      if (symbol.isNamespace) return true;
      if (symbol.isDefault && exportName === "default") return true;
      if (symbol.importedName === exportName) return true;
    }
  }
  return false;
};

export const detectRedundantExports = (
  graph: DependencyGraph,
  config: DeslopConfig,
): RedundantExport[] => {
  if (!config.semantic.enabled) return [];
  if (!config.semantic.reportRedundantExports) return [];

  const semanticContext = createSemanticContext(graph, config);
  const symbolByExportLocation = new Map<string, ts.Symbol>();

  if (semanticContext) {
    for (const module of graph.modules) {
      if (module.isDeclarationFile) continue;
      const sourceFile = lookupSourceFile(semanticContext, module.fileId.path);
      if (!sourceFile) continue;
      const moduleSymbol = semanticContext.checker.getSymbolAtLocation(sourceFile);
      if (!moduleSymbol) continue;
      for (const exportedSymbol of semanticContext.checker.getExportsOfModule(moduleSymbol)) {
        const resolved =
          (exportedSymbol.flags & ts.SymbolFlags.Alias) !== 0
            ? semanticContext.checker.getAliasedSymbol(exportedSymbol)
            : exportedSymbol;
        symbolByExportLocation.set(`${module.fileId.path}::${exportedSymbol.getName()}`, resolved);
      }
    }
  }

  const pathsByExportName = new Map<string, Set<string>>();

  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;

    for (const exportInfo of module.exports) {
      if (SKIP_NAMES.has(exportInfo.name)) continue;
      if (exportInfo.isSynthetic) continue;
      if (exportInfo.isNamespaceReExport) continue;
      if (exportInfo.isReExport && !exportInfo.reExportSource) continue;
      const existing = pathsByExportName.get(exportInfo.name) ?? new Set<string>();
      existing.add(module.fileId.path);
      pathsByExportName.set(exportInfo.name, existing);
    }
  }

  const reverseEdgesByTarget = graph.reverseEdges;
  const findings: RedundantExport[] = [];

  for (const [exportName, pathSet] of pathsByExportName) {
    if (pathSet.size < 2) continue;

    let allSameSymbol = false;
    if (symbolByExportLocation.size > 0) {
      const distinctSymbols = new Set<ts.Symbol>();
      let allMapped = true;
      for (const modulePath of pathSet) {
        const symbol = symbolByExportLocation.get(`${modulePath}::${exportName}`);
        if (!symbol) {
          allMapped = false;
          break;
        }
        distinctSymbols.add(symbol);
      }
      if (allMapped) allSameSymbol = distinctSymbols.size < 2;
    }

    const consumedPaths: string[] = [];
    const unconsumedPaths: string[] = [];
    for (const modulePath of pathSet) {
      if (isExternallyConsumed(modulePath, exportName, reverseEdgesByTarget, graph)) {
        consumedPaths.push(modulePath);
      } else {
        unconsumedPaths.push(modulePath);
      }
    }

    if (allSameSymbol) {
      if (consumedPaths.length === 0) continue;
      if (unconsumedPaths.length === 0) continue;
      findings.push({
        name: exportName,
        paths: [...pathSet].sort(),
        confidence: "high",
        reason: `\`${exportName}\` re-exported from ${pathSet.size} sibling barrels; only ${consumedPaths.length} consumed externally — others are redundant aliases`,
        trace: [
          `same symbol exported from ${pathSet.size} modules (checker-confirmed)`,
          `consumed: ${consumedPaths.length}, unconsumed: ${unconsumedPaths.length}`,
          `redundant barrels: ${unconsumedPaths.slice(0, 3).join(" | ")}`,
        ].slice(0, SEMANTIC_TRACE_MAX_ENTRIES),
      });
      continue;
    }

    let confidence: RedundantExport["confidence"];
    if (consumedPaths.length === 0) confidence = "high";
    else if (unconsumedPaths.length > 0) confidence = "medium";
    else confidence = "low";

    findings.push({
      name: exportName,
      paths: [...pathSet].sort(),
      confidence,
      reason: `\`${exportName}\` is exported from ${pathSet.size} modules`,
      trace: [
        `${pathSet.size} modules export \`${exportName}\``,
        `consumed sites: ${consumedPaths.length}`,
        `unconsumed sites: ${unconsumedPaths.length}`,
        `paths: ${[...pathSet].sort().slice(0, 3).join(" | ")}`,
      ].slice(0, SEMANTIC_TRACE_MAX_ENTRIES),
    });
  }

  return findings;
};
