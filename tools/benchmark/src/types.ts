export interface BenchmarkRepo {
  org: string;
  name: string;
  stars: number;
  defaultBranch: string;
}

export interface CloneOutcome {
  repo: BenchmarkRepo;
  repoDir: string;
  status: "cached" | "cloned" | "failed";
  errorMessage?: string;
  durationMs: number;
}

export interface FlaggedExport {
  path: string;
  name: string;
  line: number;
  column: number;
  isTypeOnly: boolean;
}

export interface FlaggedFile {
  path: string;
}

export interface FlaggedDependency {
  name: string;
}

export interface ToolResult {
  unusedFiles: FlaggedFile[];
  unusedExports: FlaggedExport[];
  unusedDependencies: FlaggedDependency[];
  totalFiles: number;
  totalExports: number;
  analysisTimeMs: number;
  error?: string;
}

export interface VerificationVerdict {
  kind: "likely_tp" | "likely_fp" | "skipped";
  reason?: string;
}

export interface VerifiedFinding {
  identifier: string;
  category: "file" | "export" | "dependency";
  verdict: VerificationVerdict;
}

export interface RepoToolResult {
  tool: "deslop" | "knip";
  repo: BenchmarkRepo;
  status: "ok" | "crash" | "timeout";
  errorMessage?: string;
  durationMs: number;
  result?: ToolResult;
  verified?: {
    files: Array<FlaggedFile & { verdict: VerificationVerdict }>;
    exports: Array<FlaggedExport & { verdict: VerificationVerdict }>;
    dependencies: Array<FlaggedDependency & { verdict: VerificationVerdict }>;
  };
}

export interface MetricsBreakdown {
  totalFlagged: number;
  likelyTrue: number;
  likelyFalse: number;
  skipped: number;
  falsePositiveRate: number;
}

export interface ToolMetrics {
  files: MetricsBreakdown;
  exports: MetricsBreakdown;
  dependencies: MetricsBreakdown;
  combined: MetricsBreakdown;
  totalAnalysisTimeMs: number;
  successfulRepos: number;
  failedRepos: number;
}

export interface BenchmarkReport {
  generatedAt: string;
  repoCount: number;
  deslop: ToolMetrics;
  knip: ToolMetrics;
  perRepo: Array<{
    repo: BenchmarkRepo;
    deslop: RepoToolResult;
    knip: RepoToolResult;
  }>;
}
