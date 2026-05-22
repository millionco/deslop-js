import type { DeslopConfig, DependencyGraph, ScanResult } from "../types.js";
import { detectOrphanFiles } from "./files.js";
import { detectDeadExports } from "./exports.js";
import { detectStalePackages } from "./packages.js";
import { detectCycles } from "./cycles.js";
import { detectRedundantExports } from "./redundant.js";
import { runSemanticAnalysis } from "../semantic/index.js";

export const generateReport = (graph: DependencyGraph, config: DeslopConfig): ScanResult => {
  const analysisStartTime = performance.now();

  const unusedFiles = detectOrphanFiles(graph);
  const unusedExports = detectDeadExports(graph, config);
  const unusedDependencies = detectStalePackages(graph, config);
  const circularDependencies = detectCycles(graph);
  const redundantExports = detectRedundantExports(graph, config);
  const semanticResult = runSemanticAnalysis(graph, config);

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
    unusedTypes: semanticResult.unusedTypes,
    unusedEnumMembers: semanticResult.unusedEnumMembers,
    unusedClassMembers: semanticResult.unusedClassMembers,
    privateTypeLeaks: semanticResult.privateTypeLeaks,
    redundantExports,
    totalFiles: graph.modules.length,
    totalExports,
    analysisTimeMs: performance.now() - analysisStartTime,
  };
};
