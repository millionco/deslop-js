import { spawn } from "node:child_process";
import type {
  FlaggedFile,
  FlaggedExport,
  FlaggedDependency,
  VerificationVerdict,
  RepoToolResult,
} from "../types.js";
import { basename, relative } from "node:path";

const SKIP_EXPORT_NAMES = new Set(["default", "*"]);
const VERIFIABLE_EXPORT_MIN_NAME_LENGTH = 2;

const ripgrepSearch = (
  pattern: string,
  searchDir: string,
  extraArgs: string[] = [],
): Promise<string[]> => {
  return new Promise((resolvePromise) => {
    const args = [
      "--no-heading",
      "--files-with-matches",
      "--max-count",
      "3",
      ...extraArgs,
      pattern,
      searchDir,
    ];
    const child = spawn("rg", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    const stdoutChunks: Buffer[] = [];
    let didTimeout = false;
    const timeoutHandle = setTimeout(() => {
      didTimeout = true;
      child.kill("SIGKILL");
    }, 15_000);
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.resume();
    child.on("close", () => {
      clearTimeout(timeoutHandle);
      if (didTimeout) {
        resolvePromise([]);
        return;
      }
      const output = Buffer.concat(stdoutChunks).toString("utf-8").trim();
      resolvePromise(output ? output.split("\n") : []);
    });
    child.on("error", () => {
      clearTimeout(timeoutHandle);
      resolvePromise([]);
    });
  });
};

const escapeRegex = (literal: string): string => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const verifyUnusedExport = async (
  flaggedExport: FlaggedExport,
  searchDir: string,
): Promise<FlaggedExport & { verdict: VerificationVerdict }> => {
  const exportName = flaggedExport.name;

  if (!exportName || SKIP_EXPORT_NAMES.has(exportName)) {
    return { ...flaggedExport, verdict: { kind: "skipped", reason: "common-name" } };
  }
  if (exportName.length < VERIFIABLE_EXPORT_MIN_NAME_LENGTH) {
    return { ...flaggedExport, verdict: { kind: "skipped", reason: "name-too-short" } };
  }

  const escaped = escapeRegex(exportName);
  const importPattern = `\\b${escaped}\\b`;
  const matchingFiles = await ripgrepSearch(importPattern, searchDir, [
    "--type-add",
    "tsjs:*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
    "--type",
    "tsjs",
  ]);

  const otherFiles = matchingFiles.filter((matchPath) => matchPath !== flaggedExport.path);

  if (otherFiles.length > 0) {
    return {
      ...flaggedExport,
      verdict: { kind: "likely_fp", reason: "identifier found in other files" },
    };
  }

  return {
    ...flaggedExport,
    verdict: { kind: "likely_tp", reason: "no import evidence found" },
  };
};

const verifyUnusedFile = async (
  flaggedFile: FlaggedFile,
  searchDir: string,
): Promise<FlaggedFile & { verdict: VerificationVerdict }> => {
  const fileBasename = basename(flaggedFile.path);
  const relativePath = relative(searchDir, flaggedFile.path);

  const escaped = escapeRegex(relativePath);
  const pathMatches = await ripgrepSearch(escaped, searchDir, [
    "--type-add",
    "tsjs:*.{ts,tsx,js,jsx,mts,mjs,cts,cjs,json}",
    "--type",
    "tsjs",
  ]);

  const otherPathMatches = pathMatches.filter((matchPath) => matchPath !== flaggedFile.path);

  if (otherPathMatches.length > 0) {
    return {
      ...flaggedFile,
      verdict: { kind: "likely_fp", reason: "file path referenced in other files" },
    };
  }

  const basenameWithoutExt = fileBasename.replace(/\.[^.]+$/, "");
  if (basenameWithoutExt.length >= 3) {
    const basenameEscaped = escapeRegex(basenameWithoutExt);
    const basenameMatches = await ripgrepSearch(`from\\s+['"].*${basenameEscaped}`, searchDir, [
      "--type-add",
      "tsjs:*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
      "--type",
      "tsjs",
    ]);
    const otherBasenameMatches = basenameMatches.filter(
      (matchPath) => matchPath !== flaggedFile.path,
    );
    if (otherBasenameMatches.length > 0) {
      return {
        ...flaggedFile,
        verdict: { kind: "likely_fp", reason: "basename appears in import statements" },
      };
    }
  }

  return {
    ...flaggedFile,
    verdict: { kind: "likely_tp", reason: "no reference to file found" },
  };
};

const verifyUnusedDependency = async (
  flaggedDep: FlaggedDependency,
  searchDir: string,
): Promise<FlaggedDependency & { verdict: VerificationVerdict }> => {
  const escaped = escapeRegex(flaggedDep.name);
  const importPattern = `['"]${escaped}(?:/|['"])`;
  const matchingFiles = await ripgrepSearch(importPattern, searchDir, [
    "--type-add",
    "tsjs:*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
    "--type",
    "tsjs",
  ]);

  if (matchingFiles.length > 0) {
    return {
      ...flaggedDep,
      verdict: { kind: "likely_fp", reason: "package is imported in source" },
    };
  }

  return {
    ...flaggedDep,
    verdict: { kind: "likely_tp", reason: "no import/require referencing package" },
  };
};

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

export const verifyToolResult = async (
  toolResult: RepoToolResult,
  repoDir: string,
): Promise<RepoToolResult> => {
  if (toolResult.status !== "ok" || !toolResult.result) return toolResult;

  const filesToVerify = samplePool(toolResult.result.unusedFiles, MAX_VERIFY_PER_CATEGORY);
  const exportsToVerify = samplePool(toolResult.result.unusedExports, MAX_VERIFY_PER_CATEGORY);
  const depsToVerify = samplePool(toolResult.result.unusedDependencies, MAX_VERIFY_PER_CATEGORY);

  const verifiedFiles = await Promise.all(
    filesToVerify.map((flaggedFile) => verifyUnusedFile(flaggedFile, repoDir)),
  );

  const verifiedExports: Array<FlaggedExport & { verdict: VerificationVerdict }> = [];
  for (const exportItem of exportsToVerify) {
    verifiedExports.push(await verifyUnusedExport(exportItem, repoDir));
  }

  const verifiedDeps = await Promise.all(
    depsToVerify.map((flaggedDep) => verifyUnusedDependency(flaggedDep, repoDir)),
  );

  return {
    ...toolResult,
    verified: {
      files: verifiedFiles,
      exports: verifiedExports,
      dependencies: verifiedDeps,
    },
  };
};
