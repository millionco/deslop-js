import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  HYPOTHESES_LOG_PATH,
  REPORTS_DIR,
  RESULTS_TSV_PATH,
  STATUS_FILE_PATH,
} from "../constants.js";
import { buildDeslop } from "./build-deslop.js";
import { runOneCorpusPass } from "./baseline.js";
import { buildScriptedProposals } from "./propose-mutation.js";
import { decideKeepOrDiscard } from "../metrics/compare-metrics.js";
import {
  ensureBranch,
  getCurrentBranch,
  getCurrentCommitSha,
  getWorkingTreeStatus,
  resetToCommit,
  stageAllAndCommit,
} from "./git-ops.js";
import type { MutationProposal, RunArtifact, RunMetrics } from "../types.js";

const RESULTS_TSV_HEADER =
  "iter\ttimestamp\tcorpus\tcommit\tparent\tscore\tlikely_tp\tlikely_fp\tskipped\tconfirmed_fp_rate\tverified_fp_rate\tcoverage\tcrashes\ttimeouts\tstatus\tdescription";

const ensureResultsTsv = (): void => {
  if (existsSync(RESULTS_TSV_PATH)) return;
  writeFileSync(RESULTS_TSV_PATH, `${RESULTS_TSV_HEADER}\n`, "utf-8");
};

const appendResultsRow = (
  iterationIndex: number,
  artifact: RunArtifact,
  status: "baseline" | "keep" | "discard" | "crash",
): void => {
  ensureResultsTsv();
  const metrics = artifact.metrics;
  const row = [
    iterationIndex,
    artifact.finishedAtIso,
    artifact.corpusSlug,
    artifact.commitSha,
    artifact.parentSha ?? "",
    metrics.score,
    metrics.combined.likelyTrue,
    metrics.combined.likelyFalse,
    metrics.combined.skipped,
    metrics.combined.confirmedFpRate.toFixed(4),
    metrics.combined.verifiedFpRate.toFixed(4),
    metrics.combined.verificationCoverage.toFixed(4),
    metrics.crashes,
    metrics.timeouts,
    status,
    artifact.description.replace(/[\t\n]/g, " "),
  ].join("\t");
  appendFileSync(RESULTS_TSV_PATH, `${row}\n`, "utf-8");
};

interface LoopState {
  iterationCounter: number;
  baselineCommitSha: string;
  baselineMetrics: RunMetrics;
  bestMetrics: RunMetrics;
  bestCommitSha: string;
  branchName: string;
  startedAtIso: string;
}

