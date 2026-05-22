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
  confirmedFpRate: 0,
  verifiedFpRate: 0,
  verificationCoverage: 0,
});

const finalizeBreakdownRates = (breakdown: MetricsBreakdown): void => {
  const verified = breakdown.likelyTrue + breakdown.likelyFalse;
  breakdown.confirmedFpRate =
    breakdown.totalFlagged > 0 ? breakdown.likelyFalse / breakdown.totalFlagged : 0;
  breakdown.verifiedFpRate = verified > 0 ? breakdown.likelyFalse / verified : 0;
  breakdown.verificationCoverage =
    breakdown.totalFlagged > 0 ? verified / breakdown.totalFlagged : 0;
};

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
  finalizeBreakdownRates(breakdown);
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
  finalizeBreakdownRates(combined);

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
    .padStart(5)} skipped=${breakdown.skipped.toString().padStart(5)} confirmed_fp=${(
    breakdown.confirmedFpRate * 100
  )
    .toFixed(1)
    .padStart(4)}% coverage=${(breakdown.verificationCoverage * 100).toFixed(1).padStart(5)}%`;
};

export const formatMetricsSummary = (metrics: RunMetrics): string => {
  const combined = metrics.combined;
  const headerLine = `score=${metrics.score}  confirmed_fp_rate=${(
    combined.confirmedFpRate * 100
  ).toFixed(2)}%  verified_fp_rate=${(combined.verifiedFpRate * 100).toFixed(
    2,
  )}%  verification_coverage=${(combined.verificationCoverage * 100).toFixed(1)}%`;
  const honestyNote =
    "note: likely_tp = grep found no import evidence (unrefuted, not positively confirmed). " +
    "skipped = name too common/short for ripgrep to verify reliably. " +
    "confirmed_fp_rate = likely_fp / total_flagged (lower bound). " +
    "verified_fp_rate = likely_fp / (likely_tp + likely_fp) (assumes likely_tp are real TPs). " +
    "verification_coverage = fraction of findings the verifier could rule on.";
  const lines = [
    headerLine,
    formatRow("files", metrics.files),
    formatRow("exports", metrics.exports),
    formatRow("dependencies", metrics.dependencies),
    formatRow("combined", metrics.combined),
    `entries=${metrics.entriesProcessed} crashes=${metrics.crashes} timeouts=${metrics.timeouts}`,
    `analysis_time_ms=${metrics.totalAnalysisTimeMs} wall_time_ms=${metrics.totalWallTimeMs}`,
    honestyNote,
  ];
  return lines.join("\n");
};
