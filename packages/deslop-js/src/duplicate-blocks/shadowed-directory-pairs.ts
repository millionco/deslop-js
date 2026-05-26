import { SHADOWED_DIRECTORY_MIN_CLUSTERS } from "../constants.js";
import type { DuplicateBlockCluster, ShadowedDirectoryPair } from "../types.js";

const splitDirectoryAndFile = (filePath: string): { directory: string; baseName: string } => {
  const trailingSlashIndex = filePath.lastIndexOf("/");
  if (trailingSlashIndex === -1) return { directory: "", baseName: filePath };
  return {
    directory: filePath.slice(0, trailingSlashIndex + 1),
    baseName: filePath.slice(trailingSlashIndex + 1),
  };
};

/**
 * Detect shadowed directory pair pairs: when many distinct two-file duplicate-block clusters
 * all sit at the same `(dirA, dirB)` location with matching basenames, the
 * directories themselves are mirrors of each other (e.g. `src/` vs `deno/lib/`,
 * or a fork that drifted). One shadowed-directory-pair entry replaces N family
 * entries in the report and is much more actionable.
 */
export const detectShadowedDirectoryPairs = (
  duplicateBlockClusters: DuplicateBlockCluster[],
  rootDir: string,
): ShadowedDirectoryPair[] => {
  type DirectoryPairKey = string;
  interface PairEntry {
    baseName: string;
    duplicatedLines: number;
  }
  const directoryPairBuckets = new Map<DirectoryPairKey, PairEntry[]>();

  for (const family of duplicateBlockClusters) {
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

  const shadowedDirectoryPairs: ShadowedDirectoryPair[] = [];
  for (const [pairKey, entries] of directoryPairBuckets) {
    if (entries.length < SHADOWED_DIRECTORY_MIN_CLUSTERS) continue;
    const [directoryA, directoryB] = pairKey.split("::");
    const sharedBaseNames = [...new Set(entries.map((entry) => entry.baseName))].sort();
    const totalDuplicatedLines = entries.reduce(
      (runningSum, entry) => runningSum + entry.duplicatedLines,
      0,
    );
    shadowedDirectoryPairs.push({
      directoryA,
      directoryB,
      sharedFiles: sharedBaseNames,
      totalDuplicatedLines,
    });
  }

  shadowedDirectoryPairs.sort(
    (firstDirectory, secondDirectory) =>
      secondDirectory.totalDuplicatedLines - firstDirectory.totalDuplicatedLines,
  );
  return shadowedDirectoryPairs;
};

const toRelative = (filePath: string, rootDir: string): string => {
  if (filePath.startsWith(rootDir + "/")) return filePath.slice(rootDir.length + 1);
  if (filePath === rootDir) return "";
  return filePath;
};
