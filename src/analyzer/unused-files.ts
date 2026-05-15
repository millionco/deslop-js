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
    if (hasReachableImporter(module.fileId.index, graph)) continue;

    unusedFiles.push({ path: module.fileId.path });
  }

  return unusedFiles;
};

const isBarrelWithReachableSources = (
  module: ModuleNode,
  graph: ModuleGraph,
): boolean => {
  const fileName = module.fileId.path.split("/").pop() ?? "";
  if (!fileName.startsWith("index.")) return false;

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

const hasReachableImporter = (
  targetModuleIndex: number,
  graph: ModuleGraph,
): boolean => {
  const importerIndices = graph.reverseEdges.get(targetModuleIndex);
  if (!importerIndices) return false;

  return importerIndices.some((importerIndex) => {
    const importerModule = graph.modules[importerIndex];
    return importerModule?.isReachable;
  });
};
