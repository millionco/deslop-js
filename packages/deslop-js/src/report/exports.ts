import type {
  DependencyGraph,
  SourceModule,
  ExportReference,
  UnusedExport,
  DeslopConfig,
  MemberAccess,
} from "../types.js";

const buildModuleImporterIndex = (
  graph: DependencyGraph,
): Map<number, { count: number; importerPaths: string[] }> => {
  const importerIndex = new Map<number, { count: number; importerPaths: string[] }>();
  for (const edge of graph.edges) {
    if (edge.isReExportEdge) continue;
    const existing = importerIndex.get(edge.target);
    const sourceModule = graph.modules[edge.source];
    const importerPath = sourceModule?.fileId.path;
    if (existing) {
      existing.count += 1;
      if (importerPath && !existing.importerPaths.includes(importerPath)) {
        existing.importerPaths.push(importerPath);
      }
    } else {
      importerIndex.set(edge.target, {
        count: 1,
        importerPaths: importerPath ? [importerPath] : [],
      });
    }
  }
  return importerIndex;
};

const explainDeadExport = (
  module: SourceModule,
  exportInfo: ExportReference,
  importerStats: { count: number; importerPaths: string[] } | undefined,
): { confidence: "high" | "medium" | "low"; reason: string; trace: string[] } => {
  const importerCount = importerStats?.count ?? 0;
  const importerPaths = importerStats?.importerPaths ?? [];

  let confidence: "high" | "medium" | "low";
  let reason: string;
  if (importerCount === 0) {
    confidence = "high";
    reason = `'${exportInfo.name}' exported from a reachable module that has no direct importers`;
  } else if (exportInfo.isTypeOnly) {
    confidence = "medium";
    reason = `type-only export '${exportInfo.name}' not referenced by any of ${importerCount} importer${importerCount === 1 ? "" : "s"}`;
  } else {
    confidence = "high";
    reason = `'${exportInfo.name}' not in any importer's named-import set across ${importerCount} importer${importerCount === 1 ? "" : "s"}`;
  }

  const trace = [
    `${module.fileId.path}: exports '${exportInfo.name}' at L${exportInfo.line}:${exportInfo.column}`,
    `${importerCount} importer${importerCount === 1 ? "" : "s"} of this module`,
    importerPaths.length > 0
      ? `sample importers: ${importerPaths.slice(0, 3).join(" | ")}`
      : "no importers reference this module",
  ];
  return { confidence, reason, trace };
};

export const detectDeadExports = (graph: DependencyGraph, config: DeslopConfig): UnusedExport[] => {
  const usageMap = buildUsageMap(graph);
  const importerIndex = buildModuleImporterIndex(graph);
  const unusedExports: UnusedExport[] = [];

  for (const module of graph.modules) {
    if (!module.isReachable) continue;
    if (module.isDeclarationFile) continue;
    if (module.isEntryPoint && !config.includeEntryExports) continue;

    const defaultExportLinkedNames = new Set<string>();
    for (const exportInfo of module.exports) {
      if (
        exportInfo.isDefault &&
        exportInfo.defaultExportLocalName &&
        usageMap.has(`${module.fileId.path}::default`)
      ) {
        defaultExportLinkedNames.add(exportInfo.defaultExportLocalName);
      }
    }

    for (const exportInfo of module.exports) {
      if (exportInfo.name === "*" && exportInfo.isNamespaceReExport) continue;
      if (exportInfo.isReExport && exportInfo.reExportOriginalName) continue;
      if (!config.reportTypes && exportInfo.isTypeOnly) continue;

      const usageKey = `${module.fileId.path}::${exportInfo.name}`;
      if (usageMap.has(usageKey)) continue;

      if (!exportInfo.isDefault && defaultExportLinkedNames.has(exportInfo.name)) {
        continue;
      }

      const explanation = explainDeadExport(
        module,
        exportInfo,
        importerIndex.get(module.fileId.index),
      );

      unusedExports.push({
        path: module.fileId.path,
        name: exportInfo.name,
        line: exportInfo.line,
        column: exportInfo.column,
        isTypeOnly: exportInfo.isTypeOnly,
        confidence: explanation.confidence,
        reason: explanation.reason,
        trace: explanation.trace,
      });
    }
  }

  return unusedExports;
};

