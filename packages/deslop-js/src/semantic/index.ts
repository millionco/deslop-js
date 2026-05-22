import type {
  DependencyGraph,
  DeslopConfig,
  MisclassifiedDependency,
  RedundantAlias,
  UnusedClassMember,
  UnusedEnumMember,
  UnusedType,
} from "../types.js";
import { createSemanticContext } from "./program.js";
import { buildReferenceIndex } from "./references.js";
import { detectUnusedTypes } from "./unused-types.js";
import { detectUnusedEnumMembers } from "./unused-enum-members.js";
import { detectUnusedClassMembers } from "./unused-class-members.js";
import { detectMisclassifiedDependencies } from "./misclassified-dependencies.js";
import { detectRedundantVariableAliases } from "./variable-aliases.js";
import { detectRoundTripAliases } from "./redundant-reexports.js";

export interface SemanticAnalysisResult {
  unusedTypes: UnusedType[];
  unusedEnumMembers: UnusedEnumMember[];
  unusedClassMembers: UnusedClassMember[];
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
  unusedClassMembers: [],
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
    semanticConfig.reportUnusedClassMembers ||
    semanticConfig.reportRedundantVariableAliases ||
    semanticConfig.reportRoundTripAliases;
  if (!needsTsContext) {
    return {
      unusedTypes: [],
      unusedEnumMembers: [],
      unusedClassMembers: [],
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
      unusedClassMembers: [],
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
  const unusedClassMembers = semanticConfig.reportUnusedClassMembers
    ? detectUnusedClassMembers(
        graph,
        config,
        context,
        getReferenceIndex(),
        semanticConfig.decoratorAllowlist,
      )
    : [];
  const variableAliases = semanticConfig.reportRedundantVariableAliases
    ? detectRedundantVariableAliases(graph, context, getReferenceIndex())
    : [];
  const roundTripAliases = semanticConfig.reportRoundTripAliases
    ? detectRoundTripAliases(graph, context)
    : [];

  return {
    unusedTypes,
    unusedEnumMembers,
    unusedClassMembers,
    misclassifiedDependencies,
    redundantAliases: [...variableAliases, ...roundTripAliases],
    contextStatus: "ready",
  };
};
