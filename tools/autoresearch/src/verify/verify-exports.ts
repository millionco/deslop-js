import type {
  AnalyzeFlaggedExport,
  VerificationVerdict,
  VerifiedExport,
} from "../types.js";
import {
  escapeRipgrepLiteral,
  queryIdentifierLineMatches,
  ripgrepFilesWithMatches,
} from "./grep-corpus.js";
import { filterImportOnlyMatches } from "./identifier-context.js";
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

const countExportDeclarationsForIdentifier = async (
  identifier: string,
  searchDir: string,
): Promise<number> => {
  const escaped = escapeRipgrepLiteral(identifier);
  const declarationPattern =
    `^\\s*export\\s+(?:async\\s+)?(?:const|let|var|function|class|interface|type|enum|abstract\\s+class|default\\s+)?\\s*\\{?[^=;\\n]*\\b${escaped}\\b`;
  const result = await ripgrepFilesWithMatches(declarationPattern, searchDir, {
    timeoutMs: 15_000,
    extraArgs: [
      "--type-add",
      "tsjs:*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
      "--type",
      "tsjs",
    ],
  });
  return result.files.size;
};

export const verifyUnusedExport = async (
  flaggedExport: AnalyzeFlaggedExport,
  searchDir: string,
): Promise<VerifiedExport> => {
  if (!isVerifiableExportName(flaggedExport.name)) {
    return { ...flaggedExport, verdict: SKIPPED_VERDICT };
  }

  const declarationCount = await countExportDeclarationsForIdentifier(
    flaggedExport.name,
    searchDir,
  );
  if (declarationCount >= 2) {
    return {
      ...flaggedExport,
      verdict: {
        kind: "skipped",
        reason: `${declarationCount} sibling files export the same identifier (ambiguous)`,
      },
    };
  }

  const lineMatches = await queryIdentifierLineMatches(
    { identifier: flaggedExport.name, excludePaths: [flaggedExport.path] },
    searchDir,
  );

  const nonNoisyLineMatches = lineMatches.filter(
    (lineMatch) => !isNoisyMatchPath(lineMatch.filePath),
  );
  const importContextMatches = filterImportOnlyMatches(nonNoisyLineMatches, flaggedExport.name);

  if (importContextMatches.length > 0) {
    const evidencePaths = [
      ...new Set(importContextMatches.map((lineMatch) => lineMatch.filePath)),
    ].slice(0, 3);
    return {
      ...flaggedExport,
      verdict: {
        kind: "likely_fp",
        reason: "identifier imported in another file",
        evidence: evidencePaths.join(", "),
      },
    };
  }

  return {
    ...flaggedExport,
    verdict: {
      kind: "likely_tp",
      reason: "no import-context references found",
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