const buildUsageMap = (graph: DependencyGraph): Set<string> => {
  const usedExportKeys = new Set<string>();
  const sourceToTargetMap = buildSourceToTargetsMap(graph);

  for (const module of graph.modules) {
    if (!module.isEntryPoint) continue;

    for (const edge of graph.edges) {
      if (edge.source !== module.fileId.index || !edge.isReExportEdge) continue;
      const targetModule = graph.modules[edge.target];
      if (!targetModule) continue;

      const isWildcardReExport = edge.reExportedNames.includes("*");
      if (isWildcardReExport) {
        markAllExportsUsedRecursive(
          targetModule,
          graph,
          sourceToTargetMap,
          usedExportKeys,
          new Set(),
        );
      } else {
        for (const mapping of edge.reExportMappings) {
          markExportUsedRecursive(
            targetModule.fileId.path,
            mapping.originalName,
            graph,
            sourceToTargetMap,
            usedExportKeys,
            new Set(),
          );
        }
      }
    }
  }

  for (const edge of graph.edges) {
    const targetModule = graph.modules[edge.target];
    if (!targetModule) continue;

    const sourceModule = graph.modules[edge.source];

    for (const symbol of edge.importedSymbols) {
      if (symbol.isNamespace) {
        handleNamespaceImport(
          sourceModule,
          targetModule,
          symbol.localName,
          graph,
          sourceToTargetMap,
          usedExportKeys,
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

const handleNamespaceImport = (
  sourceModule: SourceModule | undefined,
  targetModule: SourceModule,
  namespaceLocalName: string,
  graph: DependencyGraph,
  sourceToTargets: Map<number, number[]>,
  usedKeys: Set<string>,
): void => {
  if (!sourceModule) {
    markAllExportsUsedRecursive(targetModule, graph, sourceToTargets, usedKeys, new Set());
    return;
  }

  const isWholeObjectUse = sourceModule.wholeObjectUses.includes(namespaceLocalName);
  if (isWholeObjectUse) {
    markAllExportsUsedRecursive(targetModule, graph, sourceToTargets, usedKeys, new Set());
    return;
  }

  const accessedMemberNames = extractAccessedMemberNames(
    sourceModule.memberAccesses,
    namespaceLocalName,
  );

  const isNamespaceReExported = sourceModule.exports.some(
    (exportInfo) =>
      exportInfo.reExportOriginalName === namespaceLocalName ||
      (!exportInfo.isReExport && exportInfo.name === namespaceLocalName),
  );

  if (accessedMemberNames.length === 0 && !isNamespaceReExported) {
    markAllExportsUsedRecursive(targetModule, graph, sourceToTargets, usedKeys, new Set());
    return;
  }

  if (isNamespaceReExported && !sourceModule.isEntryPoint) {
    markAllExportsUsedRecursive(targetModule, graph, sourceToTargets, usedKeys, new Set());
    return;
  }

  for (const memberName of accessedMemberNames) {
    markExportUsedRecursive(
      targetModule.fileId.path,
      memberName,
      graph,
      sourceToTargets,
      usedKeys,
      new Set(),
    );
  }
};

const extractAccessedMemberNames = (
  memberAccesses: MemberAccess[],
  objectName: string,
): string[] => {
  const memberNames: string[] = [];
  const seenNames = new Set<string>();
  for (const access of memberAccesses) {
    if (access.objectName === objectName && !seenNames.has(access.memberName)) {
      seenNames.add(access.memberName);
      memberNames.push(access.memberName);
    }
  }
  return memberNames;
};

const buildSourceToTargetsMap = (graph: DependencyGraph): Map<number, number[]> => {
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
  module: SourceModule,
  graph: DependencyGraph,
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
  graph: DependencyGraph,
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
      followReExportChain(moduleIndex, exportInfo, graph, sourceToTargets, usedKeys, visited);
    }
  }
};

const followReExportChain = (
  reExporterModuleIndex: number,
  exportInfo: ExportReference,
  graph: DependencyGraph,
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
