import { existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import type { CloneOutcome, CorpusEntry, RepoEntry } from "../types.js";
import { GIT_CLONE_TIMEOUT_MS, REPO_CACHE_DIR } from "../constants.js";
import { repoSlug, slugifyEntry } from "./select-corpus.js";

const runShell = (
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number },
): Promise<{ exitCode: number; stdout: string; stderr: string; didTimeout: boolean }> => {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let didTimeout = false;
    const timeoutHandle = setTimeout(() => {
      didTimeout = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("close", (exitCode) => {
      clearTimeout(timeoutHandle);
      resolvePromise({
        exitCode: exitCode ?? -1,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        didTimeout,
      });
    });
    child.on("error", () => {
      clearTimeout(timeoutHandle);
      resolvePromise({
        exitCode: -1,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        didTimeout,
      });
    });
  });
};

const ensureCacheDir = (): void => {
  if (!existsSync(REPO_CACHE_DIR)) mkdirSync(REPO_CACHE_DIR, { recursive: true });
};

const fetchRefShallow = async (
  repoDir: string,
  remoteUrl: string,
  ref: string,
): Promise<{ ok: boolean; stderr: string }> => {
  const initOutcome = await runShell("git", ["init", "-q"], {
    cwd: repoDir,
    timeoutMs: 30_000,
  });
  if (initOutcome.exitCode !== 0) return { ok: false, stderr: initOutcome.stderr };

  await runShell("git", ["remote", "remove", "origin"], { cwd: repoDir, timeoutMs: 10_000 });
  const addRemoteOutcome = await runShell("git", ["remote", "add", "origin", remoteUrl], {
    cwd: repoDir,
    timeoutMs: 10_000,
  });
  if (addRemoteOutcome.exitCode !== 0) {
    return { ok: false, stderr: addRemoteOutcome.stderr };
  }

  await runShell(
    "git",
    ["config", "--local", "extensions.partialClone", "origin"],
    { cwd: repoDir, timeoutMs: 5_000 },
  );

  const fetchOutcome = await runShell(
    "git",
    ["fetch", "--depth", "1", "--filter=blob:limit=200k", "origin", ref],
    { cwd: repoDir, timeoutMs: GIT_CLONE_TIMEOUT_MS },
  );
  if (fetchOutcome.exitCode !== 0) {
    const fallback = await runShell(
      "git",
      ["fetch", "--depth", "1", "origin", ref],
      { cwd: repoDir, timeoutMs: GIT_CLONE_TIMEOUT_MS },
    );
    if (fallback.exitCode !== 0) {
      return { ok: false, stderr: fetchOutcome.stderr + "\n" + fallback.stderr };
    }
  }

  const checkoutOutcome = await runShell("git", ["checkout", "-q", "FETCH_HEAD"], {
    cwd: repoDir,
    timeoutMs: 60_000,
  });
  if (checkoutOutcome.exitCode !== 0) return { ok: false, stderr: checkoutOutcome.stderr };

  return { ok: true, stderr: "" };
};

export const cloneEntryIfMissing = async (entry: RepoEntry): Promise<CloneOutcome> => {
  ensureCacheDir();
  const slug = repoSlug(entry);
  const clonedRepoPath = resolve(REPO_CACHE_DIR, slug);
  const startedAt = Date.now();

  const headFile = join(clonedRepoPath, ".git", "HEAD");
  if (existsSync(headFile)) {
    const analyzeDirCandidate = join(clonedRepoPath, entry.rootDir);
    if (existsSync(analyzeDirCandidate)) {
      return {
        entry,
        slug,
        clonedRepoPath,
        status: "cached",
        durationMs: Date.now() - startedAt,
      };
    }
  }

  if (!existsSync(clonedRepoPath)) {
    mkdirSync(clonedRepoPath, { recursive: true });
  }

  const remoteUrl = `https://github.com/${entry.org}/${entry.name}.git`;
  const fetchResult = await fetchRefShallow(clonedRepoPath, remoteUrl, entry.ref);
  if (!fetchResult.ok) {
    return {
      entry,
      slug,
      clonedRepoPath,
      status: "failed",
      errorMessage: fetchResult.stderr.slice(0, 2000),
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    entry,
    slug,
    clonedRepoPath,
    status: "cloned",
    durationMs: Date.now() - startedAt,
  };
};

export const cloneCorpus = async (
  entries: RepoEntry[],
  options: { onProgress?: (cloneOutcome: CloneOutcome, index: number, total: number) => void } = {},
): Promise<CloneOutcome[]> => {
  const outcomes: CloneOutcome[] = [];
  const uniqueRepos = new Map<string, RepoEntry>();
  for (const entry of entries) {
    const key = repoSlug(entry);
    if (!uniqueRepos.has(key)) uniqueRepos.set(key, entry);
  }

  const repoList = [...uniqueRepos.values()];
  for (let index = 0; index < repoList.length; index++) {
    const outcome = await cloneEntryIfMissing(repoList[index]);
    outcomes.push(outcome);
    options.onProgress?.(outcome, index + 1, repoList.length);
  }
  return outcomes;
};

export const toCorpusEntries = (entries: RepoEntry[]): CorpusEntry[] => {
  return entries.map((entry) => {
    const slug = slugifyEntry(entry);
    const clonedRepoPath = resolve(REPO_CACHE_DIR, repoSlug(entry));
    const analyzeDir = join(clonedRepoPath, entry.rootDir);
    return {
      ...entry,
      slug,
      clonedRepoPath,
      analyzeDir,
      isPresent: existsSync(analyzeDir),
    };
  });
};
