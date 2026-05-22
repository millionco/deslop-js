import type { RunMetrics } from "../types.js";

export interface MetricsDelta {
  scoreDelta: number;
  likelyTpDelta: number;
  likelyFpDelta: number;
  confirmedFpRateDelta: number;
  crashesDelta: number;
  timeoutsDelta: number;
  decision: "keep" | "discard";
  rationale: string;
}

export const decideKeepOrDiscard = (baseline: RunMetrics, candidate: RunMetrics): MetricsDelta => {
  const scoreDelta = candidate.score - baseline.score;
  const likelyTpDelta = candidate.combined.likelyTrue - baseline.combined.likelyTrue;
  const likelyFpDelta = candidate.combined.likelyFalse - baseline.combined.likelyFalse;
  const confirmedFpRateDelta =
    candidate.combined.confirmedFpRate - baseline.combined.confirmedFpRate;
  const crashesDelta = candidate.crashes - baseline.crashes;
  const timeoutsDelta = candidate.timeouts - baseline.timeouts;

  if (crashesDelta > 0) {
    return {
      scoreDelta,
      likelyTpDelta,
      likelyFpDelta,
      confirmedFpRateDelta,
      crashesDelta,
      timeoutsDelta,
      decision: "discard",
      rationale: `regressed: +${crashesDelta} new crash(es)`,
    };
  }

  if (scoreDelta > 0) {
    return {
      scoreDelta,
      likelyTpDelta,
      likelyFpDelta,
      confirmedFpRateDelta,
      crashesDelta,
      timeoutsDelta,
      decision: "keep",
      rationale: `score improved by ${scoreDelta} (tp${likelyTpDelta >= 0 ? "+" : ""}${likelyTpDelta} fp${likelyFpDelta >= 0 ? "+" : ""}${likelyFpDelta})`,
    };
  }

  if (scoreDelta === 0 && likelyFpDelta < 0) {
    return {
      scoreDelta,
      likelyTpDelta,
      likelyFpDelta,
      confirmedFpRateDelta,
      crashesDelta,
      timeoutsDelta,
      decision: "keep",
      rationale: `equal score, fewer fps (${likelyFpDelta})`,
    };
  }

  return {
    scoreDelta,
    likelyTpDelta,
    likelyFpDelta,
    confirmedFpRateDelta,
    crashesDelta,
    timeoutsDelta,
    decision: "discard",
    rationale: `score did not improve (${scoreDelta >= 0 ? "+" : ""}${scoreDelta})`,
  };
};
