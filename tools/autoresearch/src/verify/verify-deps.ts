import type { AnalyzeFlaggedDependency, VerifiedDependency } from "../types.js";
import { queryDependencyUsage } from "./grep-corpus.js";

export const verifyUnusedDependency = async (
  flaggedDependency: AnalyzeFlaggedDependency,
  searchDir: string,
): Promise<VerifiedDependency> => {
  const lookup = await queryDependencyUsage(
    { packageName: flaggedDependency.name },
    searchDir,
  );
  if (lookup.isImported) {
    return {
      ...flaggedDependency,
      verdict: {
        kind: "likely_fp",
        reason: "package is imported in source",
        evidence: lookup.matchingPaths.slice(0, 3).join(", "),
      },
    };
  }
  return {
    ...flaggedDependency,
    verdict: { kind: "likely_tp", reason: "no import/require referencing package" },
  };
};

export const verifyUnusedDependenciesBatch = async (
  flaggedDependencies: AnalyzeFlaggedDependency[],
  searchDir: string,
  options: { concurrency?: number } = {},
): Promise<VerifiedDependency[]> => {
  const verified: VerifiedDependency[] = new Array(flaggedDependencies.length);
  const concurrency = options.concurrency ?? 8;
  let nextIndex = 0;

  const runOne = async (): Promise<void> => {
    while (nextIndex < flaggedDependencies.length) {
      const currentIndex = nextIndex++;
      verified[currentIndex] = await verifyUnusedDependency(
        flaggedDependencies[currentIndex],
        searchDir,
      );
    }
  };

  const workers: Promise<void>[] = [];
  const workerCount = Math.max(1, Math.min(concurrency, flaggedDependencies.length));
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) workers.push(runOne());
  await Promise.all(workers);
  return verified;
};
