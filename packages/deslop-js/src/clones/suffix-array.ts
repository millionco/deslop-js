/**
 * O(N log N) prefix-doubling suffix array with two-pass radix sort.
 *
 * Returns `suffixArray` such that `suffixArray[index]` is the start position
 * of the index-th lexicographically-smallest suffix of `tokenSequence`.
 *
 * Sentinel handling: any negative values in `tokenSequence` (the per-file
 * separators emitted by `concatenate.rankReduceAndConcatenate`) are shifted up
 * so all ranks are >= 0. Negative sentinels naturally sort before all real
 * ranks, which is the property we need for cross-file suffix comparison.
 */
export const buildSuffixArray = (tokenSequence: number[]): number[] => {
  const sequenceLength = tokenSequence.length;
  if (sequenceLength === 0) return [];

  let minimumValue = 0;
  for (let scanIndex = 0; scanIndex < sequenceLength; scanIndex++) {
    if (tokenSequence[scanIndex] < minimumValue) minimumValue = tokenSequence[scanIndex];
  }

  let currentRanks: number[] = new Array(sequenceLength);
  for (let scanIndex = 0; scanIndex < sequenceLength; scanIndex++) {
    currentRanks[scanIndex] = tokenSequence[scanIndex] - minimumValue;
  }
  let suffixArray: number[] = new Array(sequenceLength);
  for (let positionIndex = 0; positionIndex < sequenceLength; positionIndex++) {
    suffixArray[positionIndex] = positionIndex;
  }
  let nextRanks: number[] = new Array(sequenceLength);
  let scratchSuffixArray: number[] = new Array(sequenceLength);

  let maximumRank = 0;
  for (let scanIndex = 0; scanIndex < sequenceLength; scanIndex++) {
    if (currentRanks[scanIndex] > maximumRank) maximumRank = currentRanks[scanIndex];
  }

  let stride = 1;
  while (stride < sequenceLength) {
    const bucketCount = maximumRank + 2;
    const buckets: number[] = new Array(bucketCount + 1).fill(0);

    for (let suffixIndex = 0; suffixIndex < sequenceLength; suffixIndex++) {
      const startPosition = suffixArray[suffixIndex];
      const secondaryKey =
        startPosition + stride < sequenceLength ? currentRanks[startPosition + stride] + 1 : 0;
      buckets[secondaryKey]++;
    }
    let prefixSum = 0;
    for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex++) {
      const bucketCountValue = buckets[bucketIndex];
      buckets[bucketIndex] = prefixSum;
      prefixSum += bucketCountValue;
    }
    for (let suffixIndex = 0; suffixIndex < sequenceLength; suffixIndex++) {
      const startPosition = suffixArray[suffixIndex];
      const secondaryKey =
        startPosition + stride < sequenceLength ? currentRanks[startPosition + stride] + 1 : 0;
      scratchSuffixArray[buckets[secondaryKey]] = startPosition;
      buckets[secondaryKey]++;
    }

    for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex++) buckets[bucketIndex] = 0;
    for (let suffixIndex = 0; suffixIndex < sequenceLength; suffixIndex++) {
      const startPosition = scratchSuffixArray[suffixIndex];
      buckets[currentRanks[startPosition]]++;
    }
    prefixSum = 0;
    for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex++) {
      const bucketCountValue = buckets[bucketIndex];
      buckets[bucketIndex] = prefixSum;
      prefixSum += bucketCountValue;
    }
    for (let suffixIndex = 0; suffixIndex < sequenceLength; suffixIndex++) {
      const startPosition = scratchSuffixArray[suffixIndex];
      suffixArray[buckets[currentRanks[startPosition]]] = startPosition;
      buckets[currentRanks[startPosition]]++;
    }

    nextRanks[suffixArray[0]] = 0;
    for (let suffixIndex = 1; suffixIndex < sequenceLength; suffixIndex++) {
      const previousStart = suffixArray[suffixIndex - 1];
      const currentStart = suffixArray[suffixIndex];
      const previousSecondary =
        previousStart + stride < sequenceLength ? currentRanks[previousStart + stride] : -1;
      const currentSecondary =
        currentStart + stride < sequenceLength ? currentRanks[currentStart + stride] : -1;
      const isSameBucket =
        currentRanks[previousStart] === currentRanks[currentStart] &&
        previousSecondary === currentSecondary;
      nextRanks[currentStart] = nextRanks[previousStart] + (isSameBucket ? 0 : 1);
    }

    const newMaximumRank = nextRanks[suffixArray[sequenceLength - 1]];
    [currentRanks, nextRanks] = [nextRanks, currentRanks];
    if (newMaximumRank === sequenceLength - 1) break;
    maximumRank = newMaximumRank;
    stride *= 2;
  }

  return suffixArray;
};

/**
 * Kasai's algorithm: O(N) longest-common-prefix array given a suffix array.
 *
 * `lcp[i]` is the LCP length of suffix `suffixArray[i]` and suffix
 * `suffixArray[i - 1]` (with `lcp[0] = 0` for the smallest suffix). We treat
 * negative sentinel positions as inequal so a real-token LCP can never span
 * a sentinel boundary.
 */
export const buildLcpArray = (tokenSequence: number[], suffixArray: number[]): number[] => {
  const sequenceLength = tokenSequence.length;
  const inverseSuffixArray: number[] = new Array(sequenceLength);
  for (let arrayIndex = 0; arrayIndex < sequenceLength; arrayIndex++) {
    inverseSuffixArray[suffixArray[arrayIndex]] = arrayIndex;
  }

  const lcpArray: number[] = new Array(sequenceLength).fill(0);
  let runningLcp = 0;
  for (let positionIndex = 0; positionIndex < sequenceLength; positionIndex++) {
    if (inverseSuffixArray[positionIndex] === 0) {
      runningLcp = 0;
      continue;
    }
    const previousStart = suffixArray[inverseSuffixArray[positionIndex] - 1];
    while (
      positionIndex + runningLcp < sequenceLength &&
      previousStart + runningLcp < sequenceLength &&
      tokenSequence[positionIndex + runningLcp] === tokenSequence[previousStart + runningLcp] &&
      tokenSequence[positionIndex + runningLcp] >= 0
    ) {
      runningLcp++;
    }
    lcpArray[inverseSuffixArray[positionIndex]] = runningLcp;
    if (runningLcp > 0) runningLcp--;
  }

  return lcpArray;
};
