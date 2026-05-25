import type {
  MetricsBreakdown,
  ToolMetrics,
  RepoToolResult,
  VerificationVerdict,
  BenchmarkReport,
} from "./types.js";

const emptyBreakdown = (): MetricsBreakdown => ({
  totalFlagged: 0,
  likelyTrue: 0,
  likelyFalse: 0,
  skipped: 0,
  falsePositiveRate: 0,
});

const sumVerdicts = (verdicts: Array<{ verdict: VerificationVerdict }>): MetricsBreakdown => {
  const breakdown = emptyBreakdown();
  for (const item of verdicts) {
    breakdown.totalFlagged++;
    if (item.verdict.kind === "likely_tp") breakdown.likelyTrue++;
    else if (item.verdict.kind === "likely_fp") breakdown.likelyFalse++;
    else breakdown.skipped++;
  }
  const verified = breakdown.likelyTrue + breakdown.likelyFalse;
  breakdown.falsePositiveRate = verified > 0 ? breakdown.likelyFalse / verified : 0;
  return breakdown;
};

const mergeBreakdowns = (breakdowns: MetricsBreakdown[]): MetricsBreakdown => {
  const merged = emptyBreakdown();
  for (const breakdown of breakdowns) {
    merged.totalFlagged += breakdown.totalFlagged;
    merged.likelyTrue += breakdown.likelyTrue;
    merged.likelyFalse += breakdown.likelyFalse;
    merged.skipped += breakdown.skipped;
  }
  const verified = merged.likelyTrue + merged.likelyFalse;
  merged.falsePositiveRate = verified > 0 ? merged.likelyFalse / verified : 0;
  return merged;
};

export const computeToolMetrics = (results: RepoToolResult[]): ToolMetrics => {
  const allFileVerdicts: Array<{ verdict: VerificationVerdict }> = [];
  const allExportVerdicts: Array<{ verdict: VerificationVerdict }> = [];
  const allDepVerdicts: Array<{ verdict: VerificationVerdict }> = [];
  let totalAnalysisTimeMs = 0;
  let successfulRepos = 0;
  let failedRepos = 0;

  for (const result of results) {
    if (result.status === "ok") {
      successfulRepos++;
      totalAnalysisTimeMs += result.durationMs;
      if (result.verified) {
        allFileVerdicts.push(...result.verified.files);
        allExportVerdicts.push(...result.verified.exports);
        allDepVerdicts.push(...result.verified.dependencies);
      }
    } else {
      failedRepos++;
    }
  }

  const filesBreakdown = sumVerdicts(allFileVerdicts);
  const exportsBreakdown = sumVerdicts(allExportVerdicts);
  const depsBreakdown = sumVerdicts(allDepVerdicts);
  const combinedBreakdown = mergeBreakdowns([filesBreakdown, exportsBreakdown, depsBreakdown]);

  return {
    files: filesBreakdown,
    exports: exportsBreakdown,
    dependencies: depsBreakdown,
    combined: combinedBreakdown,
    totalAnalysisTimeMs,
    successfulRepos,
    failedRepos,
  };
};

const formatBreakdownRow = (label: string, breakdown: MetricsBreakdown): string => {
  const falsePositivePercent = (breakdown.falsePositiveRate * 100).toFixed(1);
  return `| ${label.padEnd(14)} | ${String(breakdown.totalFlagged).padStart(6)} | ${String(breakdown.likelyTrue).padStart(6)} | ${String(breakdown.likelyFalse).padStart(6)} | ${String(breakdown.skipped).padStart(6)} | ${falsePositivePercent.padStart(6)}% |`;
};

