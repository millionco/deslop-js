import type { ModuleGraph, UnusedFile, ModuleNode } from "../types.js";

const isHtmlFile = (filePath: string): boolean => {
  return filePath.endsWith(".html");
};

export const findUnusedFiles = (graph: ModuleGraph): UnusedFile[] => {
  const unusedFiles: UnusedFile[] = [];

  for (const module of graph.modules) {
    if (module.isReachable) continue;
    if (module.isEntryPoint) continue;
    if (module.isDeclarationFile) continue;
    if (module.isConfigFile) continue;
    if (isHtmlFile(module.fileId.path)) continue;
    if (isBarrelWithReachableSources(module, graph)) continue;
    if (hasReachableDirectImporter(module.fileId.index, graph)) continue;

    unusedFiles.push({ path: module.fileId.path });
  }

  return unusedFiles;
};

const isBarrelWithReachableSources = (
  module: ModuleNode,
  graph: ModuleGraph,
): boolean => {
  const hasOnlyReExports =
    module.exports.length > 0 &&
    module.exports.every((exportInfo) => exportInfo.isReExport);
  if (!hasOnlyReExports) return false;

  for (const edge of graph.edges) {
    if (edge.source === module.fileId.index) {
      const targetModule = graph.modules[edge.target];
      if (targetModule?.isReachable) return true;
    }
  }

  return false;
};

const hasReachableDirectImporter = (
  targetModuleIndex: number,
  graph: ModuleGraph,
): boolean => {
  for (const edge of graph.edges) {
    if (edge.target !== targetModuleIndex) continue;
    if (edge.isReExportEdge) continue;
    const importerModule = graph.modules[edge.source];
    if (importerModule?.isReachable) return true;
  }
  return false;
};
