import { DUPLICATE_BLOCK_MODULE_EXTRACTION_THRESHOLD_LINES } from "../constants.js";
import type {
  DuplicateBlock,
  DuplicateBlockCluster,
  DuplicateBlockRefactoringHint,
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
export const groupDuplicateBlocksIntoClusters = (duplicateBlocks: DuplicateBlock[]): DuplicateBlockCluster[] => {
  if (duplicateBlocks.length === 0) return [];

  type FamilyBucket = { files: string[]; groups: DuplicateBlock[] };
  const fileSetKeyToBucket = new Map<string, FamilyBucket>();

  for (const duplicateBlock of duplicateBlocks) {
    const sortedFiles = [...new Set(duplicateBlock.instances.map((instance) => instance.path))].sort();
    const fileSetKey = sortedFiles.join("|");
    const existing = fileSetKeyToBucket.get(fileSetKey);
    if (existing) {
      existing.groups.push(duplicateBlock);
    } else {
      fileSetKeyToBucket.set(fileSetKey, { files: sortedFiles, groups: [duplicateBlock] });
    }
  }

  const families: DuplicateBlockCluster[] = [];
  for (const bucket of fileSetKeyToBucket.values()) {
    const totalDuplicatedLines = bucket.groups.reduce(
      (runningSum, duplicateBlock) => runningSum + duplicateBlock.lineCount,
      0,
    );
    const totalDuplicatedTokens = bucket.groups.reduce(
      (runningSum, duplicateBlock) => runningSum + duplicateBlock.tokenCount,
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
  duplicateBlocks: DuplicateBlock[],
  totalDuplicatedLines: number,
): DuplicateBlockRefactoringHint[] => {
  const fileBaseNames = files.map((filePath) => baseName(filePath));
  const meetsModuleExtractionThreshold =
    totalDuplicatedLines >= DUPLICATE_BLOCK_MODULE_EXTRACTION_THRESHOLD_LINES;
  const spansMultipleFiles = files.length >= 2;
  if (meetsModuleExtractionThreshold && spansMultipleFiles) {
    const estimatedSavings = duplicateBlocks.reduce(
      (runningSum, duplicateBlock) =>
        runningSum + duplicateBlock.lineCount * Math.max(0, duplicateBlock.instances.length - 1),
      0,
    );
    return [
      {
        kind: "extract-module",
        description: `Extract ${duplicateBlocks.length} shared duplicate block${
          duplicateBlocks.length === 1 ? "" : "s"
        } (${totalDuplicatedLines} lines) from ${fileBaseNames.join(", ")} into a shared module`,
        estimatedSavings,
      },
    ];
  }

  return duplicateBlocks.map((duplicateBlock) => ({
    kind: "extract-function",
    description: `Extract shared function (${duplicateBlock.lineCount} lines) from ${fileBaseNames.join(
      ", ",
    )}`,
    estimatedSavings: duplicateBlock.lineCount * Math.max(0, duplicateBlock.instances.length - 1),
  }));
};