export const formatComparisonTable = (report: BenchmarkReport): string => {
  const lines: string[] = [];

  lines.push(`# Benchmark: deslop-js vs knip — Top ${report.repoCount} React Projects`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric           | deslop-js | knip     |`);
  lines.push(`| ---------------- | --------- | -------- |`);
  lines.push(
    `| Successful repos | ${report.deslop.successfulRepos}         | ${report.knip.successfulRepos}        |`,
  );
  lines.push(
    `| Failed repos     | ${report.deslop.failedRepos}         | ${report.knip.failedRepos}        |`,
  );
  lines.push(
    `| Total flagged    | ${report.deslop.combined.totalFlagged}         | ${report.knip.combined.totalFlagged}        |`,
  );
  lines.push(
    `| Likely TP        | ${report.deslop.combined.likelyTrue}         | ${report.knip.combined.likelyTrue}        |`,
  );
  lines.push(
    `| Likely FP        | ${report.deslop.combined.likelyFalse}         | ${report.knip.combined.likelyFalse}        |`,
  );
  lines.push(
    `| FP rate          | ${(report.deslop.combined.falsePositiveRate * 100).toFixed(1)}%       | ${(report.knip.combined.falsePositiveRate * 100).toFixed(1)}%      |`,
  );
  lines.push(
    `| Analysis time    | ${(report.deslop.totalAnalysisTimeMs / 1000).toFixed(1)}s       | ${(report.knip.totalAnalysisTimeMs / 1000).toFixed(1)}s      |`,
  );
  lines.push("");

  lines.push("## deslop-js Breakdown");
  lines.push("");
  lines.push("| Category       | Flagged | TP     | FP     | Skip   | FP Rate |");
  lines.push("| -------------- | ------- | ------ | ------ | ------ | ------- |");
  lines.push(formatBreakdownRow("files", report.deslop.files));
  lines.push(formatBreakdownRow("exports", report.deslop.exports));
  lines.push(formatBreakdownRow("dependencies", report.deslop.dependencies));
  lines.push(formatBreakdownRow("combined", report.deslop.combined));
  lines.push("");

  lines.push("## knip Breakdown");
  lines.push("");
  lines.push("| Category       | Flagged | TP     | FP     | Skip   | FP Rate |");
  lines.push("| -------------- | ------- | ------ | ------ | ------ | ------- |");
  lines.push(formatBreakdownRow("files", report.knip.files));
  lines.push(formatBreakdownRow("exports", report.knip.exports));
  lines.push(formatBreakdownRow("dependencies", report.knip.dependencies));
  lines.push(formatBreakdownRow("combined", report.knip.combined));
  lines.push("");

  lines.push("## Per-Repo Results");
  lines.push("");
  lines.push("| Repo | deslop FP | deslop TP | knip FP | knip TP | deslop status | knip status |");
  lines.push("| ---- | --------- | --------- | ------- | ------- | ------------- | ----------- |");

  for (const entry of report.perRepo) {
    const repoName = `${entry.repo.org}/${entry.repo.name}`;

    const deslopFalsePositives = entry.deslop.verified
      ? [
          ...entry.deslop.verified.files,
          ...entry.deslop.verified.exports,
          ...entry.deslop.verified.dependencies,
        ].filter((item) => item.verdict.kind === "likely_fp").length
      : 0;
    const deslopTruePositives = entry.deslop.verified
      ? [
          ...entry.deslop.verified.files,
          ...entry.deslop.verified.exports,
          ...entry.deslop.verified.dependencies,
        ].filter((item) => item.verdict.kind === "likely_tp").length
      : 0;
    const knipFalsePositives = entry.knip.verified
      ? [
          ...entry.knip.verified.files,
          ...entry.knip.verified.exports,
          ...entry.knip.verified.dependencies,
        ].filter((item) => item.verdict.kind === "likely_fp").length
      : 0;
    const knipTruePositives = entry.knip.verified
      ? [
          ...entry.knip.verified.files,
          ...entry.knip.verified.exports,
          ...entry.knip.verified.dependencies,
        ].filter((item) => item.verdict.kind === "likely_tp").length
      : 0;

    lines.push(
      `| ${repoName} | ${deslopFalsePositives} | ${deslopTruePositives} | ${knipFalsePositives} | ${knipTruePositives} | ${entry.deslop.status} | ${entry.knip.status} |`,
    );
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    'FP rate = likely_fp / (likely_tp + likely_fp). A "likely_fp" is a finding where grep evidence suggests the identifier/file/dep IS actually used elsewhere in the repo. A "likely_tp" means no such evidence was found.',
  );

  return lines.join("\n");
};
