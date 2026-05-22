import type { DependencyGraph, DeslopConfig, UnusedEnumMember, UnusedType } from "../types.js";
import { createSemanticContext } from "./program.js";
import { detectUnusedTypes } from "./unused-types.js";
import { detectUnusedEnumMembers } from "./unused-enum-members.js";

export interface SemanticAnalysisResult {
  unusedTypes: UnusedType[];
  unusedEnumMembers: UnusedEnumMember[];
}

export const runSemanticAnalysis = (
  graph: DependencyGraph,
  config: DeslopConfig,
): SemanticAnalysisResult => {
  const emptyResult: SemanticAnalysisResult = {
    unusedTypes: [],
    unusedEnumMembers: [],
  };

  if (!config.semantic.enabled) return emptyResult;

  const semanticContext = createSemanticContext(graph, config);
  if (!semanticContext) return emptyResult;

  const unusedTypes = config.semantic.reportUnusedTypes
    ? detectUnusedTypes(graph, config, semanticContext)
    : [];

  const unusedEnumMembers = config.semantic.reportUnusedEnumMembers
    ? detectUnusedEnumMembers(graph, config, semanticContext)
    : [];

  return { unusedTypes, unusedEnumMembers };
};
