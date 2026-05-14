import type { ModuleGraph, ModuleNode, ExportInfo, UnusedExport, DeslopConfig } from "../types.js";

export const findUnusedExports = (
  graph: ModuleGraph,
  config: DeslopConfig,
): UnusedExport[] => {
  const usageMap = buildUsageMap(graph);
  const unusedExports: UnusedExport[] = [];

  for (const module of graph.modules) {
    if (!module.isReachable) continue;
    if (module.isDeclarationFile) continue;
    if (module.isConfigFile) continue;
    if (module.isEntryPoint && !config.includeEntryExports) continue;

    for (const exportInfo of module.exports) {
      if (exportInfo.name === "*" && exportInfo.isNamespaceReExport) continue;
      if (exportInfo.isReExport && exportInfo.reExportOriginalName) continue;
      if (!config.reportTypes && exportInfo.isTypeOnly) continue;

      const usageKey = `${module.fileId.path}::${exportInfo.name}`;
      if (!usageMap.has(usageKey)) {
        unusedExports.push({
          path: module.fileId.path,
          name: exportInfo.name,
          line: exportInfo.line,
          column: exportInfo.column,
          isTypeOnly: exportInfo.isTypeOnly,
        });
      }
    }
  }

  return unusedExports;
};

const buildUsageMap = (graph: ModuleGraph): Set<string> => {
  const usedExportKeys = new Set<string>();
  const sourceToTargetMap = buildSourceToTargetsMap(graph);

  for (const edge of graph.edges) {
    const targetModule = graph.modules[edge.target];
    if (!targetModule) continue;

    for (const symbol of edge.importedSymbols) {
      if (symbol.isNamespace) {
        markAllExportsUsedRecursive(
          targetModule,
          graph,
          sourceToTargetMap,
          usedExportKeys,
          new Set(),
        );
      } else {
        const importName = symbol.isDefault ? "default" : symbol.importedName;
        markExportUsedRecursive(
          targetModule.fileId.path,
          importName,
          graph,
          sourceToTargetMap,
          usedExportKeys,
          new Set(),
        );
      }
    }
  }

  return usedExportKeys;
};

const buildSourceToTargetsMap = (
  graph: ModuleGraph,
): Map<number, number[]> => {
  const sourceToTargets = new Map<number, number[]>();

  for (const edge of graph.edges) {
    const existing = sourceToTargets.get(edge.source);
    if (existing) {
      if (!existing.includes(edge.target)) {
        existing.push(edge.target);
      }
    } else {
      sourceToTargets.set(edge.source, [edge.target]);
    }
  }

  return sourceToTargets;
};

const markAllExportsUsedRecursive = (
  module: ModuleNode,
  graph: ModuleGraph,
  sourceToTargets: Map<number, number[]>,
  usedKeys: Set<string>,
  visited: Set<string>,
): void => {
  const visitKey = `all::${module.fileId.path}`;
  if (visited.has(visitKey)) return;
  visited.add(visitKey);

  for (const exportInfo of module.exports) {
    if (exportInfo.name === "*" && exportInfo.isNamespaceReExport) continue;

    const usageKey = `${module.fileId.path}::${exportInfo.name}`;
    usedKeys.add(usageKey);

    if (exportInfo.isReExport && exportInfo.reExportSource) {
      followReExportChain(
        module.fileId.index,
        exportInfo,
        graph,
        sourceToTargets,
        usedKeys,
        visited,
      );
    }
  }
};

const markExportUsedRecursive = (
  filePath: string,
  exportName: string,
  graph: ModuleGraph,
  sourceToTargets: Map<number, number[]>,
  usedKeys: Set<string>,
  visited: Set<string>,
): void => {
  const visitKey = `${filePath}::${exportName}`;
  if (visited.has(visitKey)) return;
  visited.add(visitKey);

  usedKeys.add(visitKey);

  const moduleIndex = graph.fileIdMap.get(filePath);
  if (moduleIndex === undefined) return;

  const module = graph.modules[moduleIndex];
  if (!module) return;

  for (const exportInfo of module.exports) {
    if (exportInfo.name !== exportName) continue;

    if (exportInfo.isReExport && exportInfo.reExportSource) {
      followReExportChain(
        moduleIndex,
        exportInfo,
        graph,
        sourceToTargets,
        usedKeys,
        visited,
      );
    }
  }
};

const followReExportChain = (
  reExporterModuleIndex: number,
  exportInfo: ExportInfo,
  graph: ModuleGraph,
  sourceToTargets: Map<number, number[]>,
  usedKeys: Set<string>,
  visited: Set<string>,
): void => {
  const targetIndices = sourceToTargets.get(reExporterModuleIndex);
  if (!targetIndices) return;

  const originalName = exportInfo.reExportOriginalName ?? exportInfo.name;

  for (const targetIndex of targetIndices) {
    const targetModule = graph.modules[targetIndex];
    if (!targetModule) continue;

    if (originalName === "*" || exportInfo.isNamespaceReExport) {
      markExportUsedRecursive(
        targetModule.fileId.path,
        exportInfo.name,
        graph,
        sourceToTargets,
        usedKeys,
        visited,
      );
    } else {
      const targetHasExport = targetModule.exports.some(
        (targetExport) =>
          targetExport.name === originalName ||
          (targetExport.isNamespaceReExport && targetExport.name === "*"),
      );

      if (targetHasExport) {
        markExportUsedRecursive(
          targetModule.fileId.path,
          originalName,
          graph,
          sourceToTargets,
          usedKeys,
          visited,
        );
      }
    }
  }
};
