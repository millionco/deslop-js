import { CODE_CLONE_MIRRORED_DIRECTORY_MIN_FAMILIES } from "../constants.js";
import type { CodeCloneFamily, MirroredDirectory } from "../types.js";

const splitDirectoryAndFile = (filePath: string): { directory: string; baseName: string } => {
  const trailingSlashIndex = filePath.lastIndexOf("/");
  if (trailingSlashIndex === -1) return { directory: "", baseName: filePath };
  return {
    directory: filePath.slice(0, trailingSlashIndex + 1),
    baseName: filePath.slice(trailingSlashIndex + 1),
  };
};

/**
 * Detect mirrored directory pairs: when many distinct two-file clone families
 * all sit at the same `(dirA, dirB)` location with matching basenames, the
 * directories themselves are mirrors of each other (e.g. `src/` vs `deno/lib/`,
 * or a fork that drifted). One mirrored-directory entry replaces N family
 * entries in the report and is much more actionable.
 */
export const detectMirroredDirectoryPairs = (
  codeCloneFamilies: CodeCloneFamily[],
  rootDir: string,
): MirroredDirectory[] => {
  type DirectoryPairKey = string;
  interface PairEntry {
    baseName: string;
    duplicatedLines: number;
  }
  const directoryPairBuckets = new Map<DirectoryPairKey, PairEntry[]>();

  for (const family of codeCloneFamilies) {
    if (family.files.length !== 2) continue;
    const [firstFile, secondFile] = family.files;
    const firstSplit = splitDirectoryAndFile(toRelative(firstFile, rootDir));
    const secondSplit = splitDirectoryAndFile(toRelative(secondFile, rootDir));
    if (firstSplit.baseName !== secondSplit.baseName) continue;

    const [smallerDirectory, largerDirectory] =
      firstSplit.directory <= secondSplit.directory
        ? [firstSplit.directory, secondSplit.directory]
        : [secondSplit.directory, firstSplit.directory];
    const pairKey = `${smallerDirectory}::${largerDirectory}`;
    const entry: PairEntry = {
      baseName: firstSplit.baseName,
      duplicatedLines: family.totalDuplicatedLines,
    };
    const existing = directoryPairBuckets.get(pairKey);
    if (existing) existing.push(entry);
    else directoryPairBuckets.set(pairKey, [entry]);
  }

  const mirroredDirectories: MirroredDirectory[] = [];
  for (const [pairKey, entries] of directoryPairBuckets) {
    if (entries.length < CODE_CLONE_MIRRORED_DIRECTORY_MIN_FAMILIES) continue;
    const [directoryA, directoryB] = pairKey.split("::");
    const sharedBaseNames = [...new Set(entries.map((entry) => entry.baseName))].sort();
    const totalDuplicatedLines = entries.reduce(
      (runningSum, entry) => runningSum + entry.duplicatedLines,
      0,
    );
    mirroredDirectories.push({
      directoryA,
      directoryB,
      sharedFiles: sharedBaseNames,
      totalDuplicatedLines,
    });
  }

  mirroredDirectories.sort(
    (firstDirectory, secondDirectory) =>
      secondDirectory.totalDuplicatedLines - firstDirectory.totalDuplicatedLines,
  );
  return mirroredDirectories;
};

const toRelative = (filePath: string, rootDir: string): string => {
  if (filePath.startsWith(rootDir + "/")) return filePath.slice(rootDir.length + 1);
  if (filePath === rootDir) return "";
  return filePath;
};
