import { existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import type { BenchmarkRepo, CloneOutcome } from "../types.js";
import {
  BENCHMARK_CACHE_DIR,
  GIT_CLONE_TIMEOUT_MS,
  INSTALL_DEPS_TIMEOUT_MS,
} from "../constants.js";
import { repoSlug } from "../repos.js";

const runShell = (
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number },
): Promise<{ exitCode: number; stderr: string; didTimeout: boolean }> => {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const stderrChunks: Buffer[] = [];
    let didTimeout = false;
    const timeoutHandle = setTimeout(() => {
      didTimeout = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.stdout?.resume();
    child.on("close", (exitCode) => {
      clearTimeout(timeoutHandle);
      resolvePromise({
        exitCode: exitCode ?? -1,
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        didTimeout,
      });
    });
    child.on("error", () => {
      clearTimeout(timeoutHandle);
      resolvePromise({
        exitCode: -1,
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        didTimeout,
      });
    });
  });
};

const fetchDefaultBranch = async (
  repoDir: string,
  remoteUrl: string,
  branch: string,
): Promise<{ ok: boolean; stderr: string }> => {
  const initResult = await runShell("git", ["init", "-q"], {
    cwd: repoDir,
    timeoutMs: 30_000,
  });
  if (initResult.exitCode !== 0) return { ok: false, stderr: initResult.stderr };

  await runShell("git", ["remote", "remove", "origin"], { cwd: repoDir, timeoutMs: 10_000 });
  const addRemoteResult = await runShell("git", ["remote", "add", "origin", remoteUrl], {
    cwd: repoDir,
    timeoutMs: 10_000,
  });
  if (addRemoteResult.exitCode !== 0) return { ok: false, stderr: addRemoteResult.stderr };

  const fetchResult = await runShell("git", ["fetch", "--depth", "1", "origin", branch], {
    cwd: repoDir,
    timeoutMs: GIT_CLONE_TIMEOUT_MS,
  });
  if (fetchResult.exitCode !== 0) return { ok: false, stderr: fetchResult.stderr };

  const checkoutResult = await runShell("git", ["checkout", "-q", "FETCH_HEAD"], {
    cwd: repoDir,
    timeoutMs: 60_000,
  });
  if (checkoutResult.exitCode !== 0) return { ok: false, stderr: checkoutResult.stderr };

  return { ok: true, stderr: "" };
};

const detectPackageManager = (repoDir: string): "pnpm" | "yarn" | "npm" => {
  if (existsSync(join(repoDir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(repoDir, "yarn.lock"))) return "yarn";
  return "npm";
};

const installDependencies = async (
  repoDir: string,
): Promise<{ ok: boolean; packageManager: string }> => {
  const packageManager = detectPackageManager(repoDir);
  const installArgs: Record<string, string[]> = {
    pnpm: ["install", "--ignore-scripts", "--no-frozen-lockfile"],
    yarn: ["install", "--ignore-scripts", "--no-immutable"],
    npm: ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
  };

  const result = await runShell(packageManager, installArgs[packageManager], {
    cwd: repoDir,
    timeoutMs: INSTALL_DEPS_TIMEOUT_MS,
  });

  return { ok: result.exitCode === 0 || !result.didTimeout, packageManager };
};

export const cloneRepo = async (repo: BenchmarkRepo): Promise<CloneOutcome> => {
  mkdirSync(BENCHMARK_CACHE_DIR, { recursive: true });
  const slug = repoSlug(repo);
  const repoDir = resolve(BENCHMARK_CACHE_DIR, slug);
  const startedAt = Date.now();

  const headFile = join(repoDir, ".git", "HEAD");
  if (existsSync(headFile)) {
    const hasNodeModules = existsSync(join(repoDir, "node_modules"));
    if (!hasNodeModules) {
      await installDependencies(repoDir);
    }
    return {
      repo,
      repoDir,
      status: "cached",
      durationMs: Date.now() - startedAt,
    };
  }

  mkdirSync(repoDir, { recursive: true });

  const remoteUrl = `https://github.com/${repo.org}/${repo.name}.git`;
  const fetchResult = await fetchDefaultBranch(repoDir, remoteUrl, repo.defaultBranch);
  if (!fetchResult.ok) {
    return {
      repo,
      repoDir,
      status: "failed",
      errorMessage: fetchResult.stderr.slice(0, 2000),
      durationMs: Date.now() - startedAt,
    };
  }

  await installDependencies(repoDir);

  return {
    repo,
    repoDir,
    status: "cloned",
    durationMs: Date.now() - startedAt,
  };
};

export const cloneAllRepos = async (
  repos: BenchmarkRepo[],
  options: {
    concurrency?: number;
    onProgress?: (outcome: CloneOutcome, completed: number, total: number) => void;
  } = {},
): Promise<CloneOutcome[]> => {
  const concurrency = options.concurrency ?? 4;
  const outcomes: CloneOutcome[] = new Array(repos.length);
  let nextIndex = 0;
  let completedCount = 0;

  const runWorker = async (): Promise<void> => {
    while (nextIndex < repos.length) {
      const currentIndex = nextIndex++;
      const outcome = await cloneRepo(repos[currentIndex]);
      outcomes[currentIndex] = outcome;
      completedCount++;
      options.onProgress?.(outcome, completedCount, repos.length);
    }
  };

  const workers: Promise<void>[] = [];
  const workerCount = Math.max(1, Math.min(concurrency, repos.length));
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
    workers.push(runWorker());
  }
  await Promise.all(workers);
  return outcomes;
};
