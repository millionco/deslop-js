import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { writeFileSync, mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import type { BenchmarkRepo, RepoToolResult, ToolResult } from "../types.js";
import { DESLOP_DIST_INDEX, PER_ENTRY_ANALYSIS_TIMEOUT_MS } from "../constants.js";

const buildWorkerScript = (rootDir: string, distIndex: string): string => {
  const escapedRootDir = JSON.stringify(rootDir);
  const escapedIndex = JSON.stringify(distIndex);
  return `
import { writeFileSync } from "node:fs";
import { defineConfig, analyze } from ${escapedIndex};
const outputPath = process.argv[process.argv.length - 1];
const config = defineConfig({ rootDir: ${escapedRootDir} });
analyze(config)
  .then((result) => {
    writeFileSync(outputPath, JSON.stringify(result), "utf-8");
    process.exit(0);
  })
  .catch((error) => {
    process.stderr.write(String(error && error.stack ? error.stack : error));
    process.exit(2);
  });
`;
};

export const runDeslop = (repo: BenchmarkRepo, repoDir: string): Promise<RepoToolResult> => {
  const startedAt = Date.now();
  return new Promise((resolvePromise) => {
    if (!existsSync(repoDir)) {
      resolvePromise({
        tool: "deslop",
        repo,
        status: "crash",
        errorMessage: "repo directory does not exist",
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    const scriptText = buildWorkerScript(repoDir, DESLOP_DIST_INDEX);
    const scratchDir = mkdtempSync(resolve(tmpdir(), "deslop-benchmark-"));
    const scriptPath = resolve(scratchDir, "worker.mjs");
    const outputPath = resolve(scratchDir, "result.json");
    writeFileSync(scriptPath, scriptText, "utf-8");

    const child = spawn(process.execPath, ["--no-warnings", scriptPath, outputPath], {
      stdio: ["ignore", "ignore", "pipe"],
      env: process.env,
    });

    const stderrChunks: Buffer[] = [];
    let didTimeout = false;

    const cleanupScratch = (): void => {
      try {
        rmSync(scratchDir, { recursive: true, force: true });
      } catch {}
    };

    const timeoutHandle = setTimeout(() => {
      didTimeout = true;
      child.kill("SIGKILL");
    }, PER_ENTRY_ANALYSIS_TIMEOUT_MS);

    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("close", (exitCode) => {
      clearTimeout(timeoutHandle);

      if (didTimeout) {
        cleanupScratch();
        resolvePromise({
          tool: "deslop",
          repo,
          status: "timeout",
          errorMessage: `analysis exceeded ${PER_ENTRY_ANALYSIS_TIMEOUT_MS}ms`,
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      if (exitCode !== 0) {
        const stderrText = Buffer.concat(stderrChunks).toString("utf-8").slice(0, 4000);
        cleanupScratch();
        resolvePromise({
          tool: "deslop",
          repo,
          status: "crash",
          errorMessage: stderrText || `worker exited with code ${exitCode}`,
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      if (!existsSync(outputPath)) {
        cleanupScratch();
        resolvePromise({
          tool: "deslop",
          repo,
          status: "crash",
          errorMessage: "worker exited 0 but did not write output file",
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      try {
        const jsonText = readFileSync(outputPath, "utf-8");
        const parsed = JSON.parse(jsonText) as ToolResult;
        cleanupScratch();
        resolvePromise({
          tool: "deslop",
          repo,
          status: "ok",
          durationMs: Date.now() - startedAt,
          result: parsed,
        });
      } catch (parseError) {
        cleanupScratch();
        resolvePromise({
          tool: "deslop",
          repo,
          status: "crash",
          errorMessage: `JSON parse failed: ${String(parseError)}`,
          durationMs: Date.now() - startedAt,
        });
      }
    });

    child.on("error", (childError) => {
      clearTimeout(timeoutHandle);
      cleanupScratch();
      resolvePromise({
        tool: "deslop",
        repo,
        status: "crash",
        errorMessage: `spawn error: ${String(childError)}`,
        durationMs: Date.now() - startedAt,
      });
    });
  });
};
