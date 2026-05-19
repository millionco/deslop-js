import { spawn } from "node:child_process";

const RIPGREP_EXCLUDE_GLOBS = [
  "--glob",
  "!node_modules",
  "--glob",
  "!**/node_modules/**",
  "--glob",
  "!.git",
  "--glob",
  "!**/.git/**",
  "--glob",
  "!dist",
  "--glob",
  "!**/dist/**",
  "--glob",
  "!build",
  "--glob",
  "!**/build/**",
  "--glob",
  "!coverage",
  "--glob",
  "!**/coverage/**",
  "--glob",
  "!.next",
  "--glob",
  "!**/.next/**",
  "--glob",
  "!.turbo",
  "--glob",
  "!**/.turbo/**",
  "--glob",
  "!.parcel-cache",
  "--glob",
  "!**/.parcel-cache/**",
  "--glob",
  "!.expo",
  "--glob",
  "!**/.expo/**",
  "--glob",
  "!storybook-static",
  "--glob",
  "!**/storybook-static/**",
  "--glob",
  "!*.min.js",
  "--glob",
  "!*.map",
];

const DEFAULT_TIMEOUT_MS = 30_000;

interface RipgrepFilesWithMatchesResult {
  files: Set<string>;
}

export const ripgrepFilesWithMatches = (
  pattern: string,
  searchDir: string,
  options: { timeoutMs?: number; extraArgs?: string[] } = {},
): Promise<RipgrepFilesWithMatchesResult> => {
  return new Promise((resolvePromise) => {
    const args = [
      "--files-with-matches",
      "--no-messages",
      "--no-config",
      "--null",
      ...RIPGREP_EXCLUDE_GLOBS,
      ...(options.extraArgs ?? []),
      pattern,
      searchDir,
    ];
    const child = spawn("rg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const timeoutHandle = setTimeout(() => {
      child.kill("SIGKILL");
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.on("close", () => {
      clearTimeout(timeoutHandle);
      const outputText = Buffer.concat(stdoutChunks).toString("utf-8");
      const files = new Set<string>();
      for (const filePath of outputText.split("\0")) {
        if (filePath) files.add(filePath);
      }
      resolvePromise({ files });
    });
    child.on("error", () => {
      clearTimeout(timeoutHandle);
      resolvePromise({ files: new Set() });
    });
  });
};

export const escapeRipgrepLiteral = (input: string): string => {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const escapeIdentifier = (identifier: string): string => escapeRipgrepLiteral(identifier);

export interface NameUsageQuery {
  identifier: string;
  excludePaths: string[];
}

export interface NameUsageVerdict {
  identifier: string;
  hasExternalUsage: boolean;
  matchingPaths: string[];
}

const SOURCE_FILE_GLOBS = [
  "--type-add",
  "deslop:*.{ts,tsx,js,jsx,mts,mjs,cts,cjs,vue,svelte,astro,mdx,md,html,json,yaml,yml,toml}",
  "--type",
  "deslop",
];

export const queryNameUsages = async (
  query: NameUsageQuery,
  searchDir: string,
  options: { timeoutMs?: number } = {},
): Promise<NameUsageVerdict> => {
  if (!query.identifier) {
    return { identifier: query.identifier, hasExternalUsage: false, matchingPaths: [] };
  }
  const pattern = `\\b${escapeIdentifier(query.identifier)}\\b`;
  const result = await ripgrepFilesWithMatches(pattern, searchDir, {
    timeoutMs: options.timeoutMs,
    extraArgs: SOURCE_FILE_GLOBS,
  });
  const matchingPaths: string[] = [];
  const excludeSet = new Set(query.excludePaths);
  for (const filePath of result.files) {
    if (excludeSet.has(filePath)) continue;
    matchingPaths.push(filePath);
  }
  return {
    identifier: query.identifier,
    hasExternalUsage: matchingPaths.length > 0,
    matchingPaths,
  };
};

export const queryNameUsagesBatch = async (
  queries: NameUsageQuery[],
  searchDir: string,
  options: { timeoutMs?: number; concurrency?: number } = {},
): Promise<Map<string, NameUsageVerdict>> => {
  const verdictsByKey = new Map<string, NameUsageVerdict>();
  const concurrency = options.concurrency ?? 8;
  let nextIndex = 0;

  const runOne = async (): Promise<void> => {
    while (nextIndex < queries.length) {
      const currentIndex = nextIndex++;
      const query = queries[currentIndex];
      const queryKey = `${query.identifier}\0${query.excludePaths.join("|")}`;
      if (verdictsByKey.has(queryKey)) continue;
      const verdict = await queryNameUsages(query, searchDir, {
        timeoutMs: options.timeoutMs,
      });
      verdictsByKey.set(queryKey, verdict);
    }
  };

  const workers: Promise<void>[] = [];
  const workerCount = Math.max(1, Math.min(concurrency, queries.length));
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) workers.push(runOne());
  await Promise.all(workers);
  return verdictsByKey;
};

export interface DependencyUsageQuery {
  packageName: string;
}

export const queryDependencyUsage = async (
  query: DependencyUsageQuery,
  searchDir: string,
  options: { timeoutMs?: number } = {},
): Promise<{ packageName: string; isImported: boolean; matchingPaths: string[] }> => {
  const escapedPackage = escapeIdentifier(query.packageName);
  const importPattern = `(?:from|require)\\s*\\(?\\s*['"\`](?:${escapedPackage})(?:/[^'"\`]*)?['"\`]`;
  const result = await ripgrepFilesWithMatches(importPattern, searchDir, {
    timeoutMs: options.timeoutMs,
    extraArgs: SOURCE_FILE_GLOBS,
  });
  if (result.files.size > 0) {
    return {
      packageName: query.packageName,
      isImported: true,
      matchingPaths: [...result.files],
    };
  }
  const importDirective = `import\\s+(?:[^'"\`]+\\s+from\\s+)?['"\`](?:${escapedPackage})(?:/[^'"\`]*)?['"\`]`;
  const fallback = await ripgrepFilesWithMatches(importDirective, searchDir, {
    timeoutMs: options.timeoutMs,
    extraArgs: SOURCE_FILE_GLOBS,
  });
  return {
    packageName: query.packageName,
    isImported: fallback.files.size > 0,
    matchingPaths: [...fallback.files],
  };
};
