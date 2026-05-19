import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloneCorpus, toCorpusEntries } from "../corpus/clone-repos.js";
import { loadRepoEntries, selectCorpus } from "../corpus/select-corpus.js";
import { runAnalysisForCorpus } from "../runner/run-analysis.js";
import { verifyUnusedExportsBatch } from "../verify/verify-exports.js";
import { verifyUnusedFilesBatch } from "../verify/verify-files.js";
import { verifyUnusedDependenciesBatch } from "../verify/verify-deps.js";
import { computeMetricsForReports, formatMetricsSummary } from "../metrics/compute-metrics.js";
import { REPORTS_DIR } from "../constants.js";
import type {
  AnalyzeFlaggedExport,
  AnalyzeFlaggedFile,
  CorpusEntry,
  EntryRunOutcome,
  EntryVerifiedReport,
  RunArtifact,
} from "../types.js";
import { getCurrentCommitSha } from "./git-ops.js";

const MAX_VERIFY_PER_CATEGORY = 200;

const samplePool = <Item>(items: readonly Item[], maxCount: number): Item[] => {
  if (items.length <= maxCount) return [...items];
  const stride = items.length / maxCount;
  const sampled: Item[] = new Array(maxCount);
  for (let outputIndex = 0; outputIndex < maxCount; outputIndex++) {
    const sourceIndex = Math.min(items.length - 1, Math.floor(outputIndex * stride));
    sampled[outputIndex] = items[sourceIndex];
  }
  return sampled;
};

const verifyOutcome = async (outcome: EntryRunOutcome): Promise<EntryVerifiedReport> => {
  if (outcome.status !== "ok" || !outcome.result) {
    return {
      entry: outcome.entry,
      status: outcome.status,
      errorMessage: outcome.errorMessage,
      durationMs: outcome.durationMs,
      unusedFiles: [],
      unusedExports: [],
      unusedDependencies: [],
      totalFiles: 0,
      totalExports: 0,
      analysisTimeMs: 0,
    };
  }

  const searchDir = outcome.entry.analyzeDir;

  const filesToVerify: AnalyzeFlaggedFile[] = samplePool(
    outcome.result.unusedFiles,
    MAX_VERIFY_PER_CATEGORY,
  );
  const exportsToVerify: AnalyzeFlaggedExport[] = samplePool(
    outcome.result.unusedExports,
    MAX_VERIFY_PER_CATEGORY,
  );
  const allFlaggedFilePaths = new Set(
    outcome.result.unusedFiles.map((flaggedFile) => flaggedFile.path),
  );

  const [unusedExports, unusedFiles, unusedDependencies] = await Promise.all([
    verifyUnusedExportsBatch(exportsToVerify, searchDir, { concurrency: 6 }),
    verifyUnusedFilesBatch(filesToVerify, searchDir, {
      concurrency: 4,
      allFlaggedFilePaths,
    }),
    verifyUnusedDependenciesBatch(outcome.result.unusedDependencies, searchDir, {
      concurrency: 6,
    }),
  ]);

  return {
    entry: outcome.entry,
    status: "ok",
    durationMs: outcome.durationMs,
    unusedFiles,
    unusedExports,
    unusedDependencies,
    totalFiles: outcome.result.totalFiles,
    totalExports: outcome.result.totalExports,
    analysisTimeMs: outcome.result.analysisTimeMs,
  };
};

export interface RunCorpusOptions {
  corpus: "fast" | "mid" | "full" | "all";
  analysisConcurrency?: number;
  verifyConcurrency?: number;
  description?: string;
  iterationIndex?: number;
  parentSha?: string;
  silent?: boolean;
}

