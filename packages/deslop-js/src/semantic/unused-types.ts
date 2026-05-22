import type { DependencyGraph, DeslopConfig, UnusedType } from "../types.js";
import type { SemanticContext } from "./program.js";

export const detectUnusedTypes = (
  _graph: DependencyGraph,
  _config: DeslopConfig,
  _context: SemanticContext,
): UnusedType[] => {
  return [];
};
