import type { DependencyGraph, DeslopConfig, UnusedType } from "../types.js";
import { createSemanticContext } from "./program.js";

export interface SemanticAnalysisResult {
  unusedTypes: UnusedType[];
  contextStatus:
    | "disabled"
    | "ready"
    | "no-tsconfig"
    | "tsconfig-parse-error"
    | "program-creation-failed"
    | "too-many-files"
    | "typescript-load-failed";
  contextMessage?: string;
}

const EMPTY_RESULT: SemanticAnalysisResult = {
  unusedTypes: [],
  contextStatus: "disabled",
};

export const runSemanticAnalysis = (
  graph: DependencyGraph,
  config: DeslopConfig,
): SemanticAnalysisResult => {
  const semanticConfig = config.semantic;
  if (!semanticConfig?.enabled) return EMPTY_RESULT;

  const contextResult = createSemanticContext(config.rootDir, config.tsConfigPath);
  if (!contextResult.ok) {
    return {
      unusedTypes: [],
      contextStatus: contextResult.failure.reason,
      contextMessage: contextResult.failure.message,
    };
  }

  void graph;

  return {
    unusedTypes: [],
    contextStatus: "ready",
  };
};
