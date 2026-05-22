import type {
  DependencyGraph,
  DeslopConfig,
  UnusedClassMember,
  UnusedEnumMember,
  UnusedType,
} from "../types.js";
import { createSemanticContext } from "./program.js";
import { detectUnusedTypes } from "./unused-types.js";
import { detectUnusedEnumMembers } from "./unused-enum-members.js";
import { detectUnusedClassMembers } from "./unused-class-members.js";

export interface SemanticAnalysisResult {
  unusedTypes: UnusedType[];
  unusedEnumMembers: UnusedEnumMember[];
  unusedClassMembers: UnusedClassMember[];
}

export const runSemanticAnalysis = (
  graph: DependencyGraph,
  config: DeslopConfig,
): SemanticAnalysisResult => {
  const emptyResult: SemanticAnalysisResult = {
    unusedTypes: [],
    unusedEnumMembers: [],
    unusedClassMembers: [],
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

  const unusedClassMembers = config.semantic.reportUnusedClassMembers
    ? detectUnusedClassMembers(graph, config, semanticContext)
    : [];

  return { unusedTypes, unusedEnumMembers, unusedClassMembers };
};
