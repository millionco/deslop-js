import type {
  DependencyGraph,
  DeslopConfig,
  DuplicateTypeDefinition,
  MisclassifiedDependency,
  PrivateTypeLeak,
  UnusedClassMember,
  UnusedEnumMember,
  UnusedParameter,
  UnusedType,
} from "../types.js";
import { createSemanticContext } from "./program.js";
import { detectUnusedTypes } from "./unused-types.js";
import { detectUnusedEnumMembers } from "./unused-enum-members.js";
import { detectUnusedClassMembers } from "./unused-class-members.js";
import { detectPrivateTypeLeaks } from "./private-type-leaks.js";
import { detectUnusedParameters } from "./unused-parameters.js";
import { detectDuplicateTypeDefinitions } from "./duplicate-types.js";
import { detectMisclassifiedDependencies as detectMisclassifiedDependenciesSemantic } from "./misclassified-dependencies.js";
import { SEMANTIC_PROGRAM_BUDGET_MS } from "../constants.js";

export interface SemanticAnalysisResult {
  unusedTypes: UnusedType[];
  unusedEnumMembers: UnusedEnumMember[];
  unusedClassMembers: UnusedClassMember[];
  privateTypeLeaks: PrivateTypeLeak[];
  unusedParameters: UnusedParameter[];
  duplicateTypeDefinitions: DuplicateTypeDefinition[];
  misclassifiedDependencies: MisclassifiedDependency[];
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
    unusedParameters: [],
    duplicateTypeDefinitions: [],
    misclassifiedDependencies: [],
  };

  if (!config.semantic.enabled) return emptyResult;

  const semanticPassStartTime = performance.now();
  const semanticContext = createSemanticContext(graph, config);
  const misclassifiedDependencies = config.semantic.reportMisclassifiedDependencies
    ? detectMisclassifiedDependenciesSemantic(graph, config, semanticContext)
    : [];

  if (!semanticContext) {
    return { ...emptyResult, misclassifiedDependencies };
  }

  const withinBudget = (): boolean =>
    performance.now() - semanticPassStartTime < SEMANTIC_PROGRAM_BUDGET_MS;

  const unusedTypes = config.semantic.reportUnusedTypes && withinBudget()
    ? detectUnusedTypes(graph, config, semanticContext)
    : [];

  const unusedEnumMembers = config.semantic.reportUnusedEnumMembers && withinBudget()
    ? detectUnusedEnumMembers(graph, config, semanticContext)
    : [];

  const unusedClassMembers = config.semantic.reportUnusedClassMembers && withinBudget()
    ? detectUnusedClassMembers(graph, config, semanticContext)
    : [];

  const privateTypeLeaks = config.semantic.reportPrivateTypeLeaks && withinBudget()
    ? detectPrivateTypeLeaks(graph, config, semanticContext)
    : [];

  const unusedParameters = config.semantic.reportUnusedParameters && withinBudget()
    ? detectUnusedParameters(graph, config, semanticContext)
    : [];

  const duplicateTypeDefinitions = config.semantic.reportDuplicateTypeDefinitions && withinBudget()
    ? detectDuplicateTypeDefinitions(graph, config, semanticContext)
    : [];

  return {
    unusedTypes,
    unusedEnumMembers,
    unusedClassMembers,
    privateTypeLeaks,
    unusedParameters,
    duplicateTypeDefinitions,
    misclassifiedDependencies,
  };
};
