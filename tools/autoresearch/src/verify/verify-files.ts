import { basename, dirname, extname, relative, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { AnalyzeFlaggedFile, VerifiedFile, VerificationVerdict } from "../types.js";
import {
  ripgrepFilesWithMatches,
  ripgrepLineMatches,
  escapeRipgrepLiteral,
} from "./grep-corpus.js";

/**
 * Previously this file held a 86-name "COMMON_BASENAMES" allowlist that
 * skipped verification for every file named `button.tsx`, `dialog.tsx`,
 * `index.ts`, etc. — driving the `files` row of `verificationCoverage`
 * down to 45% by hiding half the file findings from the FP denominator.
 *
 * The list is gone. Verification now runs uniformly: the explicit-relative-
 * path check (`escapedRelative`) still catches consumers who import the
 * full path regardless of basename, and the basename-based fallback now
 * relies on `findOtherFilesWithSameBasename` (line ~204) to detect real
 * cross-file ambiguity: if 2+ files in the corpus share the same basename,
 * the basename-match candidate is discarded, leaving the finding as
 * `likely_tp` (no false `likely_fp` from cross-file confusion).
 */
const SKIPPED_VERDICT: VerificationVerdict = {
  kind: "skipped",
  reason: "no-extension",
};

const isDocumentationPath = (filePath: string): boolean => {
  const lowered = filePath.toLowerCase();
  return (
    lowered.endsWith(".md") ||
    lowered.endsWith(".mdx") ||
    lowered.includes("/changelog") ||
    lowered.includes("/.snap") ||
    lowered.endsWith(".snap") ||
    lowered.includes("/docs/") ||
    lowered.includes("/__snapshots__/") ||
    lowered.endsWith(".d.ts") ||
    lowered.endsWith(".d.mts") ||
    lowered.endsWith(".d.cts")
  );
};

const IMPORT_PATH_PATTERN = /(?:from|require)\s*\(?\s*['"`]([^'"`\n]+)['"`]/g;

const extractImportPaths = (lineText: string): string[] => {
  const paths: string[] = [];
  let match: RegExpExecArray | null;
  IMPORT_PATH_PATTERN.lastIndex = 0;
  while ((match = IMPORT_PATH_PATTERN.exec(lineText)) !== null) {
    paths.push(match[1]);
  }
  if (paths.length === 0) {
    const importMatch = lineText.match(/import\s+['"`]([^'"`\n]+)['"`]/);
    if (importMatch) paths.push(importMatch[1]);
  }
  return paths;
};

const RESOLVABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".cjs", ".cts"];

const resolveRelativeImportCandidate = (
  importPath: string,
  fromFilePath: string,
): string | undefined => {
  if (!importPath.startsWith(".")) return undefined;
  const absoluteBase = resolve(dirname(fromFilePath), importPath);
  if (existsSync(absoluteBase)) return absoluteBase;
  for (const extension of RESOLVABLE_EXTENSIONS) {
    const withExtension = absoluteBase + extension;
    if (existsSync(withExtension)) return withExtension;
  }
  for (const extension of RESOLVABLE_EXTENSIONS) {
    const indexCandidate = resolve(absoluteBase, `index${extension}`);
    if (existsSync(indexCandidate)) return indexCandidate;
  }
  return undefined;
};

const doesImportPathPlausiblyTargetFlagged = (
  lineText: string,
  flaggedRelativeWithoutExt: string,
  flaggedAbsolutePath: string,
  evidenceFilePath: string,
): boolean => {
  const importPaths = extractImportPaths(lineText);
  if (importPaths.length === 0) return false;
  for (const importPath of importPaths) {
    const resolvedImportPath = resolveRelativeImportCandidate(importPath, evidenceFilePath);
    if (resolvedImportPath && resolvedImportPath === flaggedAbsolutePath) {
      return true;
    }

    if (!importPath.startsWith(".")) {
      return false;
    }

    if (flaggedAbsolutePath.includes("/__mocks__/") && !importPath.includes("__mocks__")) {
      return false;
    }

    const strippedSpecifier = importPath
      .replace(/^@[\w-]+\/[\w-]+\//, "")
      .replace(/^\.{1,2}\//, "")
      .replace(/\.[cm]?[jt]sx?$/, "");
    if (!strippedSpecifier) continue;

    if (strippedSpecifier.includes("/")) {
      if (flaggedRelativeWithoutExt.endsWith(strippedSpecifier)) return true;
      const flaggedTail = flaggedRelativeWithoutExt.split("/").slice(-2).join("/");
      const importTail = strippedSpecifier.split("/").slice(-2).join("/");
      if (flaggedTail === importTail) return true;
    }
  }
  return false;
};

const isCommentedImportLine = (lineText: string): boolean => {
  const trimmedLine = lineText.trimStart();
  return trimmedLine.startsWith("//") || trimmedLine.startsWith("*");
};

const findOtherFilesWithSameBasename = async (
  flaggedPath: string,
  basenameWithoutExt: string,
  extension: string,
  searchDir: string,
): Promise<string[]> => {
  const sameBasename = basenameWithoutExt + extension;
  const matched = await ripgrepFilesWithMatches("", searchDir, {
    timeoutMs: 5_000,
    extraArgs: ["--files", "--glob", `**/${sameBasename}`],
  });
  const candidates: string[] = [];
  for (const filePath of matched.files) {
    if (filePath === flaggedPath) continue;
    if (basename(filePath) === sameBasename) candidates.push(filePath);
  }
  return candidates;
};

const isTsConfigPathsOnlyReference = (filePath: string, basenameWithoutExt: string): boolean => {
  const isTsconfig = filePath.endsWith("tsconfig.json") || /tsconfig\.[\w-]+\.json$/.test(filePath);
  if (!isTsconfig) return false;
  try {
    const text = readFileSync(filePath, "utf-8");
    const pathsBlockMatch = text.match(/"paths"\s*:\s*\{[\s\S]*?\}/);
    if (!pathsBlockMatch || !pathsBlockMatch[0].includes(basenameWithoutExt)) return false;
    const includeBlockMatch = text.match(/"include"\s*:\s*\[[\s\S]*?\]/);
    const filesBlockMatch = text.match(/"files"\s*:\s*\[[\s\S]*?\]/);
    const inIncludeOrFiles =
      (includeBlockMatch && includeBlockMatch[0].includes(basenameWithoutExt)) ||
      (filesBlockMatch && filesBlockMatch[0].includes(basenameWithoutExt));
    if (inIncludeOrFiles) return false;
    return true;
  } catch {
    return false;
  }
};

const looksLikeSourceFileReference = (
  filePath: string,
  basenameWithoutExt: string,
  extension: string,
): boolean => {
  if (filePath.endsWith("package.json")) {
    return false;
  }
  const expectedExtensionPattern = new RegExp(
    `${basenameWithoutExt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\${extension.replace(".", "\\.")}(?:['"\`]|$)`,
  );
  try {
    const text = readFileSync(filePath, "utf-8");
    if (!expectedExtensionPattern.test(text)) return false;
    if (text.includes(`/${basenameWithoutExt}${extension}`)) return true;
    if (text.includes(`./${basenameWithoutExt}${extension}`)) return true;
    if (text.includes(`"${basenameWithoutExt}${extension}"`)) return true;
    if (text.includes(`'${basenameWithoutExt}${extension}'`)) return true;
    return false;
  } catch {
    return false;
  }
};

const isTsConfigExcludeOnlyReference = (filePath: string, basenameWithoutExt: string): boolean => {
  const isTsconfig = filePath.endsWith("tsconfig.json") || /tsconfig\.[\w-]+\.json$/.test(filePath);
  if (!isTsconfig) return false;
  try {
    const text = readFileSync(filePath, "utf-8");
    const excludeBlockMatch = text.match(/"exclude"\s*:\s*\[[\s\S]*?\]/);
    if (!excludeBlockMatch || !excludeBlockMatch[0].includes(basenameWithoutExt)) return false;
    const includeBlockMatch = text.match(/"include"\s*:\s*\[[\s\S]*?\]/);
    const filesBlockMatch = text.match(/"files"\s*:\s*\[[\s\S]*?\]/);
    const inIncludeOrFiles =
      (includeBlockMatch && includeBlockMatch[0].includes(basenameWithoutExt)) ||
      (filesBlockMatch && filesBlockMatch[0].includes(basenameWithoutExt));
    return !inIncludeOrFiles;
  } catch {
    return false;
  }
};

export const verifyUnusedFile = async (
  flaggedFile: AnalyzeFlaggedFile,
  searchDir: string,
  options: { otherFlaggedFiles?: ReadonlySet<string> } = {},
): Promise<VerifiedFile> => {
  const extension = extname(flaggedFile.path);
  const basenameWithExt = basename(flaggedFile.path);
  const basenameWithoutExt = basenameWithExt.slice(0, basenameWithExt.length - extension.length);
  const relativeFromSearchDir = relative(searchDir, flaggedFile.path);

  const escapedBasename = escapeRipgrepLiteral(basenameWithoutExt);
  const escapedRelative = escapeRipgrepLiteral(relativeFromSearchDir);
  const exclude = new Set<string>([flaggedFile.path]);
  if (options.otherFlaggedFiles) {
    for (const otherFlaggedPath of options.otherFlaggedFiles) exclude.add(otherFlaggedPath);
  }

  if (relativeFromSearchDir && !relativeFromSearchDir.startsWith("..")) {
    const explicitPathPattern = `['"\`](?:\\.{1,2}/)?(?:[^'"\`\\n]*?/)?${escapedRelative}['"\`]`;
    const explicitPathHits = await ripgrepFilesWithMatches(explicitPathPattern, searchDir, {
      timeoutMs: 15_000,
    });
    for (const filePath of explicitPathHits.files) {
      if (exclude.has(filePath)) continue;
      if (isDocumentationPath(filePath)) continue;
      if (isTsConfigPathsOnlyReference(filePath, basenameWithoutExt)) continue;
      if (isTsConfigExcludeOnlyReference(filePath, basenameWithoutExt)) continue;
      return {
        ...flaggedFile,
        verdict: {
          kind: "likely_fp",
          reason: "explicit path referenced from non-flagged source",
          evidence: filePath,
        },
      };
    }
  }

  if (!basenameWithoutExt) {
    return { ...flaggedFile, verdict: SKIPPED_VERDICT };
  }

  const sameBasenameFiles = await findOtherFilesWithSameBasename(
    flaggedFile.path,
    basenameWithoutExt,
    extension,
    searchDir,
  );

  const importContextPattern = `(?:from|import|require)\\s*\\(?\\s*['"\`][^'"\`\\n]*?${escapedBasename}(?:\\.[cm]?[jt]sx?)?['"\`]`;
  const lineMatches = await ripgrepLineMatches(importContextPattern, searchDir, {
    timeoutMs: 15_000,
  });
  const relativeWithoutExt = relativeFromSearchDir.slice(
    0,
    relativeFromSearchDir.length - extension.length,
  );
  for (const lineMatch of lineMatches) {
    if (exclude.has(lineMatch.filePath)) continue;
    if (isDocumentationPath(lineMatch.filePath)) continue;
    if (isCommentedImportLine(lineMatch.lineText)) continue;
    if (
      !doesImportPathPlausiblyTargetFlagged(
        lineMatch.lineText,
        relativeWithoutExt,
        flaggedFile.path,
        lineMatch.filePath,
      )
    ) {
      continue;
    }
    if (sameBasenameFiles.length > 0) continue;
    return {
      ...flaggedFile,
      verdict: {
        kind: "likely_fp",
        reason: "basename imported from non-flagged source",
        evidence: lineMatch.filePath,
      },
    };
  }

  const tsConfigPattern = `['"\`](?:[^'"\`\\n]*?[/.])?${escapedBasename}\\.[cm]?[jt]sx?['"\`]`;
  const tsConfigHits = await ripgrepFilesWithMatches(tsConfigPattern, searchDir, {
    timeoutMs: 15_000,
    extraArgs: ["--glob", "tsconfig*.json", "--glob", "package.json"],
  });
  for (const filePath of tsConfigHits.files) {
    if (exclude.has(filePath)) continue;
    if (isTsConfigPathsOnlyReference(filePath, basenameWithoutExt)) continue;
    if (isTsConfigExcludeOnlyReference(filePath, basenameWithoutExt)) continue;
    if (!looksLikeSourceFileReference(filePath, basenameWithoutExt, extension)) continue;
    return {
      ...flaggedFile,
      verdict: {
        kind: "likely_fp",
        reason: "referenced from tsconfig include/files or package.json",
        evidence: filePath,
      },
    };
  }

  return {
    ...flaggedFile,
    verdict: { kind: "likely_tp", reason: "no import/path reference found" },
  };
};

export const verifyUnusedFilesBatch = async (
  flaggedFiles: AnalyzeFlaggedFile[],
  searchDir: string,
  options: { concurrency?: number; allFlaggedFilePaths?: ReadonlySet<string> } = {},
): Promise<VerifiedFile[]> => {
  const verified: VerifiedFile[] = new Array(flaggedFiles.length);
  const otherFlaggedFiles =
    options.allFlaggedFilePaths ?? new Set(flaggedFiles.map((flaggedFile) => flaggedFile.path));
  const concurrency = options.concurrency ?? 6;
  let nextIndex = 0;

  const runOne = async (): Promise<void> => {
    while (nextIndex < flaggedFiles.length) {
      const currentIndex = nextIndex++;
      verified[currentIndex] = await verifyUnusedFile(flaggedFiles[currentIndex], searchDir, {
        otherFlaggedFiles,
      });
    }
  };

  const workers: Promise<void>[] = [];
  const workerCount = Math.max(1, Math.min(concurrency, flaggedFiles.length));
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) workers.push(runOne());
  await Promise.all(workers);
  return verified;
};
