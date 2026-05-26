import { relative } from "node:path";
import type { Writable } from "node:stream";
import { defineConfig, pruneUnusedFiles } from "deslop-js";
import {
  EXIT_CODE_INVALID_ROOT,
  EXIT_CODE_SUCCESS,
  MISSING_PACKAGE_JSON_WARNING,
} from "./constants.js";
import type { PruneOptions } from "./types.js";
import { validateRootDirectory } from "./utils/validate-root-directory.js";

interface PruneOutput {
  stdout: Writable;
  stderr: Writable;
}

const defaultPruneOutput = (): PruneOutput => ({
  stdout: process.stdout,
  stderr: process.stderr,
});

export const runPrune = async (
  options: PruneOptions,
  output: PruneOutput = defaultPruneOutput(),
): Promise<number> => {
  const rootValidation = validateRootDirectory(options.root);

  if (!rootValidation.isValid) {
    output.stderr.write(`deslop: ${rootValidation.errorMessage}\n`);
    return EXIT_CODE_INVALID_ROOT;
  }

  if (rootValidation.missingPackageJson) {
    output.stderr.write(`deslop: ${MISSING_PACKAGE_JSON_WARNING}\n`);
  }

  const config = defineConfig({
    rootDir: rootValidation.resolvedPath,
    entryPatterns: options.entry,
    ignorePatterns: options.ignore ?? [],
    includeExtensions: options.extensions,
    tsConfigPath: options.tsconfig,
  });

  const result = await pruneUnusedFiles(config, {
    dryRun: options.dryRun,
    maxIterations: options.maxIterations,
    onIteration: (iteration) => {
      output.stdout.write(
        `pass ${iteration.iteration}: ${iteration.unusedFilesFound} unreachable / ${iteration.totalFilesBefore} total — ${iteration.deletedFiles.length} ${options.dryRun ? "to delete" : "deleted"}\n`,
      );
    },
  });

  if (options.dryRun) {
    output.stdout.write(`\nDry run: would delete ${result.deletedFiles.length} files.\n`);
  } else {
    output.stdout.write(`\nDeleted ${result.deletedFiles.length} files`);
    output.stdout.write(
      result.converged ? " (graph converged).\n" : ` (stopped after max iterations).\n`,
    );
  }

  for (const filePath of result.deletedFiles) {
    output.stdout.write(`  ${relative(rootValidation.resolvedPath, filePath)}\n`);
  }

  output.stdout.write(`\nTotal time: ${result.totalElapsedMs.toFixed(0)}ms\n`);
  return EXIT_CODE_SUCCESS;
};
