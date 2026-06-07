import { spawnSync } from "node:child_process";
import { GIT_CHECK_IGNORE_MAX_BUFFER_BYTES } from "../constants.js";

export const collectGitIgnoredPaths = (
  rootDirectory: string,
  absolutePaths: ReadonlyArray<string>,
): Set<string> => {
  if (absolutePaths.length === 0) return new Set();

  const result = spawnSync("git", ["check-ignore", "--no-index", "--stdin", "-z"], {
    cwd: rootDirectory,
    input: absolutePaths.join("\0"),
    encoding: "utf-8",
    maxBuffer: GIT_CHECK_IGNORE_MAX_BUFFER_BYTES,
  });

  if (result.error || result.status === null || result.status > 1) {
    return new Set();
  }

  const ignoredPaths = result.stdout.split("\0").filter((entry) => entry.length > 0);

  return new Set(ignoredPaths);
};
