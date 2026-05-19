import { homedir } from "node:os";
import { resolve } from "node:path";

export const REPO_CACHE_DIR = resolve(homedir(), ".cache/deslop-autoresearch/repos");
export const REPORTS_DIR = resolve(import.meta.dirname, "..", "reports");
export const SNAPSHOTS_DIR = resolve(import.meta.dirname, "..", "snapshots");
export const RESULTS_TSV_PATH = resolve(import.meta.dirname, "..", "results.tsv");
export const CORPUS_SAMPLES_DIR = resolve(import.meta.dirname, "..", "corpus-samples");
export const STATUS_FILE_PATH = resolve(import.meta.dirname, "..", "status.json");
export const HYPOTHESES_LOG_PATH = resolve(import.meta.dirname, "..", "hypotheses.log");

export const REPOS_JSON_PATH = resolve(import.meta.dirname, "..", "..", "..", "repos.json");
export const DESLOP_PACKAGE_DIR = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "packages",
  "deslop-js",
);
export const DESLOP_SRC_DIR = resolve(DESLOP_PACKAGE_DIR, "src");
export const DESLOP_DIST_INDEX = resolve(DESLOP_PACKAGE_DIR, "dist", "index.mjs");

export const GIT_CLONE_TIMEOUT_MS = 300_000;
export const PER_ENTRY_ANALYSIS_TIMEOUT_MS = 180_000;
export const PER_ENTRY_VERIFY_TIMEOUT_MS = 120_000;

export const FAST_TIER_MAX_ENTRIES = 25;
export const MID_TIER_MAX_ENTRIES = 80;
export const FULL_TIER_MAX_ENTRIES = 200;

export const FP_PENALTY_WEIGHT = 4;

export const VERIFIABLE_EXPORT_MIN_NAME_LENGTH = 4;

export const SKIP_EXPORT_NAMES = new Set([
  "default",
  "*",
  "index",
  "main",
  "Main",
  "App",
  "Page",
  "Layout",
  "Loading",
  "Error",
  "config",
  "Config",
  "metadata",
  "Metadata",
  "options",
  "Options",
  "data",
  "props",
  "Props",
  "params",
  "Params",
  "schema",
  "Schema",
  "type",
  "Type",
  "name",
  "Name",
  "value",
  "Value",
  "items",
  "list",
  "List",
  "item",
  "Item",
  "id",
  "key",
  "Key",
  "url",
  "Url",
]);

export const SCRIPT_TIMEOUT_MS = 60_000;
