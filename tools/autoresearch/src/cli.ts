import { runOneCorpusPass } from "./experiment/baseline.js";
import { runExperimentLoop } from "./experiment/loop.js";
import { buildDeslop } from "./experiment/build-deslop.js";
import { cloneCorpus } from "./corpus/clone-repos.js";
import { loadRepoEntries, selectCorpus } from "./corpus/select-corpus.js";

const printUsage = (): void => {
  process.stderr.write(`autoresearch [command] [options]

Commands:
  clone        Clone the corpus repos (warm cache)
  baseline     Run one pass, compute metrics, write report
  loop         Run the autonomous experiment loop
  build        Build deslop-js (sanity check)

Options:
  --corpus fast|mid|full        (default: fast for baseline/loop, all for clone)
  --max-iter N                  (default: 200 for loop)
  --budget-ms N                 (default: 36000000 = 10h for loop)
  --analysis-concurrency N      (default: 4)
  --verify-concurrency N        (default: 3)
`);
};

const parseFlag = (argv: string[], flag: string, defaultValue: string): string => {
  const flagIndex = argv.indexOf(flag);
  if (flagIndex === -1 || flagIndex + 1 >= argv.length) return defaultValue;
  return argv[flagIndex + 1];
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command === "build") {
    const outcome = await buildDeslop();
    process.stderr.write(outcome.logTail + "\n");
    process.exitCode = outcome.ok ? 0 : 1;
    return;
  }

  if (command === "clone") {
    const corpusFlag = parseFlag(argv, "--corpus", "fast") as "fast" | "mid" | "full" | "all";
    const allEntries = loadRepoEntries();
    const selection = selectCorpus(corpusFlag, allEntries);
    process.stderr.write(`[clone] selected ${selection.entries.length} entries (${corpusFlag})\n`);
    const outcomes = await cloneCorpus(selection.entries, {
      onProgress: (outcome, completedIndex, total) => {
        process.stderr.write(
          `[clone ${completedIndex}/${total}] ${outcome.status.padEnd(7)} ${outcome.slug} (${outcome.durationMs}ms)\n`,
        );
      },
    });
    const ok = outcomes.filter((outcome) => outcome.status !== "failed").length;
    process.stderr.write(`[clone] complete: ${ok}/${outcomes.length} ok\n`);
    return;
  }

  if (command === "baseline") {
    const corpusFlag = parseFlag(argv, "--corpus", "fast") as "fast" | "mid" | "full";
    const analysisConcurrency = Number.parseInt(
      parseFlag(argv, "--analysis-concurrency", "4"),
      10,
    );
    const verifyConcurrency = Number.parseInt(parseFlag(argv, "--verify-concurrency", "3"), 10);
    await runOneCorpusPass({
      corpus: corpusFlag,
      iterationIndex: 0,
      description: "manual baseline",
      analysisConcurrency,
      verifyConcurrency,
    });
    return;
  }

  if (command === "loop") {
    const corpusFlag = parseFlag(argv, "--corpus", "fast") as "fast" | "mid" | "full";
    const maxIterations = Number.parseInt(parseFlag(argv, "--max-iter", "200"), 10);
    const totalBudgetMs = Number.parseInt(parseFlag(argv, "--budget-ms", "36000000"), 10);
    const analysisConcurrency = Number.parseInt(
      parseFlag(argv, "--analysis-concurrency", "4"),
      10,
    );
    const verifyConcurrency = Number.parseInt(parseFlag(argv, "--verify-concurrency", "3"), 10);
    const branchTag = parseFlag(argv, "--tag", "");
    await runExperimentLoop({
      corpus: corpusFlag,
      maxIterations,
      totalBudgetMs,
      analysisConcurrency,
      verifyConcurrency,
      branchTag: branchTag || undefined,
    });
    return;
  }

  printUsage();
  process.exitCode = 1;
};

main().catch((error) => {
  process.stderr.write(`[autoresearch] fatal: ${String(error?.stack ?? error)}\n`);
  process.exitCode = 1;
});
