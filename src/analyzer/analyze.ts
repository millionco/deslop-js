import type { DeslopConfig, ModuleGraph, AnalysisResult } from "../types.js";
import { findUnusedFiles } from "./unused-files.js";
import { findUnusedExports } from "./unused-exports.js";
import { findUnusedDependencies } from "./unused-dependencies.js";

export const analyzeGraph = (
  graph: ModuleGraph,
  config: DeslopConfig,
): AnalysisResult => {
  const analysisStartTime = performance.now();

  const unusedFiles = findUnusedFiles(graph);
  const unusedExports = findUnusedExports(graph, config);
  const unusedDependencies = findUnusedDependencies(graph, config);

  const totalExports = graph.modules.reduce(
    (exportCount, module) =>
      exportCount +
      module.exports.filter(
        (exportInfo) => !(exportInfo.name === "*" && exportInfo.isNamespaceReExport),
      ).length,
    0,
  );

  return {
    unusedFiles,
    unusedExports,
    unusedDependencies,
    totalFiles: graph.modules.length,
    totalExports,
    analysisTimeMs: performance.now() - analysisStartTime,
  };
};