const writeStatus = (state: LoopState, currentStage: string): void => {
  mkdirSync(resolve(STATUS_FILE_PATH, ".."), { recursive: true });
  writeFileSync(
    STATUS_FILE_PATH,
    JSON.stringify(
      {
        iterationCounter: state.iterationCounter,
        baselineCommitSha: state.baselineCommitSha,
        bestCommitSha: state.bestCommitSha,
        branchName: state.branchName,
        startedAtIso: state.startedAtIso,
        bestScore: state.bestMetrics.score,
        bestConfirmedFpRate: state.bestMetrics.combined.confirmedFpRate,
        bestVerifiedFpRate: state.bestMetrics.combined.verifiedFpRate,
        bestVerificationCoverage: state.bestMetrics.combined.verificationCoverage,
        bestLikelyTrue: state.bestMetrics.combined.likelyTrue,
        bestLikelyFalse: state.bestMetrics.combined.likelyFalse,
        currentStage,
        lastUpdatedIso: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
};

const logHypothesisLine = (line: string): void => {
  mkdirSync(resolve(HYPOTHESES_LOG_PATH, ".."), { recursive: true });
  appendFileSync(HYPOTHESES_LOG_PATH, `${new Date().toISOString()}  ${line}\n`);
};

export interface RunLoopOptions {
  corpus: "fast" | "mid" | "full";
  maxIterations: number;
  totalBudgetMs: number;
  analysisConcurrency?: number;
  verifyConcurrency?: number;
  branchTag?: string;
}

export const runExperimentLoop = async (options: RunLoopOptions): Promise<void> => {
  mkdirSync(REPORTS_DIR, { recursive: true });

  const workingStatus = await getWorkingTreeStatus();
  if (!workingStatus.isClean) {
    process.stderr.write(
      `[autoresearch] aborting: working tree is dirty (${workingStatus.changedFiles.slice(0, 8).join(", ")})\n`,
    );
    process.stderr.write("[autoresearch] commit or stash changes before running the loop.\n");
    process.exitCode = 1;
    return;
  }

  const originalBranch = await getCurrentBranch();
  const tag =
    options.branchTag ??
    new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 12);
  const branchName = `autoresearch/${tag}`;
  const branchOutcome = await ensureBranch(branchName);
  if (!branchOutcome.ok) {
    process.stderr.write(
      `[autoresearch] failed to create/checkout branch ${branchName}: ${branchOutcome.stderr}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stderr.write(
    `[autoresearch] running on branch: ${branchName} (parent: ${originalBranch})\n`,
  );

  const buildOutcome = await buildDeslop();
  if (!buildOutcome.ok) {
    throw new Error(`baseline build failed: ${buildOutcome.logTail}`);
  }

  const baselineSha = await getCurrentCommitSha();
  process.stderr.write(`[autoresearch] establishing baseline at commit ${baselineSha}\n`);
  const baselineArtifact = await runOneCorpusPass({
    corpus: options.corpus,
    iterationIndex: 0,
    parentSha: undefined,
    description: "baseline",
    analysisConcurrency: options.analysisConcurrency,
    verifyConcurrency: options.verifyConcurrency,
  });
  appendResultsRow(0, baselineArtifact, "baseline");

  const state: LoopState = {
    iterationCounter: 0,
    baselineCommitSha: baselineSha,
    baselineMetrics: baselineArtifact.metrics,
    bestMetrics: baselineArtifact.metrics,
    bestCommitSha: baselineSha,
    branchName,
    startedAtIso: new Date().toISOString(),
  };
  writeStatus(state, "baseline-done");

  const loopStartTime = Date.now();
  const proposalsQueue: MutationProposal[] = buildScriptedProposals();
  let proposalCursor = 0;

  while (
    state.iterationCounter < options.maxIterations &&
    Date.now() - loopStartTime < options.totalBudgetMs
  ) {
    state.iterationCounter++;

    if (proposalCursor >= proposalsQueue.length) {
      proposalsQueue.push(...buildScriptedProposals());
    }
    const proposal = proposalsQueue[proposalCursor++];

    process.stderr.write(`\n[iter ${state.iterationCounter}] proposing: ${proposal.description}\n`);
    logHypothesisLine(`[iter ${state.iterationCounter}] start: ${proposal.description}`);
    writeStatus(state, `iter-${state.iterationCounter}-apply-mutation`);

    let applyResult;
    try {
      applyResult = await proposal.apply();
    } catch (applyError) {
      logHypothesisLine(`[iter ${state.iterationCounter}] apply error: ${String(applyError)}`);
      await resetToCommit(state.bestCommitSha);
      continue;
    }

    if (applyResult.changedFiles.length === 0) {
      logHypothesisLine(
        `[iter ${state.iterationCounter}] skipped: no-op (${applyResult.notes ?? "already applied"})`,
      );
      await resetToCommit(state.bestCommitSha);
      continue;
    }

    writeStatus(state, `iter-${state.iterationCounter}-build`);
    const candidateBuild = await buildDeslop();
    if (!candidateBuild.ok) {
      logHypothesisLine(
        `[iter ${state.iterationCounter}] build failed; reverting. tail=${candidateBuild.logTail.slice(0, 400)}`,
      );
      await resetToCommit(state.bestCommitSha);
      continue;
    }

    writeStatus(state, `iter-${state.iterationCounter}-commit`);
    const commitMessage = `autoresearch: ${proposal.id}\n\n${proposal.description}`;
    const commitOutcome = await stageAllAndCommit(commitMessage);
    if (!commitOutcome.ok) {
      logHypothesisLine(`[iter ${state.iterationCounter}] commit failed: ${commitOutcome.stderr}`);
      await resetToCommit(state.bestCommitSha);
      continue;
    }
    const candidateSha = commitOutcome.commitSha ?? (await getCurrentCommitSha());

    writeStatus(state, `iter-${state.iterationCounter}-run-pass`);
    const candidateArtifact = await runOneCorpusPass({
      corpus: options.corpus,
      iterationIndex: state.iterationCounter,
      parentSha: state.bestCommitSha,
      description: proposal.description,
      analysisConcurrency: options.analysisConcurrency,
      verifyConcurrency: options.verifyConcurrency,
    });

    const decision = decideKeepOrDiscard(state.bestMetrics, candidateArtifact.metrics);
    logHypothesisLine(
      `[iter ${state.iterationCounter}] decision=${decision.decision} score${decision.scoreDelta >= 0 ? "+" : ""}${decision.scoreDelta} tp${decision.likelyTpDelta >= 0 ? "+" : ""}${decision.likelyTpDelta} fp${decision.likelyFpDelta >= 0 ? "+" : ""}${decision.likelyFpDelta} crashes${decision.crashesDelta >= 0 ? "+" : ""}${decision.crashesDelta} rationale=${decision.rationale}`,
    );

    if (decision.decision === "keep") {
      state.bestMetrics = candidateArtifact.metrics;
      state.bestCommitSha = candidateSha;
      appendResultsRow(state.iterationCounter, candidateArtifact, "keep");
      writeStatus(state, `iter-${state.iterationCounter}-kept`);
    } else {
      appendResultsRow(state.iterationCounter, candidateArtifact, "discard");
      const resetOutcome = await resetToCommit(state.bestCommitSha);
      if (!resetOutcome.ok) {
        process.stderr.write(`[autoresearch] reset failed: ${resetOutcome.stderr}\n`);
      }
      const rebuildOutcome = await buildDeslop();
      if (!rebuildOutcome.ok) {
        process.stderr.write(
          `[autoresearch] rebuild after revert failed: ${rebuildOutcome.logTail.slice(0, 400)}\n`,
        );
      }
      writeStatus(state, `iter-${state.iterationCounter}-discarded`);
    }
  }

  writeStatus(state, "loop-completed");
  process.stderr.write(
    `[autoresearch] loop completed after ${state.iterationCounter} iterations\n`,
  );
};
