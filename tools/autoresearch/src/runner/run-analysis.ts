import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AnalyzeResult, CorpusEntry, EntryRunOutcome } from "../types.js";
import { DESLOP_DIST_INDEX, PER_ENTRY_ANALYSIS_TIMEOUT_MS } from "../constants.js";

const buildWorkerScript = (rootDir: string, distIndex: string): string => {
  const escapedRootDir = JSON.stringify(rootDir);
  const escapedIndex = JSON.stringify(distIndex);
  return `
import { defineConfig, analyze } from ${escapedIndex};
const config = defineConfig({ rootDir: ${escapedRootDir} });
analyze(config)
  .then((result) => {
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
  })
  .catch((error) => {
    process.stderr.write(String(error && error.stack ? error.stack : error));
    process.exit(2);
  });
`;
};

export const runAnalysisForEntry = (entry: CorpusEntry): Promise<EntryRunOutcome> => {
  const startedAt = Date.now();
  return new Promise((resolvePromise) => {
    if (!entry.isPresent) {
      resolvePromise({
        entry,
        status: "crash",
        errorMessage: "analyze directory does not exist",
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    const scriptText = buildWorkerScript(entry.analyzeDir, DESLOP_DIST_INDEX);
    const scratchDir = mkdtempSync(resolve(tmpdir(), "deslop-autoresearch-"));
    const scriptPath = resolve(scratchDir, "worker.mjs");
    writeFileSync(scriptPath, scriptText, "utf-8");

    const child = spawn(process.execPath, ["--no-warnings", scriptPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let didTimeout = false;

    const timeoutHandle = setTimeout(() => {
      didTimeout = true;
      child.kill("SIGKILL");
    }, PER_ENTRY_ANALYSIS_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("close", (exitCode) => {
      clearTimeout(timeoutHandle);
      try {
        rmSync(scratchDir, { recursive: true, force: true });
      } catch {}

      if (didTimeout) {
        resolvePromise({
          entry,
          status: "timeout",
          errorMessage: `analysis exceeded ${PER_ENTRY_ANALYSIS_TIMEOUT_MS}ms`,
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      if (exitCode !== 0) {
        resolvePromise({
          entry,
          status: "crash",
          errorMessage:
            Buffer.concat(stderrChunks).toString("utf-8").slice(0, 4000) ||
            `worker exited with code ${exitCode}`,
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      try {
        const stdoutText = Buffer.concat(stdoutChunks).toString("utf-8");
        const parsed = JSON.parse(stdoutText) as AnalyzeResult;
        resolvePromise({
          entry,
          status: "ok",
          durationMs: Date.now() - startedAt,
          result: parsed,
        });
      } catch (parseError) {
        resolvePromise({
          entry,
          status: "crash",
          errorMessage: `JSON parse failed: ${String(parseError)}`,
          durationMs: Date.now() - startedAt,
        });
      }
    });

    child.on("error", (childError) => {
      clearTimeout(timeoutHandle);
      try {
        rmSync(scratchDir, { recursive: true, force: true });
      } catch {}
      resolvePromise({
        entry,
        status: "crash",
        errorMessage: `spawn error: ${String(childError)}`,
        durationMs: Date.now() - startedAt,
      });
    });
  });
};

export const runAnalysisForCorpus = async (
  entries: CorpusEntry[],
  concurrency: number,
  options: { onProgress?: (outcome: EntryRunOutcome, completed: number, total: number) => void } = {},
): Promise<EntryRunOutcome[]> => {
  const outcomes: EntryRunOutcome[] = [];
  let nextIndex = 0;
  let completedCount = 0;

  const runWorker = async (): Promise<void> => {
    while (nextIndex < entries.length) {
      const currentIndex = nextIndex++;
      const outcome = await runAnalysisForEntry(entries[currentIndex]);
      outcomes[currentIndex] = outcome;
      completedCount++;
      options.onProgress?.(outcome, completedCount, entries.length);
    }
  };

  const workerPromises: Promise<void>[] = [];
  const workerCount = Math.max(1, Math.min(concurrency, entries.length));
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
    workerPromises.push(runWorker());
  }
  await Promise.all(workerPromises);
  return outcomes;
};
