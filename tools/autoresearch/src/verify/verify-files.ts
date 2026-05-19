import { basename, extname, relative } from "node:path";
import type { AnalyzeFlaggedFile, VerifiedFile, VerificationVerdict } from "../types.js";
import { ripgrepFilesWithMatches, escapeRipgrepLiteral } from "./grep-corpus.js";

const SKIPPED_VERDICT: VerificationVerdict = {
  kind: "skipped",
  reason: "ambiguous-basename",
};

const COMMON_BASENAMES = new Set([
  "index",
  "main",
  "app",
  "page",
  "layout",
  "route",
  "loading",
  "error",
  "default",
  "button",
  "input",
  "dialog",
  "select",
  "popover",
  "tooltip",
  "card",
  "table",
  "form",
  "list",
  "menu",
  "label",
  "alert",
  "avatar",
  "badge",
  "checkbox",
  "switch",
  "tabs",
  "drawer",
  "modal",
  "sheet",
  "command",
  "field",
  "separator",
  "spinner",
  "loader",
  "header",
  "footer",
  "sidebar",
  "nav",
  "navigation",
  "icon",
  "logo",
  "image",
  "link",
  "text",
  "title",
  "heading",
  "section",
  "container",
  "wrapper",
  "panel",
  "row",
  "column",
  "grid",
  "stack",
  "flex",
  "box",
  "div",
  "span",
  "p",
  "h1",
  "h2",
  "h3",
  "utils",
  "helpers",
  "constants",
  "types",
  "schema",
  "config",
  "client",
  "server",
  "api",
  "actions",
  "hooks",
  "store",
  "context",
  "provider",
  "reducer",
  "slice",
  "selector",
  "service",
  "model",
  "view",
  "controller",
]);

const isAmbiguousBasename = (basenameWithoutExt: string): boolean => {
  const lowered = basenameWithoutExt.toLowerCase();
  if (lowered.length < 5) return true;
  if (COMMON_BASENAMES.has(lowered)) return true;
  return false;
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
    lowered.includes("/__snapshots__/")
  );
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

  if (!isAmbiguousBasename(basenameWithoutExt)) {
    const importContextPattern = `(?:from|import|require)\\s*\\(?\\s*['"\`][^'"\`\\n]*?${escapedBasename}(?:\\.[cm]?[jt]sx?)?['"\`]`;
    const importHits = await ripgrepFilesWithMatches(importContextPattern, searchDir, {
      timeoutMs: 15_000,
    });
    for (const filePath of importHits.files) {
      if (exclude.has(filePath)) continue;
      if (isDocumentationPath(filePath)) continue;
      return {
        ...flaggedFile,
        verdict: {
          kind: "likely_fp",
          reason: "basename imported from non-flagged source",
          evidence: filePath,
        },
      };
    }

    const tsConfigPattern = `['"\`][^'"\`\\n]*?${escapedBasename}['"\`]`;
    const tsConfigHits = await ripgrepFilesWithMatches(tsConfigPattern, searchDir, {
      timeoutMs: 15_000,
      extraArgs: ["--glob", "tsconfig*.json", "--glob", "package.json"],
    });
    for (const filePath of tsConfigHits.files) {
      if (exclude.has(filePath)) continue;
      return {
        ...flaggedFile,
        verdict: {
          kind: "likely_fp",
          reason: "referenced from tsconfig/package.json",
          evidence: filePath,
        },
      };
    }
  } else {
    return { ...flaggedFile, verdict: SKIPPED_VERDICT };
  }

  return {
    ...flaggedFile,
    verdict: { kind: "likely_tp", reason: "no import/path reference found" },
  };
};

export const verifyUnusedFilesBatch = async (
  flaggedFiles: AnalyzeFlaggedFile[],
  searchDir: string,
  options: { concurrency?: number } = {},
): Promise<VerifiedFile[]> => {
  const verified: VerifiedFile[] = new Array(flaggedFiles.length);
  const otherFlaggedFiles = new Set(flaggedFiles.map((flaggedFile) => flaggedFile.path));
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
