import { resolve } from "node:path";
import type { DeslopConfig, DeslopError, ScanResult } from "./types.js";
import { DetectorError, describeUnknownError } from "./errors.js";
import {
  DEFAULT_ENTRY_GLOBS,
  DEFAULT_EXTENSIONS,
  DEFAULT_SEMANTIC_DECORATOR_ALLOWLIST,
} from "./constants.js";
import { generateReport } from "./report/generate.js";
import { runReachabilityPipeline } from "./pipeline.js";

export type {
  ScanResult,
  DeslopConfig,
  UnusedFile,
  UnusedExport,
  UnusedDependency,
  CircularDependency,
  UnusedType,
  UnusedTypeKind,
  SemanticConfig,
  SemanticConfidence,
  MisclassifiedDependency,
  DependencyDeclaredAs,
  UnusedEnumMember,
  UnusedClassMember,
  ClassMemberKind,
  RedundantAlias,
  RedundantAliasKind,
  DuplicateExport,
  DuplicateExportOccurrence,
  DuplicateImport,
  DuplicateImportOccurrence,
  RedundantTypePattern,
  RedundantTypePatternKind,
  IdentityWrapper,
  DuplicateTypeDefinition,
  DuplicateTypeDefinitionInstance,
  DuplicateInlineType,
  InlineTypeOccurrence,
  InlineTypeContext,
  SimplifiableFunction,
  SimplifiableFunctionKind,
  SimplifiableExpression,
  SimplifiableExpressionKind,
  DuplicateConstant,
  DuplicateConstantOccurrence,
  DeslopError,
  DeslopErrorCode,
  DeslopErrorModule,
  DeslopErrorSeverity,
} from "./types.js";

export type {
  ProjectGraph,
  ProjectGraphNode,
  ProjectGraphEdge,
  ProjectGraphNodeClassification,
  ProjectGraphEdgeKind,
  ProjectGraphResult,
  CondensedProjectGraph,
  CondensedNode,
  CondensedEdge,
} from "./graph/project-graph.js";

export type { PruneOptions, PruneResult, PrunedIteration } from "./prune/prune.js";

export { getProjectGraph } from "./graph/project-graph.js";
export { condenseProjectGraph } from "./graph/condense.js";
export { projectGraphToJson, projectGraphToDot } from "./graph/serialize.js";
export { pruneUnusedFiles } from "./prune/prune.js";

/**
 * Default flags below mark rules off-by-default. Rationale for each:
 *
 * - `reportUnusedClassMembers: false` — class-member dead-code detection
 *   requires whole-program semantic analysis to be sound (subclass overrides,
 *   structural typing, framework method-by-name invocation like `@HttpGet`).
 *   When enabled on real React/Effect/NestJS codebases it produces a high
 *   rate of stylistic-FP findings (lifecycle methods, framework hooks). Off
 *   by default until the heuristics are tightened. Opt in via
 *   `semantic.reportUnusedClassMembers = true` when you accept the noise.
 *
 * - `reportTypes: false` — type-only exports are over-represented in
 *   barrel re-exports (the canonical `export type * from "./types"` pattern)
 *   and are rarely actionable signal. Off by default; opt in when auditing
 *   a type-heavy package.
 *
 * - `includeEntryExports: false` — exports from entry-point files are
 *   "API surface" and intentionally exported for external consumers; flagging
 *   them as "unused" is noise within a single repo scan. Opt in when auditing
 *   a package boundary (e.g. before deleting public APIs).
 *
 * - `reportRedundancy: true` — on because redundancy findings are mostly
 *   high-signal and the detectors carry their own confidence tiers.
 */
const fillSemanticConfig = (
  semanticOverrides: Partial<DeslopConfig["semantic"]> | undefined,
): DeslopConfig["semantic"] => {
  if (semanticOverrides === undefined) return undefined;
  return {
    enabled: semanticOverrides.enabled ?? false,
    reportUnusedTypes: semanticOverrides.reportUnusedTypes ?? true,
    reportUnusedEnumMembers: semanticOverrides.reportUnusedEnumMembers ?? true,
    reportUnusedClassMembers: semanticOverrides.reportUnusedClassMembers ?? false,
    reportRedundantVariableAliases: semanticOverrides.reportRedundantVariableAliases ?? true,
    reportMisclassifiedDependencies: semanticOverrides.reportMisclassifiedDependencies ?? true,
    reportRoundTripAliases: semanticOverrides.reportRoundTripAliases ?? true,
    decoratorAllowlist:
      semanticOverrides.decoratorAllowlist ?? DEFAULT_SEMANTIC_DECORATOR_ALLOWLIST,
  };
};

export const defineConfig = (
  options: Partial<DeslopConfig> & { rootDir: string },
): DeslopConfig => ({
  rootDir: resolve(options.rootDir),
  entryPatterns: options.entryPatterns ?? DEFAULT_ENTRY_GLOBS,
  ignorePatterns: options.ignorePatterns ?? [],
  includeExtensions: options.includeExtensions ?? DEFAULT_EXTENSIONS,
  tsConfigPath: options.tsConfigPath,
  reportTypes: options.reportTypes ?? false,
  includeEntryExports: options.includeEntryExports ?? false,
  reportRedundancy: options.reportRedundancy ?? true,
  semantic: fillSemanticConfig(options.semantic),
});

const buildEmptyScanResult = (errors: DeslopError[], elapsedMs: number): ScanResult => ({
  unusedFiles: [],
  unusedExports: [],
  unusedDependencies: [],
  circularDependencies: [],
  unusedTypes: [],
  misclassifiedDependencies: [],
  unusedEnumMembers: [],
  unusedClassMembers: [],
  redundantAliases: [],
  duplicateExports: [],
  duplicateImports: [],
  redundantTypePatterns: [],
  identityWrappers: [],
  duplicateTypeDefinitions: [],
  duplicateInlineTypes: [],
  simplifiableFunctions: [],
  simplifiableExpressions: [],
  duplicateConstants: [],
  analysisErrors: errors,
  totalFiles: 0,
  totalExports: 0,
  analysisTimeMs: elapsedMs,
});

export const analyze = async (config: DeslopConfig): Promise<ScanResult> => {
  const pipelineOutcome = await runReachabilityPipeline(config);

  if (pipelineOutcome.isFatal || !pipelineOutcome.moduleGraph) {
    return buildEmptyScanResult(
      pipelineOutcome.setupErrors,
      performance.now() - pipelineOutcome.pipelineStartTime,
    );
  }

  let analysisResult: ScanResult;
  try {
    analysisResult = generateReport(pipelineOutcome.moduleGraph, config);
  } catch (reportError) {
    const setupErrors = [
      ...pipelineOutcome.setupErrors,
      new DetectorError({
        module: "report",
        severity: "fatal",
        message: "generateReport threw at the top level",
        detail: describeUnknownError(reportError),
      }),
    ];
    return buildEmptyScanResult(setupErrors, performance.now() - pipelineOutcome.pipelineStartTime);
  }

  if (pipelineOutcome.setupErrors.length > 0) {
    analysisResult.analysisErrors = [
      ...pipelineOutcome.setupErrors,
      ...analysisResult.analysisErrors,
    ];
  }
  analysisResult.analysisTimeMs = performance.now() - pipelineOutcome.pipelineStartTime;

  return analysisResult;
};
