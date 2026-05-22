import type {
  DependencyGraph,
  DeslopConfig,
  DeslopError,
  MisclassifiedDependency,
  RedundantAlias,
  UnusedClassMember,
  UnusedEnumMember,
  UnusedType,
} from "../types.js";
import { DetectorError, TypeScriptError, describeUnknownError } from "../errors.js";
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
  errors: DeslopError[];
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
  errors: [],
  contextStatus: "disabled",
};

export const runSemanticAnalysis = (
  graph: DependencyGraph,
  config: DeslopConfig,
): SemanticAnalysisResult => {
  const semanticConfig = config.semantic;
  if (!semanticConfig?.enabled) return EMPTY_RESULT;

  const errors: DeslopError[] = [];

  const safeDetector = <ResultType>(
    detectorName: string,
    detector: () => ResultType,
    fallback: ResultType,
  ): ResultType => {
    try {
      return detector();
    } catch (detectorError) {
      errors.push(
        new DetectorError({
          module: "semantic",
          message: `${detectorName} threw during semantic analysis`,
          detail: describeUnknownError(detectorError),
        }),
      );
      return fallback;
    }
  };

  const misclassifiedDependencies = semanticConfig.reportMisclassifiedDependencies
    ? safeDetector("detectMisclassifiedDependencies", () => detectMisclassifiedDependencies(graph, config), [])
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
      errors,
      contextStatus: "no-context-required",
    };
  }

  let contextResult: ReturnType<typeof createSemanticContext>;
  try {
    contextResult = createSemanticContext(config.rootDir, config.tsConfigPath);
  } catch (contextError) {
    return {
      unusedTypes: [],
      unusedEnumMembers: [],
      unusedClassMembers: [],
      misclassifiedDependencies,
      redundantAliases: [],
      errors: [
        ...errors,
        new TypeScriptError({
          code: "ts-not-loadable",
          message: "createSemanticContext threw before returning a result",
          detail: describeUnknownError(contextError),
        }),
      ],
      contextStatus: "typescript-load-failed",
    };
  }

  if (!contextResult.ok) {
    return {
      unusedTypes: [],
      unusedEnumMembers: [],
      unusedClassMembers: [],
      misclassifiedDependencies,
      redundantAliases: [],
      errors: [...errors, contextResult.failure.error],
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
    ? safeDetector("detectUnusedTypes", () => detectUnusedTypes(graph, config, context, getReferenceIndex()), [])
    : [];
  const unusedEnumMembers = semanticConfig.reportUnusedEnumMembers
    ? safeDetector(
        "detectUnusedEnumMembers",
        () => detectUnusedEnumMembers(graph, config, context, getReferenceIndex()),
        [],
      )
    : [];
  const unusedClassMembers = semanticConfig.reportUnusedClassMembers
    ? safeDetector(
        "detectUnusedClassMembers",
        () =>
          detectUnusedClassMembers(
            graph,
            config,
            context,
            getReferenceIndex(),
            semanticConfig.decoratorAllowlist,
          ),
        [],
      )
    : [];
  const variableAliases = semanticConfig.reportRedundantVariableAliases
    ? safeDetector(
        "detectRedundantVariableAliases",
        () => detectRedundantVariableAliases(graph, context, getReferenceIndex()),
        [],
      )
    : [];
  const roundTripAliases = semanticConfig.reportRoundTripAliases
    ? safeDetector("detectRoundTripAliases", () => detectRoundTripAliases(graph, context), [])
    : [];

  return {
    unusedTypes,
    unusedEnumMembers,
    unusedClassMembers,
    misclassifiedDependencies,
    redundantAliases: [...variableAliases, ...roundTripAliases],
    errors,
    contextStatus: "ready",
  };
};
