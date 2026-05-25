import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type {
  BenchmarkRepo,
  RepoToolResult,
  ToolResult,
  FlaggedFile,
  FlaggedExport,
  FlaggedDependency,
} from "../types.js";
import { PER_ENTRY_ANALYSIS_TIMEOUT_MS } from "../constants.js";

interface KnipIssueItem {
  name: string;
  line: number;
  col: number;
  pos: number;
}

interface KnipIssue {
  file?: string;
  dependencies?: KnipIssueItem[];
  devDependencies?: KnipIssueItem[];
  optionalPeerDependencies?: KnipIssueItem[];
  unlisted?: KnipIssueItem[];
  binaries?: KnipIssueItem[];
  unresolved?: KnipIssueItem[];
  exports?: KnipIssueItem[];
  types?: KnipIssueItem[];
  enumMembers?: Record<string, KnipIssueItem[]>;
  duplicates?: KnipIssueItem[][];
}

interface KnipJsonOutput {
  files?: string[];
  issues?: KnipIssue[];
}

const knipBinPath = resolve(import.meta.dirname, "..", "..", "node_modules", ".bin", "knip");

const parseKnipOutput = (jsonText: string, repoDir: string): ToolResult => {
  const parsed = JSON.parse(jsonText) as KnipJsonOutput;

  const unusedFiles: FlaggedFile[] = [];
  const unusedExports: FlaggedExport[] = [];
  const unusedDependencies: FlaggedDependency[] = [];

  if (parsed.files) {
    for (const filePath of parsed.files) {
      unusedFiles.push({ path: resolve(repoDir, filePath) });
    }
  }

  if (parsed.issues) {
    for (const issue of parsed.issues) {
      const filePath = issue.file ? resolve(repoDir, issue.file) : "";

      if (issue.dependencies) {
        for (const depItem of issue.dependencies) {
          unusedDependencies.push({ name: depItem.name });
        }
      }
      if (issue.devDependencies) {
        for (const depItem of issue.devDependencies) {
          unusedDependencies.push({ name: depItem.name });
        }
      }

      if (issue.exports) {
        for (const exportItem of issue.exports) {
          unusedExports.push({
            path: filePath,
            name: exportItem.name,
            line: exportItem.line,
            column: exportItem.col,
            isTypeOnly: false,
          });
        }
      }
      if (issue.types) {
        for (const typeItem of issue.types) {
          unusedExports.push({
            path: filePath,
            name: typeItem.name,
            line: typeItem.line,
            column: typeItem.col,
            isTypeOnly: true,
          });
        }
      }
    }
  }

  return {
    unusedFiles,
    unusedExports,
    unusedDependencies,
    totalFiles: 0,
    totalExports: 0,
    analysisTimeMs: 0,
  };
};

export const runKnip = (repo: BenchmarkRepo, repoDir: string): Promise<RepoToolResult> => {
  const startedAt = Date.now();
  return new Promise((resolvePromise) => {
    if (!existsSync(repoDir)) {
      resolvePromise({
        tool: "knip",
        repo,
        status: "crash",
        errorMessage: "repo directory does not exist",
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    const child = spawn(knipBinPath, ["--reporter", "json", "--no-progress", "--no-exit-code"], {
      cwd: repoDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" },
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
      const analysisTimeMs = Date.now() - startedAt;

      if (didTimeout) {
        resolvePromise({
          tool: "knip",
          repo,
          status: "timeout",
          errorMessage: `knip exceeded ${PER_ENTRY_ANALYSIS_TIMEOUT_MS}ms`,
          durationMs: analysisTimeMs,
        });
        return;
      }

      const stdoutText = Buffer.concat(stdoutChunks).toString("utf-8");

      if (!stdoutText.trim()) {
        const stderrText = Buffer.concat(stderrChunks).toString("utf-8").slice(0, 4000);
        resolvePromise({
          tool: "knip",
          repo,
          status: "crash",
          errorMessage: stderrText || `knip exited with code ${exitCode} and no output`,
          durationMs: analysisTimeMs,
        });
        return;
      }

      try {
        const result = parseKnipOutput(stdoutText, repoDir);
        result.analysisTimeMs = analysisTimeMs;
        resolvePromise({
          tool: "knip",
          repo,
          status: "ok",
          durationMs: analysisTimeMs,
          result,
        });
      } catch (parseError) {
        resolvePromise({
          tool: "knip",
          repo,
          status: "crash",
          errorMessage: `knip output parse failed: ${String(parseError)}. Output: ${stdoutText.slice(0, 500)}`,
          durationMs: analysisTimeMs,
        });
      }
    });

    child.on("error", (childError) => {
      clearTimeout(timeoutHandle);
      resolvePromise({
        tool: "knip",
        repo,
        status: "crash",
        errorMessage: `spawn error: ${String(childError)}`,
        durationMs: Date.now() - startedAt,
      });
    });
  });
};
