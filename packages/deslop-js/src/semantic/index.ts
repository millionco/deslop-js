import type { DependencyGraph, DeslopConfig, UnusedType } from "../types.js";
import { createSemanticContext } from "./program.js";
import { detectUnusedTypes } from "./unused-types.js";

export interface SemanticAnalysisResult {
  unusedTypes: UnusedType[];
}

export const runSemanticAnalysis = (
  graph: DependencyGraph,
  config: DeslopConfig,
): SemanticAnalysisResult => {
  const emptyResult: SemanticAnalysisResult = { unusedTypes: [] };

  if (!config.semantic.enabled) return emptyResult;

  const semanticContext = createSemanticContext(graph, config);
  if (!semanticContext) return emptyResult;

  const unusedTypes = config.semantic.reportUnusedTypes
    ? detectUnusedTypes(graph, config, semanticContext)
    : [];

  return { unusedTypes };
};
