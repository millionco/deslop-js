import type { DeslopConfig, DependencyGraph, ScanResult } from "../types.js";
import { detectOrphanFiles } from "./files.js";
import { detectDeadExports } from "./exports.js";
import { detectStalePackages } from "./packages.js";
import { detectCycles } from "./cycles.js";

export const generateReport = (graph: DependencyGraph, config: DeslopConfig): ScanResult => {
  const analysisStartTime = performance.now();

  const unusedFiles = detectOrphanFiles(graph);
  const unusedExports = detectDeadExports(graph, config);
  const unusedDependencies = detectStalePackages(graph, config);
  const circularDependencies = detectCycles(graph);

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
    circularDependencies,
    totalFiles: graph.modules.length,
    totalExports,
    analysisTimeMs: performance.now() - analysisStartTime,
  };
};
