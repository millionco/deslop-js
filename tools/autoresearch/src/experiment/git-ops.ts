import { spawn } from "node:child_process";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");

const runGit = (
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  return new Promise((resolvePromise) => {
    const child = spawn("git", args, {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timeoutHandle = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 30_000);
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("close", (exitCode) => {
      clearTimeout(timeoutHandle);
      resolvePromise({
        exitCode: exitCode ?? -1,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
      });
    });
    child.on("error", () => {
      clearTimeout(timeoutHandle);
      resolvePromise({
        exitCode: -1,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
      });
    });
  });
};

export const getCurrentCommitSha = async (): Promise<string> => {
  const result = await runGit(["rev-parse", "--short=10", "HEAD"]);
  return result.stdout.trim();
};

export const getCurrentBranch = async (): Promise<string> => {
  const result = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  return result.stdout.trim();
};

export const getWorkingTreeStatus = async (): Promise<{
  isClean: boolean;
  changedFiles: string[];
}> => {
  const result = await runGit(["status", "--porcelain"]);
  const changedFiles: string[] = [];
  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const filePath = trimmed.replace(/^[A-Z?!]{1,2}\s+/, "");
    changedFiles.push(filePath);
  }
  return { isClean: changedFiles.length === 0, changedFiles };
};

export const stageAllAndCommit = async (
  message: string,
): Promise<{ ok: boolean; commitSha?: string; stderr: string }> => {
  const addResult = await runGit(["add", "-A"]);
  if (addResult.exitCode !== 0) return { ok: false, stderr: addResult.stderr };
  const commitResult = await runGit(["commit", "--no-verify", "-m", message]);
  if (commitResult.exitCode !== 0) return { ok: false, stderr: commitResult.stderr };
  const sha = await getCurrentCommitSha();
  return { ok: true, commitSha: sha, stderr: "" };
};

export const resetToCommit = async (commitSha: string): Promise<{ ok: boolean; stderr: string }> => {
  const result = await runGit(["reset", "--hard", commitSha]);
  return { ok: result.exitCode === 0, stderr: result.stderr };
};

export const ensureBranch = async (
  branchName: string,
  fromCommitSha?: string,
): Promise<{ ok: boolean; stderr: string; alreadyExisted: boolean }> => {
  const showResult = await runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branchName}`]);
  if (showResult.exitCode === 0) {
    const checkoutResult = await runGit(["checkout", branchName]);
    return {
      ok: checkoutResult.exitCode === 0,
      stderr: checkoutResult.stderr,
      alreadyExisted: true,
    };
  }
  const createArgs = fromCommitSha
    ? ["checkout", "-b", branchName, fromCommitSha]
    : ["checkout", "-b", branchName];
  const createResult = await runGit(createArgs);
  return {
    ok: createResult.exitCode === 0,
    stderr: createResult.stderr,
    alreadyExisted: false,
  };
};

export const isFileTracked = async (filePath: string): Promise<boolean> => {
  const result = await runGit(["ls-files", "--error-unmatch", filePath]);
  return result.exitCode === 0;
};
