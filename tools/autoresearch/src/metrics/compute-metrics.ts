import type {
  EntryVerifiedReport,
  MetricsBreakdown,
  RunMetrics,
  VerifiedDependency,
  VerifiedExport,
  VerifiedFile,
} from "../types.js";
import { FP_PENALTY_WEIGHT } from "../constants.js";

const emptyBreakdown = (): MetricsBreakdown => ({
  totalFlagged: 0,
  likelyTrue: 0,
  likelyFalse: 0,
  skipped: 0,
  fpRate: 0,
});

const sumBreakdown = (
  items: Array<{ verdict: { kind: "likely_tp" | "likely_fp" | "skipped" } }>,
): MetricsBreakdown => {
  const breakdown = emptyBreakdown();
  for (const item of items) {
    breakdown.totalFlagged++;
    if (item.verdict.kind === "likely_tp") breakdown.likelyTrue++;
    else if (item.verdict.kind === "likely_fp") breakdown.likelyFalse++;
    else breakdown.skipped++;
  }
  const verified = breakdown.likelyTrue + breakdown.likelyFalse;
  breakdown.fpRate = verified > 0 ? breakdown.likelyFalse / verified : 0;
  return breakdown;
};

export const computeMetricsForReports = (
  reports: EntryVerifiedReport[],
  totalWallTimeMs: number,
): RunMetrics => {
  const filesItems: VerifiedFile[] = [];
  const exportsItems: VerifiedExport[] = [];
  const dependenciesItems: VerifiedDependency[] = [];
  let crashes = 0;
  let timeouts = 0;
  let totalAnalysisTimeMs = 0;

  for (const report of reports) {
    if (report.status === "crash") crashes++;
    if (report.status === "timeout") timeouts++;
    totalAnalysisTimeMs += report.analysisTimeMs;
    filesItems.push(...report.unusedFiles);
    exportsItems.push(...report.unusedExports);
    dependenciesItems.push(...report.unusedDependencies);
  }

  const filesBreakdown = sumBreakdown(filesItems);
  const exportsBreakdown = sumBreakdown(exportsItems);
  const dependenciesBreakdown = sumBreakdown(dependenciesItems);

  const combined: MetricsBreakdown = emptyBreakdown();
  combined.totalFlagged =
    filesBreakdown.totalFlagged +
    exportsBreakdown.totalFlagged +
    dependenciesBreakdown.totalFlagged;
  combined.likelyTrue =
    filesBreakdown.likelyTrue + exportsBreakdown.likelyTrue + dependenciesBreakdown.likelyTrue;
  combined.likelyFalse =
    filesBreakdown.likelyFalse + exportsBreakdown.likelyFalse + dependenciesBreakdown.likelyFalse;
  combined.skipped =
    filesBreakdown.skipped + exportsBreakdown.skipped + dependenciesBreakdown.skipped;
  const verified = combined.likelyTrue + combined.likelyFalse;
  combined.fpRate = verified > 0 ? combined.likelyFalse / verified : 0;

  const score = combined.likelyTrue - FP_PENALTY_WEIGHT * combined.likelyFalse;

  return {
    files: filesBreakdown,
    exports: exportsBreakdown,
    dependencies: dependenciesBreakdown,
    combined,
    score,
    crashes,
    timeouts,
    entriesProcessed: reports.length,
    totalAnalysisTimeMs,
    totalWallTimeMs,
  };
};

const formatRow = (label: string, breakdown: MetricsBreakdown): string => {
  return `${label.padEnd(14)} flagged=${breakdown.totalFlagged
    .toString()
    .padStart(5)} likely_tp=${breakdown.likelyTrue
    .toString()
    .padStart(5)} likely_fp=${breakdown.likelyFalse
    .toString()
    .padStart(5)} skipped=${breakdown.skipped
    .toString()
    .padStart(5)} fp_rate=${(breakdown.fpRate * 100).toFixed(1)}%`;
};

export const formatMetricsSummary = (metrics: RunMetrics): string => {
  const lines = [
    `score=${metrics.score}  combined_fp_rate=${(metrics.combined.fpRate * 100).toFixed(2)}%`,
    formatRow("files", metrics.files),
    formatRow("exports", metrics.exports),
    formatRow("dependencies", metrics.dependencies),
    formatRow("combined", metrics.combined),
    `entries=${metrics.entriesProcessed} crashes=${metrics.crashes} timeouts=${metrics.timeouts}`,
    `analysis_time_ms=${metrics.totalAnalysisTimeMs} wall_time_ms=${metrics.totalWallTimeMs}`,
  ];
  return lines.join("\n");
};
