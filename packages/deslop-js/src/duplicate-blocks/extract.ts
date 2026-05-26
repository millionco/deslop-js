import { SENTINEL_FILE_MARKER } from "./concatenate.js";

export interface RawDuplicateBlockOccurrence {
  fileIndex: number;
  /** Token offset relative to the file's start. */
  tokenOffsetWithinFile: number;
}

export interface RawDuplicateBlock {
  instances: RawDuplicateBlockOccurrence[];
  /** Clone length in tokens. */
  tokenLength: number;
}

interface StackEntry {
  lcpValue: number;
  startIndex: number;
}

/**
 * Stack-based extraction of maximal duplicate blocks from a suffix-array+LCP pair.
 *
 * Iterates `lcp[]` and uses a monotone stack to find every maximal interval
 * `[i, j]` whose minimum LCP is >= `minTokens`. Each such interval is a
 * duplicate block whose instances are the suffix-array entries `sa[i .. j]`,
 * each of length equal to the interval's minimum LCP.
 *
 * Within-file overlapping instances are deduplicated (keeping the earliest
 * non-overlapping prefix), and we drop any group that ends up with fewer
 * than two instances after that pass.
 */
export const extractRawDuplicateBlocks = (
  suffixArray: number[],
  lcpArray: number[],
  fileOf: number[],
  fileOffsets: number[],
  filesTokenCounts: number[],
  minTokens: number,
): RawDuplicateBlock[] => {
  const sequenceLength = suffixArray.length;
  if (sequenceLength < 2) return [];

  const rawBlocks: RawDuplicateBlock[] = [];
  const stack: StackEntry[] = [];

  for (let scanIndex = 1; scanIndex <= sequenceLength; scanIndex++) {
    const currentLcp = scanIndex < sequenceLength ? lcpArray[scanIndex] : 0;
    let intervalStart = scanIndex;

    while (stack.length > 0 && stack[stack.length - 1].lcpValue > currentLcp) {
      const popped = stack.pop()!;
      intervalStart = popped.startIndex;
      if (popped.lcpValue >= minTokens) {
        const intervalBegin = intervalStart - 1;
        const intervalEnd = scanIndex;
        const candidate = buildRawBlock(
          suffixArray,
          fileOf,
          fileOffsets,
          filesTokenCounts,
          intervalBegin,
          intervalEnd,
          popped.lcpValue,
        );
        if (candidate) rawBlocks.push(candidate);
      }
    }

    if (scanIndex < sequenceLength) {
      stack.push({ lcpValue: currentLcp, startIndex: intervalStart });
    }
  }

  return rawBlocks;
};

const buildRawBlock = (
  suffixArray: number[],
  fileOf: number[],
  fileOffsets: number[],
  filesTokenCounts: number[],
  intervalBegin: number,
  intervalEnd: number,
  tokenLength: number,
): RawDuplicateBlock | undefined => {
  const candidateInstances: RawDuplicateBlockOccurrence[] = [];
  for (let suffixIndex = intervalBegin; suffixIndex < intervalEnd; suffixIndex++) {
    const startPosition = suffixArray[suffixIndex];
    const fileIndex = fileOf[startPosition];
    if (fileIndex === SENTINEL_FILE_MARKER) continue;
    const tokenOffsetWithinFile = startPosition - fileOffsets[fileIndex];
    if (tokenOffsetWithinFile + tokenLength > filesTokenCounts[fileIndex]) continue;
    candidateInstances.push({ fileIndex, tokenOffsetWithinFile });
  }

  if (candidateInstances.length < 2) return undefined;

  candidateInstances.sort((firstInstance, secondInstance) => {
    if (firstInstance.fileIndex !== secondInstance.fileIndex) {
      return firstInstance.fileIndex - secondInstance.fileIndex;
    }
    return firstInstance.tokenOffsetWithinFile - secondInstance.tokenOffsetWithinFile;
  });

  const dedupedInstances: RawDuplicateBlockOccurrence[] = [];
  for (const instance of candidateInstances) {
    const lastInstance = dedupedInstances[dedupedInstances.length - 1];
    if (
      lastInstance &&
      lastInstance.fileIndex === instance.fileIndex &&
      instance.tokenOffsetWithinFile < lastInstance.tokenOffsetWithinFile + tokenLength
    ) {
      continue;
    }
    dedupedInstances.push(instance);
  }

  if (dedupedInstances.length < 2) return undefined;
  return { instances: dedupedInstances, tokenLength };
};
