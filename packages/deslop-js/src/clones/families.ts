import { CODE_CLONE_MODULE_EXTRACTION_THRESHOLD_LINES } from "../constants.js";
import type {
  CodeClone,
  CodeCloneFamily,
  CodeCloneRefactoringSuggestion,
} from "../types.js";

const baseName = (filePath: string): string => {
  const trailingSlashIndex = filePath.lastIndexOf("/");
  return trailingSlashIndex === -1 ? filePath : filePath.slice(trailingSlashIndex + 1);
};

/**
 * Group clones into families by the set of files they span. When several
 * clones all live across exactly the same set of files, they form a family —
 * a strong hint that the right refactor is to extract a shared module rather
 * than fix each clone in isolation.
 */
export const groupClonesIntoFamilies = (codeClones: CodeClone[]): CodeCloneFamily[] => {
  if (codeClones.length === 0) return [];

  type FamilyBucket = { files: string[]; groups: CodeClone[] };
  const fileSetKeyToBucket = new Map<string, FamilyBucket>();

  for (const cloneGroup of codeClones) {
    const sortedFiles = [...new Set(cloneGroup.instances.map((instance) => instance.path))].sort();
    const fileSetKey = sortedFiles.join("|");
    const existing = fileSetKeyToBucket.get(fileSetKey);
    if (existing) {
      existing.groups.push(cloneGroup);
    } else {
      fileSetKeyToBucket.set(fileSetKey, { files: sortedFiles, groups: [cloneGroup] });
    }
  }

  const families: CodeCloneFamily[] = [];
  for (const bucket of fileSetKeyToBucket.values()) {
    const totalDuplicatedLines = bucket.groups.reduce(
      (runningSum, cloneGroup) => runningSum + cloneGroup.lineCount,
      0,
    );
    const totalDuplicatedTokens = bucket.groups.reduce(
      (runningSum, cloneGroup) => runningSum + cloneGroup.tokenCount,
      0,
    );
    families.push({
      files: bucket.files,
      groups: bucket.groups,
      totalDuplicatedLines,
      totalDuplicatedTokens,
      suggestions: buildSuggestions(bucket.files, bucket.groups, totalDuplicatedLines),
    });
  }

  families.sort((firstFamily, secondFamily) => {
    if (firstFamily.totalDuplicatedLines !== secondFamily.totalDuplicatedLines) {
      return secondFamily.totalDuplicatedLines - firstFamily.totalDuplicatedLines;
    }
    return secondFamily.groups.length - firstFamily.groups.length;
  });
  return families;
};

const buildSuggestions = (
  files: string[],
  cloneGroups: CodeClone[],
  totalDuplicatedLines: number,
): CodeCloneRefactoringSuggestion[] => {
  const fileBaseNames = files.map((filePath) => baseName(filePath));
  if (totalDuplicatedLines >= CODE_CLONE_MODULE_EXTRACTION_THRESHOLD_LINES) {
    const estimatedSavings = cloneGroups.reduce(
      (runningSum, cloneGroup) =>
        runningSum + cloneGroup.lineCount * Math.max(0, cloneGroup.instances.length - 1),
      0,
    );
    return [
      {
        kind: "extract-module",
        description: `Extract ${cloneGroups.length} shared clone group${
          cloneGroups.length === 1 ? "" : "s"
        } (${totalDuplicatedLines} lines) from ${fileBaseNames.join(", ")} into a shared module`,
        estimatedSavings,
      },
    ];
  }

  return cloneGroups.map((cloneGroup) => ({
    kind: "extract-function",
    description: `Extract shared function (${cloneGroup.lineCount} lines) from ${fileBaseNames.join(
      ", ",
    )}`,
    estimatedSavings: cloneGroup.lineCount * Math.max(0, cloneGroup.instances.length - 1),
  }));
};
