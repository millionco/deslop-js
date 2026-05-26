import { rmSync } from "node:fs";
import type { DeslopConfig, DeslopError } from "../types.js";
import { analyze } from "../index.js";
import { DEFAULT_PRUNE_MAX_ITERATIONS } from "../constants.js";

export interface PruneOptions {
  dryRun?: boolean;
  maxIterations?: number;
  onIteration?: (iteration: PrunedIteration) => void;
}

export interface PrunedIteration {
  iteration: number;
  deletedFiles: string[];
  totalFilesBefore: number;
  unusedFilesFound: number;
  elapsedMs: number;
  errors: DeslopError[];
}

export interface PruneResult {
  iterations: PrunedIteration[];
  deletedFiles: string[];
  dryRun: boolean;
  converged: boolean;
  totalElapsedMs: number;
}

/**
 * Iteratively deletes the unreachable nodes (`unusedFiles`) reported by
 * `analyze()`. After each deletion pass the analyzer is re-run so the
 * dependency graph is rebuilt from the smaller file set; this exposes
 * second-order orphans — modules that were only kept alive by re-exports
 * inside files we just removed — and so on, until the report stabilises
 * or `maxIterations` is reached.
 *
 * Set `dryRun: true` to compute what would be deleted without touching disk.
 */
export const pruneUnusedFiles = async (
  config: DeslopConfig,
  options: PruneOptions = {},
): Promise<PruneResult> => {
  const dryRun = options.dryRun ?? false;
  const maxIterations = options.maxIterations ?? DEFAULT_PRUNE_MAX_ITERATIONS;
  const iterations: PrunedIteration[] = [];
  const allDeletedFiles: string[] = [];
  const previouslyConsideredFiles = new Set<string>();

  const pruneStartTime = performance.now();
  let converged = true;

  for (let iterationIndex = 0; iterationIndex < maxIterations; iterationIndex++) {
    const iterationStartTime = performance.now();
    const scanResult = await analyze(config);

    const newlyUnusedFiles = scanResult.unusedFiles
      .map((unusedFile) => unusedFile.path)
      .filter((filePath) => !previouslyConsideredFiles.has(filePath));

    for (const filePath of newlyUnusedFiles) {
      previouslyConsideredFiles.add(filePath);
    }

    const deletedFilesThisIteration: string[] = [];
    if (!dryRun) {
      for (const filePath of newlyUnusedFiles) {
        try {
          rmSync(filePath, { force: true });
          deletedFilesThisIteration.push(filePath);
        } catch {
          continue;
        }
      }
    } else {
      deletedFilesThisIteration.push(...newlyUnusedFiles);
    }

    allDeletedFiles.push(...deletedFilesThisIteration);

    const iterationRecord: PrunedIteration = {
      iteration: iterationIndex + 1,
      deletedFiles: deletedFilesThisIteration,
      totalFilesBefore: scanResult.totalFiles,
      unusedFilesFound: scanResult.unusedFiles.length,
      elapsedMs: performance.now() - iterationStartTime,
      errors: scanResult.analysisErrors,
    };
    iterations.push(iterationRecord);
    options.onIteration?.(iterationRecord);

    if (deletedFilesThisIteration.length === 0) break;
    if (dryRun) break;

    if (iterationIndex === maxIterations - 1 && deletedFilesThisIteration.length > 0) {
      converged = false;
    }
  }

  return {
    iterations,
    deletedFiles: allDeletedFiles,
    dryRun,
    converged,
    totalElapsedMs: performance.now() - pruneStartTime,
  };
};
