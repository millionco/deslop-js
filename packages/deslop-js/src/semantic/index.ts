import type {
  DependencyGraph,
  DeslopConfig,
  MisclassifiedDependency,
  RedundantAlias,
  UnusedEnumMember,
  UnusedType,
} from "../types.js";
import { createSemanticContext } from "./program.js";
import { buildReferenceIndex } from "./references.js";
import { detectUnusedTypes } from "./unused-types.js";
import { detectUnusedEnumMembers } from "./unused-enum-members.js";
import { detectMisclassifiedDependencies } from "./misclassified-dependencies.js";
import { detectRedundantVariableAliases } from "./variable-aliases.js";

export interface SemanticAnalysisResult {
  unusedTypes: UnusedType[];
  unusedEnumMembers: UnusedEnumMember[];
  misclassifiedDependencies: MisclassifiedDependency[];
  redundantAliases: RedundantAlias[];
  contextStatus:
    | "disabled"
    | "ready"
    | "no-context-required"
    | "no-tsconfig"
    | "tsconfig-parse-error"
    | "program-creation-failed"
    | "too-many-files"
    | "typescript-load-failed";
  contextMessage?: string;
}

const EMPTY_RESULT: SemanticAnalysisResult = {
  unusedTypes: [],
  unusedEnumMembers: [],
  misclassifiedDependencies: [],
  redundantAliases: [],
  contextStatus: "disabled",
};

export const runSemanticAnalysis = (
  graph: DependencyGraph,
  config: DeslopConfig,
): SemanticAnalysisResult => {
  const semanticConfig = config.semantic;
  if (!semanticConfig?.enabled) return EMPTY_RESULT;

  const misclassifiedDependencies = semanticConfig.reportMisclassifiedDependencies
    ? detectMisclassifiedDependencies(graph, config)
    : [];

  const needsTsContext =
    semanticConfig.reportUnusedTypes ||
    semanticConfig.reportUnusedEnumMembers ||
    semanticConfig.reportRedundantVariableAliases;
  if (!needsTsContext) {
    return {
      unusedTypes: [],
      unusedEnumMembers: [],
      misclassifiedDependencies,
      redundantAliases: [],
      contextStatus: "no-context-required",
    };
  }

  const contextResult = createSemanticContext(config.rootDir, config.tsConfigPath);
  if (!contextResult.ok) {
    return {
      unusedTypes: [],
      unusedEnumMembers: [],
      misclassifiedDependencies,
      redundantAliases: [],
      contextStatus: contextResult.failure.reason,
      contextMessage: contextResult.failure.message,
    };
  }

  const { context } = contextResult;
  let referenceIndex: ReturnType<typeof buildReferenceIndex> | undefined;
  const getReferenceIndex = (): ReturnType<typeof buildReferenceIndex> => {
    if (!referenceIndex) {
      referenceIndex = buildReferenceIndex(context.program, context.checker);
    }
    return referenceIndex;
  };

  const unusedTypes = semanticConfig.reportUnusedTypes
    ? detectUnusedTypes(graph, config, context, getReferenceIndex())
    : [];
  const unusedEnumMembers = semanticConfig.reportUnusedEnumMembers
    ? detectUnusedEnumMembers(graph, config, context, getReferenceIndex())
    : [];
  const redundantAliases = semanticConfig.reportRedundantVariableAliases
    ? detectRedundantVariableAliases(graph, context, getReferenceIndex())
    : [];

  return {
    unusedTypes,
    unusedEnumMembers,
    misclassifiedDependencies,
    redundantAliases,
    contextStatus: "ready",
  };
};
