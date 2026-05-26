import type { HashedToken } from "./token-types.js";

export interface ConcatenationResult {
  /**
   * Token sequence covering every file plus a unique negative sentinel between
   * each. Sentinels are < 0 so suffix-array suffixes can never share a prefix
   * across the file boundary.
   */
  tokenSequence: number[];
  /** `tokenSequence[i]` belongs to file `fileOf[i]`, or `Number.MAX_SAFE_INTEGER` for sentinels. */
  fileOf: number[];
  /** Start offset of file `fileIndex` inside `tokenSequence`. */
  fileOffsets: number[];
}

const SENTINEL_FILE_INDEX = Number.MAX_SAFE_INTEGER;

/**
 * Rank-reduce the token hashes (map u32 hashes to dense 0..K-1 integers) and
 * concatenate every file's reduced sequence with a unique negative sentinel
 * between files. Producing dense ranks shrinks the suffix-array's bucket
 * counters from ~4 billion to a few thousand and is the standard trick for
 * making prefix-doubling fast.
 */
export const rankReduceAndConcatenate = (
  filesHashedTokens: HashedToken[][],
): ConcatenationResult => {
  const uniqueHashes = new Set<number>();
  for (const fileTokens of filesHashedTokens) {
    for (const hashedToken of fileTokens) uniqueHashes.add(hashedToken.hash);
  }
  const sortedUniqueHashes = [...uniqueHashes].sort((leftHash, rightHash) => leftHash - rightHash);
  const hashToRank = new Map<number, number>();
  for (let rankIndex = 0; rankIndex < sortedUniqueHashes.length; rankIndex++) {
    hashToRank.set(sortedUniqueHashes[rankIndex], rankIndex + 1);
  }

  const totalTokens = filesHashedTokens.reduce(
    (runningSum, fileTokens) => runningSum + fileTokens.length,
    0,
  );
  const sentinelCount = Math.max(0, filesHashedTokens.length - 1);
  const sequenceLength = totalTokens + sentinelCount;

  const tokenSequence: number[] = new Array(sequenceLength);
  const fileOf: number[] = new Array(sequenceLength);
  const fileOffsets: number[] = new Array(filesHashedTokens.length);

  let writeCursor = 0;
  let nextSentinelValue = -1;

  for (let fileIndex = 0; fileIndex < filesHashedTokens.length; fileIndex++) {
    fileOffsets[fileIndex] = writeCursor;
    const fileTokens = filesHashedTokens[fileIndex];
    for (const hashedToken of fileTokens) {
      tokenSequence[writeCursor] = hashToRank.get(hashedToken.hash) ?? 0;
      fileOf[writeCursor] = fileIndex;
      writeCursor++;
    }
    if (fileIndex < filesHashedTokens.length - 1) {
      tokenSequence[writeCursor] = nextSentinelValue;
      fileOf[writeCursor] = SENTINEL_FILE_INDEX;
      writeCursor++;
      nextSentinelValue--;
    }
  }

  return { tokenSequence, fileOf, fileOffsets };
};

export const SENTINEL_FILE_MARKER = SENTINEL_FILE_INDEX;
