export interface RepoEntry {
  org: string;
  name: string;
  ref: string;
  rootDir: string;
}

export interface CorpusEntry extends RepoEntry {
  slug: string;
  clonedRepoPath: string;
  analyzeDir: string;
  isPresent: boolean;
}

export interface CloneOutcome {
  entry: RepoEntry;
  slug: string;
  clonedRepoPath: string;
  status: "cached" | "cloned" | "failed";
  errorMessage?: string;
  durationMs: number;
}

export interface AnalyzeFlaggedFile {
  path: string;
}

export interface AnalyzeFlaggedExport {
  path: string;
  name: string;
  line: number;
  column: number;
  isTypeOnly: boolean;
}

export interface AnalyzeFlaggedDependency {
  name: string;
  isDevDependency: boolean;
}

export interface AnalyzeCircularDependency {
  files: string[];
}

export interface AnalyzeResult {
  unusedFiles: AnalyzeFlaggedFile[];
  unusedExports: AnalyzeFlaggedExport[];
  unusedDependencies: AnalyzeFlaggedDependency[];
  circularDependencies: AnalyzeCircularDependency[];
  totalFiles: number;
  totalExports: number;
  analysisTimeMs: number;
}

export interface EntryRunOutcome {
  entry: CorpusEntry;
  status: "ok" | "crash" | "timeout";
  errorMessage?: string;
  durationMs: number;
  result?: AnalyzeResult;
}

export interface VerificationVerdict {
  kind: "likely_tp" | "likely_fp" | "skipped";
  reason?: string;
  evidence?: string;
}

export interface VerifiedExport extends AnalyzeFlaggedExport {
  verdict: VerificationVerdict;
}

export interface VerifiedFile extends AnalyzeFlaggedFile {
  verdict: VerificationVerdict;
}

export interface VerifiedDependency extends AnalyzeFlaggedDependency {
  verdict: VerificationVerdict;
}

export interface EntryVerifiedReport {
  entry: CorpusEntry;
  status: "ok" | "crash" | "timeout";
  errorMessage?: string;
  durationMs: number;
  unusedFiles: VerifiedFile[];
  unusedExports: VerifiedExport[];
  unusedDependencies: VerifiedDependency[];
  totalFiles: number;
  totalExports: number;
  analysisTimeMs: number;
}

export interface MetricsBreakdown {
  totalFlagged: number;
  likelyTrue: number;
  likelyFalse: number;
  skipped: number;
  fpRate: number;
}

export interface RunMetrics {
  files: MetricsBreakdown;
  exports: MetricsBreakdown;
  dependencies: MetricsBreakdown;
  combined: MetricsBreakdown;
  score: number;
  crashes: number;
  timeouts: number;
  entriesProcessed: number;
  totalAnalysisTimeMs: number;
  totalWallTimeMs: number;
}

export interface RunArtifact {
  commitSha: string;
  parentSha: string | undefined;
  iterationIndex: number;
  startedAtIso: string;
  finishedAtIso: string;
  corpusSlug: string;
  corpusSize: number;
  perEntry: EntryVerifiedReport[];
  metrics: RunMetrics;
  description: string;
}

export interface MutationProposal {
  id: string;
  description: string;
  apply: () => Promise<MutationApplyResult>;
}

export interface MutationApplyResult {
  changedFiles: string[];
  notes?: string;
}

export interface LoopOptions {
  corpus: "fast" | "mid" | "full" | "all";
  iterationBudgetMs: number;
  description?: string;
}
