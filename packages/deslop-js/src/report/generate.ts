import type { DeslopConfig, DependencyGraph, ScanResult } from "../types.js";
import { detectOrphanFiles } from "./files.js";
import { detectDeadExports } from "./exports.js";
import { detectStalePackages } from "./packages.js";
import { detectCycles } from "./cycles.js";
import {
  detectRedundantAliases,
  detectDuplicateExports,
  detectUselessAliasedReExports,
} from "./redundancy.js";
import {
  detectDuplicateImports,
  detectRedundantTypePatterns,
  detectIdentityWrappers,
  detectDuplicateTypeDefinitions,
  detectDuplicateInlineTypes,
} from "./dry-patterns.js";
import { runSemanticAnalysis } from "../semantic/index.js";

export const generateReport = (graph: DependencyGraph, config: DeslopConfig): ScanResult => {
  const analysisStartTime = performance.now();

  const unusedFiles = detectOrphanFiles(graph);
  const unusedExports = detectDeadExports(graph, config);
  const unusedDependencies = detectStalePackages(graph, config);
  const circularDependencies = detectCycles(graph);
  const syntacticRedundantAliases = config.reportRedundancy
    ? [...detectRedundantAliases(graph), ...detectUselessAliasedReExports(graph)]
    : [];
  const duplicateExports = config.reportRedundancy ? detectDuplicateExports(graph) : [];
  const duplicateImports = config.reportRedundancy ? detectDuplicateImports(graph) : [];
  const redundantTypePatterns = config.reportRedundancy ? detectRedundantTypePatterns(graph) : [];
  const identityWrappers = config.reportRedundancy ? detectIdentityWrappers(graph) : [];
  const duplicateTypeDefinitions = config.reportRedundancy
    ? detectDuplicateTypeDefinitions(graph)
    : [];
  const duplicateInlineTypes = config.reportRedundancy ? detectDuplicateInlineTypes(graph) : [];

  const semanticResult = runSemanticAnalysis(graph, config);

  const redundantAliases = config.reportRedundancy
    ? [...syntacticRedundantAliases, ...semanticResult.redundantAliases]
    : [];

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
    misclassifiedDependencies: semanticResult.misclassifiedDependencies,
    unusedEnumMembers: semanticResult.unusedEnumMembers,
    unusedClassMembers: semanticResult.unusedClassMembers,
    redundantAliases,
    duplicateExports,
    duplicateImports,
    redundantTypePatterns,
    identityWrappers,
    duplicateTypeDefinitions,
    duplicateInlineTypes,
    totalFiles: graph.modules.length,
    totalExports,
    analysisTimeMs: performance.now() - analysisStartTime,
  };
};
