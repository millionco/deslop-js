import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { TOP_REACT_REPOS, repoSlug } from "./repos.js";
import { cloneAllRepos } from "./runner/clone.js";
import { runDeslop } from "./runner/run-deslop.js";
import { runKnip } from "./runner/run-knip.js";
import { verifyToolResult } from "./runner/verify.js";
import { computeToolMetrics, formatComparisonTable } from "./metrics.js";
import { REPORTS_DIR } from "./constants.js";
import type { BenchmarkRepo, BenchmarkReport, RepoToolResult } from "./types.js";

const log = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

const deduplicateRepos = (repos: BenchmarkRepo[]): BenchmarkRepo[] => {
  const seen = new Set<string>();
  const uniqueRepos: BenchmarkRepo[] = [];
  for (const repo of repos) {
    const slug = repoSlug(repo);
    if (seen.has(slug)) continue;
    seen.add(slug);
    uniqueRepos.push(repo);
  }
  return uniqueRepos;
};

const commandClone = async (): Promise<void> => {
  const repos = filterRepos(deduplicateRepos(TOP_REACT_REPOS));
  log(`[clone] cloning ${repos.length} repos...`);
  const outcomes = await cloneAllRepos(repos, {
    onProgress: (outcome, completed, total) => {
      log(
        `[clone ${completed}/${total}] ${outcome.status.padEnd(7)} ${repoSlug(outcome.repo)} (${outcome.durationMs}ms)`,
      );
    },
  });
  const successCount = outcomes.filter((outcome) => outcome.status !== "failed").length;
  log(`[clone] done: ${successCount}/${outcomes.length} ok`);
};

