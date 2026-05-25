import { homedir } from "node:os";
import { resolve } from "node:path";

export const BENCHMARK_CACHE_DIR = resolve(homedir(), ".cache/deslop-benchmark/repos");
export const REPORTS_DIR = resolve(import.meta.dirname, "..", "reports");

export const DESLOP_PACKAGE_DIR = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "packages",
  "deslop-js",
);
export const DESLOP_DIST_INDEX = resolve(DESLOP_PACKAGE_DIR, "dist", "index.mjs");

export const GIT_CLONE_TIMEOUT_MS = 300_000;
export const PER_ENTRY_ANALYSIS_TIMEOUT_MS = 300_000;
export const INSTALL_DEPS_TIMEOUT_MS = 300_000;
export const CLONE_CONCURRENCY = 4;
export const ANALYSIS_CONCURRENCY = 2;
