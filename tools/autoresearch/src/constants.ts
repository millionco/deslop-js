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

/**
 * Score = likelyTrue - FP_PENALTY_WEIGHT * likelyFalse.
 *
 * Chosen as 4 to bias the autonomous loop toward keeping mutations only when
 * they add 4+ real findings per new false-positive — an arbitrary "FPs are
 * 4× more costly than TPs are valuable" stance. It is NOT empirically
 * derived. If the loop optimizes for `score`, it can still drift upward by
 * adding many `likely_tp` findings that the ripgrep verifier merely failed
 * to refute (see verificationCoverage in MetricsBreakdown). Always read score
 * alongside coverage; raw score deltas are insufficient evidence on their own.
 */
export const FP_PENALTY_WEIGHT = 4;

/**
 * Names shorter than this are skipped from grep-based verification.
 * Previously 4 (skipped 3-char names like `Tab`, `Btn`, `Dot`). Lowered to 2
 * so the verifier attempts the same path-targeted check that long names get;
 * single-char names are still skipped because they collide with TS generics
 * (`T`, `K`) and minified identifiers.
 */
export const VERIFIABLE_EXPORT_MIN_NAME_LENGTH = 2;

/**
 * Names that fundamentally cannot be path-resolved via ripgrep import lines.
 * Previously this list held 40 entries (Next.js conventions like `Page`,
 * `Layout`, `Loading`, `Error`, `metadata`, `Props`, `Config`, etc.); those
 * were skipped before any verification was attempted, which silently moved
 * common-named findings out of the FP/TP denominator. Now reduced to the
 * two cases that ripgrep genuinely cannot disambiguate:
 *   - "default" — every default-import line is a candidate and the consumer's
 *     local binding name doesn't have to match anything verifiable.
 *   - "*"      — namespace re-exports have no identifier to grep for.
 * Everything else is verified via the same path-targeted matching that
 * non-common names get; if multiple files export the same identifier the
 * `countExportDeclarationsForIdentifier` ambiguity check still kicks in.
 */
export const SKIP_EXPORT_NAMES = new Set(["default", "*"]);

export const SCRIPT_TIMEOUT_MS = 60_000;
