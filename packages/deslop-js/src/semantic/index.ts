import type {
  DependencyGraph,
  DeslopConfig,
  PrivateTypeLeak,
  UnusedClassMember,
  UnusedEnumMember,
  UnusedType,
} from "../types.js";
import { createSemanticContext } from "./program.js";
import { detectUnusedTypes } from "./unused-types.js";
import { detectUnusedEnumMembers } from "./unused-enum-members.js";
import { detectUnusedClassMembers } from "./unused-class-members.js";
import { detectPrivateTypeLeaks } from "./private-type-leaks.js";

export interface SemanticAnalysisResult {
  unusedTypes: UnusedType[];
  unusedEnumMembers: UnusedEnumMember[];
  unusedClassMembers: UnusedClassMember[];
  privateTypeLeaks: PrivateTypeLeak[];
}

export const runSemanticAnalysis = (
  graph: DependencyGraph,
  config: DeslopConfig,
): SemanticAnalysisResult => {
  const emptyResult: SemanticAnalysisResult = {
    unusedTypes: [],
    unusedEnumMembers: [],
    unusedClassMembers: [],
    privateTypeLeaks: [],
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

  const privateTypeLeaks = config.semantic.reportPrivateTypeLeaks
    ? detectPrivateTypeLeaks(graph, config, semanticContext)
    : [];

  return { unusedTypes, unusedEnumMembers, unusedClassMembers, privateTypeLeaks };
};
