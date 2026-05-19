import type {
  AnalyzeFlaggedExport,
  VerificationVerdict,
  VerifiedExport,
} from "../types.js";
import { queryNameUsages } from "./grep-corpus.js";
import { SKIP_EXPORT_NAMES, VERIFIABLE_EXPORT_MIN_NAME_LENGTH } from "../constants.js";

const isVerifiableExportName = (name: string): boolean => {
  if (!name) return false;
  if (SKIP_EXPORT_NAMES.has(name)) return false;
  if (name.length < VERIFIABLE_EXPORT_MIN_NAME_LENGTH) return false;
  if (!/[A-Z_]/.test(name) && name.length < 6) return false;
  return true;
};

const SKIPPED_VERDICT: VerificationVerdict = {
  kind: "skipped",
  reason: "common-name",
};

const isNoisyMatchPath = (filePath: string): boolean => {
  const lowered = filePath.toLowerCase();
  if (lowered.endsWith(".md") || lowered.endsWith(".mdx")) return true;
  if (lowered.endsWith(".snap")) return true;
  if (lowered.includes("/changelog")) return true;
  if (lowered.includes("/__snapshots__/")) return true;
  if (lowered.endsWith(".d.ts")) return true;
  return false;
};

export const verifyUnusedExport = async (
  flaggedExport: AnalyzeFlaggedExport,
  searchDir: string,
): Promise<VerifiedExport> => {
  if (!isVerifiableExportName(flaggedExport.name)) {
    return { ...flaggedExport, verdict: SKIPPED_VERDICT };
  }

  const lookup = await queryNameUsages(
    { identifier: flaggedExport.name, excludePaths: [flaggedExport.path] },
    searchDir,
  );

  const credibleMatches = lookup.matchingPaths.filter((filePath) => !isNoisyMatchPath(filePath));

  if (credibleMatches.length > 0) {
    return {
      ...flaggedExport,
      verdict: {
        kind: "likely_fp",
        reason: "identifier appears outside declaration file",
        evidence: credibleMatches.slice(0, 3).join(", "),
      },
    };
  }

  return {
    ...flaggedExport,
    verdict: {
      kind: "likely_tp",
      reason: "no credible external references to identifier",
    },
  };
};

export const verifyUnusedExportsBatch = async (
  flaggedExports: AnalyzeFlaggedExport[],
  searchDir: string,
  options: { concurrency?: number } = {},
): Promise<VerifiedExport[]> => {
  const verified: VerifiedExport[] = new Array(flaggedExports.length);
  const concurrency = options.concurrency ?? 8;
  let nextIndex = 0;

  const runOne = async (): Promise<void> => {
    while (nextIndex < flaggedExports.length) {
      const currentIndex = nextIndex++;
      verified[currentIndex] = await verifyUnusedExport(flaggedExports[currentIndex], searchDir);
    }
  };

  const workers: Promise<void>[] = [];
  const workerCount = Math.max(1, Math.min(concurrency, flaggedExports.length));
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) workers.push(runOne());
  await Promise.all(workers);
  return verified;
};
