#!/usr/bin/env node

import { resolve, relative } from "node:path";
import { analyze, createConfig } from "./index.js";
import type { AnalysisResult } from "./types.js";

const HELP_TEXT = `
deslop - Dead code detector for TypeScript/JavaScript

Usage:
  deslop [options] [rootDir]

Options:
  --entry <pattern>       Entry point glob pattern (can be repeated)
  --ignore <pattern>      Ignore glob pattern (can be repeated)
  --tsconfig <path>       Path to tsconfig.json
  --include-types         Include type-only exports in results
  --include-entry-exports Include entry file exports in results
  --json                  Output as JSON
  --help                  Show this help message
  --version               Show version

Examples:
  deslop
  deslop ./my-project
  deslop --entry "src/main.ts" --ignore "**/*.test.ts"
  deslop --json > results.json
`;

interface CliArguments {
  rootDir: string;
  entries: string[];
  ignores: string[];
  tsconfig: string | undefined;
  includeTypes: boolean;
  includeEntryExports: boolean;
  outputJson: boolean;
  showHelp: boolean;
  showVersion: boolean;
}

const parseArguments = (argv: string[]): CliArguments => {
  const entries: string[] = [];
  const ignores: string[] = [];
  let rootDir = ".";
  let tsconfig: string | undefined;
  let includeTypes = false;
  let includeEntryExports = false;
  let outputJson = false;
  let showHelp = false;
  let showVersion = false;

  let argumentIndex = 0;
  while (argumentIndex < argv.length) {
    const argument = argv[argumentIndex];

    if (argument === "--help" || argument === "-h") {
      showHelp = true;
    } else if (argument === "--version" || argument === "-v") {
      showVersion = true;
    } else if (argument === "--entry" || argument === "-e") {
      argumentIndex++;
      if (argumentIndex < argv.length) entries.push(argv[argumentIndex]);
    } else if (argument === "--ignore" || argument === "-i") {
      argumentIndex++;
      if (argumentIndex < argv.length) ignores.push(argv[argumentIndex]);
    } else if (argument === "--tsconfig") {
      argumentIndex++;
      if (argumentIndex < argv.length) tsconfig = argv[argumentIndex];
    } else if (argument === "--include-types") {
      includeTypes = true;
    } else if (argument === "--include-entry-exports") {
      includeEntryExports = true;
    } else if (argument === "--json") {
      outputJson = true;
    } else if (!argument.startsWith("-")) {
      rootDir = argument;
    }

    argumentIndex++;
  }

  return {
    rootDir,
    entries,
    ignores,
    tsconfig,
    includeTypes,
    includeEntryExports,
    outputJson,
    showHelp,
    showVersion,
  };
};

const formatResults = (analysisResult: AnalysisResult, rootDir: string): string => {
  const outputLines: string[] = [];

  outputLines.push(`\n  deslop analysis complete\n`);
  outputLines.push(
    `  Scanned ${analysisResult.totalFiles} files with ${analysisResult.totalExports} exports in ${analysisResult.analysisTimeMs.toFixed(0)}ms\n`,
  );

  if (analysisResult.unusedFiles.length > 0) {
    outputLines.push(`  Unused files (${analysisResult.unusedFiles.length}):`);
    for (const unusedFile of analysisResult.unusedFiles) {
      outputLines.push(`    ${relative(rootDir, unusedFile.path)}`);
    }
    outputLines.push("");
  }

  if (analysisResult.unusedExports.length > 0) {
    outputLines.push(`  Unused exports (${analysisResult.unusedExports.length}):`);
    for (const unusedExport of analysisResult.unusedExports) {
      const relativePath = relative(rootDir, unusedExport.path);
      const typeLabel = unusedExport.isTypeOnly ? " (type)" : "";
      outputLines.push(
        `    ${relativePath}:${unusedExport.line}  ${unusedExport.name}${typeLabel}`,
      );
    }
    outputLines.push("");
  }

  if (analysisResult.unusedDependencies.length > 0) {
    outputLines.push(
      `  Unused dependencies (${analysisResult.unusedDependencies.length}):`,
    );
    for (const unusedDependency of analysisResult.unusedDependencies) {
      const devLabel = unusedDependency.isDevDependency ? " (dev)" : "";
      outputLines.push(`    ${unusedDependency.name}${devLabel}`);
    }
    outputLines.push("");
  }

  const totalIssueCount =
    analysisResult.unusedFiles.length +
    analysisResult.unusedExports.length +
    analysisResult.unusedDependencies.length;

  if (totalIssueCount === 0) {
    outputLines.push("  No dead code found!\n");
  } else {
    outputLines.push(`  Total issues: ${totalIssueCount}\n`);
  }

  return outputLines.join("\n");
};

const main = async (): Promise<void> => {
  const cliArguments = parseArguments(process.argv.slice(2));

  if (cliArguments.showHelp) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }

  if (cliArguments.showVersion) {
    process.stdout.write("deslop 0.1.0\n");
    process.exit(0);
  }

  const rootDir = resolve(cliArguments.rootDir);

  const config = createConfig({
    rootDir,
    entryPatterns:
      cliArguments.entries.length > 0 ? cliArguments.entries : undefined,
    ignorePatterns:
      cliArguments.ignores.length > 0 ? cliArguments.ignores : undefined,
    tsConfigPath: cliArguments.tsconfig,
    reportTypes: cliArguments.includeTypes,
    includeEntryExports: cliArguments.includeEntryExports,
  });

  try {
    const analysisResult = await analyze(config);

    const outputContent = cliArguments.outputJson
      ? JSON.stringify(analysisResult, null, 2) + "\n"
      : formatResults(analysisResult, rootDir);

    const totalIssueCount =
      analysisResult.unusedFiles.length +
      analysisResult.unusedExports.length +
      analysisResult.unusedDependencies.length;

    const exitCode = totalIssueCount > 0 ? 1 : 0;

    const didFlush = process.stdout.write(outputContent);
    if (didFlush) {
      process.exit(exitCode);
    } else {
      process.stdout.once("drain", () => process.exit(exitCode));
    }
  } catch (error) {
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(2);
  }
};

main();
