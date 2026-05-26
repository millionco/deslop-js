import { Command, type OptionValues } from "commander";
import { DEFAULT_ROOT_DIRECTORY, EXIT_CODE_RUNTIME_ERROR } from "./constants.js";
import type { AnalyzeOptions, GraphOptions, PruneOptions } from "./types.js";
import { runAnalyze } from "./run-analyze.js";
import { runGraph } from "./run-graph.js";
import { runPrune } from "./run-prune.js";
import { readPackageVersion } from "./utils/read-package-version.js";

const toAnalyzeOptions = (
  root: string | undefined,
  optionValues: OptionValues,
): AnalyzeOptions => ({
  root: root ?? DEFAULT_ROOT_DIRECTORY,
  entry: optionValues.entry,
  ignore: optionValues.ignore,
  extensions: optionValues.extensions,
  tsconfig: optionValues.tsconfig,
  reportTypes: Boolean(optionValues.reportTypes),
  includeEntryExports: Boolean(optionValues.includeEntryExports),
  json: Boolean(optionValues.json),
  failOnIssues: Boolean(optionValues.failOnIssues),
  failOnCycles: Boolean(optionValues.failOnCycles),
});

const parseGraphFormat = (rawValue: unknown): GraphOptions["format"] => {
  if (rawValue === "json" || rawValue === "dot" || rawValue === "summary") return rawValue;
  return "summary";
};

const toGraphOptions = (root: string | undefined, optionValues: OptionValues): GraphOptions => ({
  root: root ?? DEFAULT_ROOT_DIRECTORY,
  entry: optionValues.entry,
  ignore: optionValues.ignore,
  extensions: optionValues.extensions,
  tsconfig: optionValues.tsconfig,
  format: parseGraphFormat(optionValues.format),
});

const toPruneOptions = (root: string | undefined, optionValues: OptionValues): PruneOptions => {
  const rawMaxIterations = optionValues.maxIterations;
  const parsedMaxIterations =
    typeof rawMaxIterations === "string" ? Number(rawMaxIterations) : rawMaxIterations;
  return {
    root: root ?? DEFAULT_ROOT_DIRECTORY,
    entry: optionValues.entry,
    ignore: optionValues.ignore,
    extensions: optionValues.extensions,
    tsconfig: optionValues.tsconfig,
    dryRun: !optionValues.apply,
    maxIterations:
      typeof parsedMaxIterations === "number" && Number.isFinite(parsedMaxIterations)
        ? parsedMaxIterations
        : undefined,
  };
};

const runAnalyzeAction = async (
  root: string | undefined,
  optionValues: OptionValues,
): Promise<void> => {
  const exitCode = await runAnalyze(toAnalyzeOptions(root, optionValues));
  process.exitCode = exitCode;
};

const runGraphAction = async (
  root: string | undefined,
  optionValues: OptionValues,
): Promise<void> => {
  const exitCode = await runGraph(toGraphOptions(root, optionValues));
  process.exitCode = exitCode;
};

const runPruneAction = async (
  root: string | undefined,
  optionValues: OptionValues,
): Promise<void> => {
  const exitCode = await runPrune(toPruneOptions(root, optionValues));
  process.exitCode = exitCode;
};

const addAnalyzeOptions = (command: Command): Command =>
  command
    .argument("[root]", "project root directory", DEFAULT_ROOT_DIRECTORY)
    .option("-e, --entry <pattern...>", "entry point glob patterns")
    .option("-i, --ignore <pattern...>", "glob patterns to exclude from analysis")
    .option("--extensions <extension...>", "file extensions to scan (e.g. .ts .vue)")
    .option("--tsconfig <path>", "path to tsconfig.json for path alias resolution")
    .option("--report-types", "include type-only exports in results")
    .option("--include-entry-exports", "report unused exports from entry files")
    .option("--json", "output results as JSON")
    .option(
      "--fail-on-issues",
      "exit with code 1 when unused files, exports, or dependencies are found",
    )
    .option("--fail-on-cycles", "exit with code 1 when circular imports are found");

const addSharedScanOptions = (command: Command): Command =>
  command
    .argument("[root]", "project root directory", DEFAULT_ROOT_DIRECTORY)
    .option("-e, --entry <pattern...>", "entry point glob patterns")
    .option("-i, --ignore <pattern...>", "glob patterns to exclude from analysis")
    .option("--extensions <extension...>", "file extensions to scan (e.g. .ts .vue)")
    .option("--tsconfig <path>", "path to tsconfig.json for path alias resolution");

const program = new Command();

program
  .name("deslop")
  .description(
    "Find unused files, exports, dependencies, and circular imports in JavaScript projects",
  )
  .version(readPackageVersion(import.meta.url));

addAnalyzeOptions(program).action(runAnalyzeAction);

addAnalyzeOptions(
  program
    .command("analyze")
    .description("Find unused files, exports, dependencies, and circular imports"),
).action(runAnalyzeAction);

addSharedScanOptions(
  program
    .command("graph")
    .description("View the codebase as a dependency DAG (summary, JSON, or Graphviz DOT)")
    .option("--format <kind>", "output format: summary | json | dot", "summary"),
).action(runGraphAction);

addSharedScanOptions(
  program
    .command("prune")
    .description("Iteratively delete unreachable files from the dependency DAG")
    .option("--apply", "actually delete files (default is dry-run)")
    .option("--max-iterations <count>", "maximum prune passes before stopping"),
).action(runPruneAction);

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`deslop: ${message}\n`);
  process.exitCode = EXIT_CODE_RUNTIME_ERROR;
});
