# autoresearch (deslop-js)

A Karpathy-style autonomous research harness adapted for `deslop-js`. The agent
modifies `packages/deslop-js/src/**/*`, runs the analyzer on a corpus drawn
from `repos.json`, computes a verifiable false-positive / true-positive metric,
and keeps changes that improve the score (otherwise reverts via git).

## Setup

1. Confirm dependencies are installed (`pnpm install` at the repo root).
2. Warm the repo cache:
   ```bash
   pnpm --filter autoresearch clone --corpus fast
   ```
3. Build deslop-js once: `pnpm --filter deslop-js build`.
4. Run a sanity baseline:
   ```bash
   pnpm --filter autoresearch baseline --corpus fast
   ```
   This writes a `reports/00000__<sha>__fast.json` file with verified counts.

## Experimentation

Each iteration:

1. Pick the next mutation hypothesis (see `src/experiment/propose-mutation.ts`).
2. Apply the mutation to `packages/deslop-js/src/**/*`.
3. Rebuild: `pnpm --filter deslop-js build`. On failure, revert immediately.
4. Commit (`autoresearch: <id>` message).
5. Run `runOneCorpusPass` to produce a `RunArtifact`.
6. Compute metrics: per-class (`files`, `exports`, `dependencies`) flag counts,
   `likely_tp`, `likely_fp`, `skipped`, plus aggregate `score = likely_tp - 4 * likely_fp`.
7. Compare to current best:
   - `decision = keep` if `score` strictly improves (or stays equal with fewer
     fps and no new crashes).
   - Otherwise `discard` (git reset to last best, rebuild).

## Metric

The metric is computed via a high-recall heuristic verifier:

- **Exports**: an "unused export" is `likely_fp` if its identifier appears
  anywhere else in the same repo (excluding the declaring file). Names that
  are common English/framework words are skipped (see `SKIP_EXPORT_NAMES`).
- **Files**: a flagged file is `likely_fp` if its basename or relative path is
  referenced as a string in any other source/config file.
- **Dependencies**: a flagged dep is `likely_fp` if the package name appears in
  an `import`/`require`/`from` statement anywhere in the repo.

This is NOT ground truth. It overestimates FPs for ambiguous identifiers and
underestimates for default exports. The trade-off is fast, deterministic,
language-agnostic verification that surfaces real regressions immediately.

## What the agent CAN do

- Modify any file in `packages/deslop-js/src/**/*`.
- Add new heuristics, constants, or helpers.
- Refactor analyzers as long as the API surface in `src/index.ts` stays stable.

## What the agent CANNOT do

- Modify `tools/autoresearch/**` (the harness itself).
- Modify `repos.json` (the corpus list is fixed).
- Modify the verification metric (`tools/autoresearch/src/verify/**`).
- Modify the deslop-js public API (`defineConfig`, `analyze`, exported types).

## Output

- `reports/<iter>__<sha>__<corpus>.json` — per-iteration verified report.
- `results.tsv` — append-only experiment log (iter, timestamp, corpus, sha,
  score, tp, fp, fp_rate, decision, description).
- `status.json` — current loop state (current best sha, last action).
- `hypotheses.log` — chronological log of proposals + decisions.

## Loop

```bash
pnpm --filter autoresearch loop --corpus fast --budget-ms 36000000
```

`--budget-ms 36000000` is 10 hours. Use `--corpus mid` for ~80 entries (slower
but more representative).

## NEVER STOP

Once the loop is running, do not pause. New hypotheses can be added to
`buildScriptedProposals()` while the loop runs — they will be picked up on the
next batch refill (every ~6 iterations).