const commandRun = async (): Promise<void> => {
  const repos = filterRepos(deduplicateRepos(TOP_REACT_REPOS));
  log(`[benchmark] cloning ${repos.length} repos...`);

  const cloneOutcomes = await cloneAllRepos(repos, {
    concurrency: 4,
    onProgress: (outcome, completed, total) => {
      log(
        `[clone ${completed}/${total}] ${outcome.status.padEnd(7)} ${repoSlug(outcome.repo)} (${outcome.durationMs}ms)`,
      );
    },
  });

  const availableRepos: Array<{ repo: BenchmarkRepo; repoDir: string }> = [];
  for (const outcome of cloneOutcomes) {
    if (outcome.status !== "failed") {
      availableRepos.push({ repo: outcome.repo, repoDir: outcome.repoDir });
    }
  }

  log(`[benchmark] running analysis on ${availableRepos.length} repos (deslop + knip)...`);

  const perRepoResults: Array<{
    repo: BenchmarkRepo;
    deslop: RepoToolResult;
    knip: RepoToolResult;
  }> = [];

  let completedCount = 0;

  for (const { repo, repoDir } of availableRepos) {
    const slug = repoSlug(repo);
    log(`[analyze ${completedCount + 1}/${availableRepos.length}] ${slug}...`);

    const [deslopResult, knipResult] = await Promise.all([
      runDeslop(repo, repoDir),
      runKnip(repo, repoDir),
    ]);

    const deslopFlagged = deslopResult.result
      ? deslopResult.result.unusedFiles.length +
        deslopResult.result.unusedExports.length +
        deslopResult.result.unusedDependencies.length
      : 0;
    const knipFlagged = knipResult.result
      ? knipResult.result.unusedFiles.length +
        knipResult.result.unusedExports.length +
        knipResult.result.unusedDependencies.length
      : 0;

    log(
      `  deslop: ${deslopResult.status} (${deslopResult.durationMs}ms, flagged=${deslopFlagged})`,
    );
    log(`  knip:   ${knipResult.status} (${knipResult.durationMs}ms, flagged=${knipFlagged})`);

    log(`  verifying deslop findings...`);
    const verifiedDeslop = await verifyToolResult(deslopResult, repoDir);
    log(`  verifying knip findings...`);
    const verifiedKnip = await verifyToolResult(knipResult, repoDir);

    if (verifiedDeslop.verified) {
      const deslopFalsePositives = [
        ...verifiedDeslop.verified.files,
        ...verifiedDeslop.verified.exports,
        ...verifiedDeslop.verified.dependencies,
      ].filter((item) => item.verdict.kind === "likely_fp").length;
      log(`  deslop verified: fp=${deslopFalsePositives}`);
    }
    if (verifiedKnip.verified) {
      const knipFalsePositives = [
        ...verifiedKnip.verified.files,
        ...verifiedKnip.verified.exports,
        ...verifiedKnip.verified.dependencies,
      ].filter((item) => item.verdict.kind === "likely_fp").length;
      log(`  knip verified: fp=${knipFalsePositives}`);
    }

    perRepoResults.push({
      repo,
      deslop: verifiedDeslop,
      knip: verifiedKnip,
    });

    completedCount++;
  }

  const deslopMetrics = computeToolMetrics(perRepoResults.map((entry) => entry.deslop));
  const knipMetrics = computeToolMetrics(perRepoResults.map((entry) => entry.knip));

  const report: BenchmarkReport = {
    generatedAt: new Date().toISOString(),
    repoCount: availableRepos.length,
    deslop: deslopMetrics,
    knip: knipMetrics,
    perRepo: perRepoResults,
  };

  mkdirSync(REPORTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonReportPath = resolve(REPORTS_DIR, `benchmark-${timestamp}.json`);
  const markdownReportPath = resolve(REPORTS_DIR, `benchmark-${timestamp}.md`);

  writeFileSync(jsonReportPath, JSON.stringify(report, null, 2));
  const markdownContent = formatComparisonTable(report);
  writeFileSync(markdownReportPath, markdownContent);

  log(`\n${markdownContent}`);
  log(`\n[benchmark] JSON report: ${jsonReportPath}`);
  log(`[benchmark] Markdown report: ${markdownReportPath}`);
};

const commandReport = (): void => {
  const reportsDir = REPORTS_DIR;
  if (!existsSync(reportsDir)) {
    log("[report] no reports directory found");
    return;
  }

  const files = readdirSync(reportsDir).filter((fileName) => fileName.endsWith(".json"));
  if (files.length === 0) {
    log("[report] no JSON reports found");
    return;
  }

  const latestFile = files.sort().pop();
  const reportPath = resolve(reportsDir, latestFile!);
  const reportData = JSON.parse(readFileSync(reportPath, "utf-8")) as BenchmarkReport;
  const markdown = formatComparisonTable(reportData);
  process.stdout.write(markdown + "\n");
};

const parseRepoFilter = (): Set<string> | undefined => {
  const reposArgIndex = process.argv.indexOf("--repos");
  if (reposArgIndex === -1 || reposArgIndex + 1 >= process.argv.length) return undefined;
  const rawSlugs = process.argv[reposArgIndex + 1]
    .split(",")
    .map((slug) => slug.trim().toLowerCase());
  return new Set(rawSlugs);
};

const filterRepos = (repos: BenchmarkRepo[]): BenchmarkRepo[] => {
  const allowedSlugs = parseRepoFilter();
  if (!allowedSlugs) return repos;
  return repos.filter((repo) => {
    const slug = `${repo.org}/${repo.name}`.toLowerCase();
    return allowedSlugs.has(slug);
  });
};

const main = async (): Promise<void> => {
  const command = process.argv[2];

  if (!command || command === "--help" || command === "-h") {
    log(`benchmark [command] [--repos org/name,org/name]

Commands:
  clone    Clone the top 100 React repos
  run      Clone repos, run deslop + knip, verify FPs, generate report
  report   Display the latest benchmark report

Options:
  --repos  Comma-separated list of org/name slugs to filter`);
    return;
  }

  if (command === "clone") {
    await commandClone();
    return;
  }

  if (command === "run") {
    await commandRun();
    return;
  }

  if (command === "report") {
    commandReport();
    return;
  }

  log(`Unknown command: ${command}`);
  process.exitCode = 1;
};

main().catch((error) => {
  log(`[benchmark] fatal: ${String(error?.stack ?? error)}`);
  process.exitCode = 1;
});