export const runOneCorpusPass = async (
  options: RunCorpusOptions,
): Promise<RunArtifact> => {
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const allEntries = loadRepoEntries();
  const selection = selectCorpus(options.corpus, allEntries);
  if (!options.silent) {
    process.stderr.write(
      `[autoresearch] cloning ${selection.entries.length} entries from ${options.corpus} corpus...\n`,
    );
  }
  const cloneOutcomes = await cloneCorpus(selection.entries, {
    onProgress: (cloneOutcome, completedIndex, total) => {
      if (options.silent) return;
      const status = cloneOutcome.status.padEnd(7);
      const slug = cloneOutcome.slug;
      const elapsed = `${cloneOutcome.durationMs}ms`;
      process.stderr.write(
        `[clone ${completedIndex}/${total}] ${status} ${slug} (${elapsed})\n`,
      );
    },
  });
  const failedRepoSlugs = new Set<string>();
  for (const cloneOutcome of cloneOutcomes) {
    if (cloneOutcome.status === "failed") failedRepoSlugs.add(cloneOutcome.slug);
  }
  const fullCorpus = toCorpusEntries(selection.entries);
  const presentCorpus: CorpusEntry[] = fullCorpus.filter((corpusEntry) => corpusEntry.isPresent);

  if (!options.silent) {
    process.stderr.write(
      `[autoresearch] analyzing ${presentCorpus.length} present entries (skipping ${
        fullCorpus.length - presentCorpus.length
      } missing)...\n`,
    );
  }

  const analysisOutcomes = await runAnalysisForCorpus(
    presentCorpus,
    options.analysisConcurrency ?? 4,
    {
      onProgress: (outcome, completedIndex, totalCount) => {
        if (options.silent) return;
        const status = outcome.status.padEnd(7);
        const message =
          outcome.status === "ok"
            ? `flagged=${
                (outcome.result?.unusedFiles.length ?? 0) +
                (outcome.result?.unusedExports.length ?? 0) +
                (outcome.result?.unusedDependencies.length ?? 0)
              }`
            : outcome.errorMessage?.slice(0, 120) ?? "";
        process.stderr.write(
          `[analyze ${completedIndex}/${totalCount}] ${status} ${outcome.entry.slug} ${outcome.durationMs}ms ${message}\n`,
        );
      },
    },
  );

  if (!options.silent) {
    process.stderr.write(`[autoresearch] verifying flagged items...\n`);
  }

  const verifyConcurrency = options.verifyConcurrency ?? 3;
  const verifiedReports: EntryVerifiedReport[] = new Array(analysisOutcomes.length);
  let nextVerifyIndex = 0;

  const runVerifyWorker = async (): Promise<void> => {
    while (nextVerifyIndex < analysisOutcomes.length) {
      const currentIndex = nextVerifyIndex++;
      const verified = await verifyOutcome(analysisOutcomes[currentIndex]);
      verifiedReports[currentIndex] = verified;
      if (!options.silent) {
        const totalFlagged =
          verified.unusedFiles.length +
          verified.unusedExports.length +
          verified.unusedDependencies.length;
        const fpCount =
          verified.unusedFiles.filter((flagged) => flagged.verdict.kind === "likely_fp").length +
          verified.unusedExports.filter((flagged) => flagged.verdict.kind === "likely_fp").length +
          verified.unusedDependencies.filter((flagged) => flagged.verdict.kind === "likely_fp").length;
        process.stderr.write(
          `[verify ${currentIndex + 1}/${analysisOutcomes.length}] ${verified.entry.slug} flagged=${totalFlagged} likely_fp=${fpCount}\n`,
        );
      }
    }
  };

  const verifyWorkers: Promise<void>[] = [];
  for (let workerIndex = 0; workerIndex < verifyConcurrency; workerIndex++) {
    verifyWorkers.push(runVerifyWorker());
  }
  await Promise.all(verifyWorkers);

  const wallTimeMs = Date.now() - startedAt;
  const metrics = computeMetricsForReports(verifiedReports, wallTimeMs);

  const commitSha = await getCurrentCommitSha();

  const artifact: RunArtifact = {
    commitSha,
    parentSha: options.parentSha,
    iterationIndex: options.iterationIndex ?? 0,
    startedAtIso,
    finishedAtIso: new Date().toISOString(),
    corpusSlug: options.corpus,
    corpusSize: selection.entries.length,
    perEntry: verifiedReports,
    metrics,
    description: options.description ?? "(no description)",
  };

  mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = join(
    REPORTS_DIR,
    `${artifact.iterationIndex.toString().padStart(5, "0")}__${commitSha}__${options.corpus}.json`,
  );
  writeFileSync(reportPath, JSON.stringify(artifact, null, 2));

  if (!options.silent) {
    process.stderr.write(formatMetricsSummary(metrics) + "\n");
    process.stderr.write(`[autoresearch] report written to ${reportPath}\n`);
  }

  return artifact;
};
