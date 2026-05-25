import { readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { parseSync } from "oxc-parser";
import {
  MAX_PARSE_FILE_SIZE_BYTES,
  BINARY_DETECTION_NULL_BYTE_THRESHOLD,
  BINARY_DETECTION_SAMPLE_BYTES,
  MINIFIED_DETECTION_AVG_LINE_LENGTH_THRESHOLD,
  MINIFIED_DETECTION_MIN_BYTES,
} from "../constants.js";
import type {
  CodeClone,
  CodeCloneFamily,
  CodeCloneInstance,
  CodeClonesConfig,
  DependencyGraph,
  MirroredDirectory,
} from "../types.js";
import { rankReduceAndConcatenate } from "./concatenate.js";
import { extractRawCloneGroups, type RawCloneGroup } from "./extract.js";
import { groupClonesIntoFamilies } from "./families.js";
import { detectMirroredDirectoryPairs } from "./mirrored-directories.js";
import { normalizeAndHashTokens } from "./normalize.js";
import { buildLcpArray, buildSuffixArray } from "./suffix-array.js";
import type { SourceToken } from "./token-types.js";
import { tokenizeAst } from "./token-visitor.js";

interface TokenizedFile {
  path: string;
  sourceTokens: SourceToken[];
  /** 1-based byte offsets at line starts for line/column reconstruction. */
  lineStarts: number[];
  lineCount: number;
}

const isBinaryFile = (sourceText: string): boolean => {
  const sampleEnd = Math.min(sourceText.length, BINARY_DETECTION_SAMPLE_BYTES);
  let nullByteCount = 0;
  for (let charIndex = 0; charIndex < sampleEnd; charIndex++) {
    if (sourceText.charCodeAt(charIndex) === 0) {
      nullByteCount++;
      if (nullByteCount >= BINARY_DETECTION_NULL_BYTE_THRESHOLD) return true;
    }
  }
  return false;
};

const isMinifiedSource = (sourceText: string): boolean => {
  if (sourceText.length < MINIFIED_DETECTION_MIN_BYTES) return false;
  const lineCount = (sourceText.match(/\n/g)?.length ?? 0) + 1;
  return sourceText.length / lineCount > MINIFIED_DETECTION_AVG_LINE_LENGTH_THRESHOLD;
};

const computeLineStarts = (sourceText: string): number[] => {
  const lineStarts: number[] = [0];
  for (let charIndex = 0; charIndex < sourceText.length; charIndex++) {
    if (sourceText.charCodeAt(charIndex) === 10) lineStarts.push(charIndex + 1);
  }
  return lineStarts;
};

const offsetToLineColumn = (
  byteOffset: number,
  lineStarts: number[],
): { line: number; column: number } => {
  let lowIndex = 0;
  let highIndex = lineStarts.length - 1;
  while (lowIndex < highIndex) {
    const middleIndex = (lowIndex + highIndex + 1) >>> 1;
    if (lineStarts[middleIndex] <= byteOffset) lowIndex = middleIndex;
    else highIndex = middleIndex - 1;
  }
  return { line: lowIndex + 1, column: byteOffset - lineStarts[lowIndex] };
};

const tokenizeFile = (filePath: string): TokenizedFile | undefined => {
  let sourceStat: ReturnType<typeof statSync>;
  try {
    sourceStat = statSync(filePath);
  } catch {
    return undefined;
  }
  if (sourceStat.size > MAX_PARSE_FILE_SIZE_BYTES) return undefined;

  let sourceText: string;
  try {
    sourceText = readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
  if (sourceText.length === 0) return undefined;
  if (isBinaryFile(sourceText)) return undefined;
  if (isMinifiedSource(sourceText)) return undefined;

  let parseResult: ReturnType<typeof parseSync>;
  try {
    parseResult = parseSync(filePath, sourceText);
  } catch {
    return undefined;
  }
  const sourceTokens = tokenizeAst(parseResult.program);
  if (sourceTokens.length === 0) return undefined;

  const lineStarts = computeLineStarts(sourceText);
  return {
    path: filePath,
    sourceTokens,
    lineStarts,
    lineCount: lineStarts.length,
  };
};

const buildCloneInstance = (
  rawInstance: { fileIndex: number; tokenOffsetWithinFile: number },
  tokenLength: number,
  tokenizedFiles: TokenizedFile[],
): CodeCloneInstance => {
  const file = tokenizedFiles[rawInstance.fileIndex];
  const firstToken = file.sourceTokens[rawInstance.tokenOffsetWithinFile];
  const lastToken = file.sourceTokens[rawInstance.tokenOffsetWithinFile + tokenLength - 1];
  const startSpan = offsetToLineColumn(firstToken.start, file.lineStarts);
  const endSpan = offsetToLineColumn(lastToken.end, file.lineStarts);
  return {
    path: file.path,
    startLine: startSpan.line,
    endLine: endSpan.line,
    startColumn: startSpan.column,
    endColumn: endSpan.column,
  };
};

const directoryOf = (filePath: string): string => dirname(filePath);

const filterRawGroupsToReportableClones = (
  rawGroups: RawCloneGroup[],
  tokenizedFiles: TokenizedFile[],
  config: CodeClonesConfig,
): CodeClone[] => {
  const codeClones: CodeClone[] = [];
  for (const rawGroup of rawGroups) {
    const instances = rawGroup.instances.map((rawInstance) =>
      buildCloneInstance(rawInstance, rawGroup.tokenLength, tokenizedFiles),
    );

    let lineCount = 0;
    for (const instance of instances) {
      const instanceLineCount = instance.endLine - instance.startLine + 1;
      if (instanceLineCount > lineCount) lineCount = instanceLineCount;
    }
    if (lineCount < config.minLines) continue;
    if (instances.length < config.minOccurrences) continue;

    if (config.skipLocal) {
      const distinctDirectories = new Set(instances.map((instance) => directoryOf(instance.path)));
      if (distinctDirectories.size < 2) continue;
    }

    const distinctFiles = new Set(instances.map((instance) => instance.path));
    const confidence = distinctFiles.size >= 2 ? "high" : "medium";

    codeClones.push({
      instances,
      tokenCount: rawGroup.tokenLength,
      lineCount,
      confidence,
      reason:
        distinctFiles.size >= 2
          ? `${instances.length} clone instances spanning ${distinctFiles.size} files (≥${rawGroup.tokenLength} tokens, ${lineCount} lines)`
          : `${instances.length} clone instances within a single file (≥${rawGroup.tokenLength} tokens, ${lineCount} lines)`,
    });
  }

  codeClones.sort((firstClone, secondClone) => {
    if (firstClone.lineCount !== secondClone.lineCount) {
      return secondClone.lineCount - firstClone.lineCount;
    }
    return secondClone.tokenCount - firstClone.tokenCount;
  });
  return codeClones;
};

export interface CodeClonesResult {
  codeClones: CodeClone[];
  codeCloneFamilies: CodeCloneFamily[];
  mirroredDirectories: MirroredDirectory[];
}

/**
 * Token-based code clone detector.
 *
 * Pipeline:
 *  1. Tokenize each file with the AST visitor in `token-visitor.ts`
 *  2. Hash + normalize tokens with the chosen detection mode
 *  3. Concatenate every file's hashed tokens with unique negative sentinels
 *  4. Build a suffix array (prefix doubling + radix sort) and LCP array
 *  5. Stack-based LCP-interval scan extracts maximal clone groups
 *  6. Filter on min-tokens / min-lines / min-occurrences / skip-local
 *  7. Group clones into families; collapse N two-file families with matching
 *     basenames into a `MirroredDirectory` finding
 *
 * Returns empty arrays when `config.enabled` is false.
 */
export const detectCodeClones = (
  graph: DependencyGraph,
  config: CodeClonesConfig | undefined,
  rootDir: string,
): CodeClonesResult => {
  if (!config || !config.enabled) {
    return { codeClones: [], codeCloneFamilies: [], mirroredDirectories: [] };
  }

  const tokenizedFiles: TokenizedFile[] = [];
  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;
    if (module.isConfigFile) continue;
    const tokenizedFile = tokenizeFile(module.fileId.path);
    if (!tokenizedFile) continue;
    tokenizedFiles.push(tokenizedFile);
  }
  if (tokenizedFiles.length === 0) {
    return { codeClones: [], codeCloneFamilies: [], mirroredDirectories: [] };
  }

  const filesHashedTokens = tokenizedFiles.map((file) =>
    normalizeAndHashTokens(file.sourceTokens, config.mode),
  );
  const filesTokenCounts = filesHashedTokens.map((fileTokens) => fileTokens.length);

  const filesHaveEnoughTokens = filesTokenCounts.some((count) => count >= config.minTokens);
  if (!filesHaveEnoughTokens) {
    return { codeClones: [], codeCloneFamilies: [], mirroredDirectories: [] };
  }

  const concatenation = rankReduceAndConcatenate(filesHashedTokens);
  if (concatenation.tokenSequence.length === 0) {
    return { codeClones: [], codeCloneFamilies: [], mirroredDirectories: [] };
  }

  const suffixArray = buildSuffixArray(concatenation.tokenSequence);
  const lcpArray = buildLcpArray(concatenation.tokenSequence, suffixArray);
  const rawCloneGroups = extractRawCloneGroups(
    suffixArray,
    lcpArray,
    concatenation.fileOf,
    concatenation.fileOffsets,
    filesTokenCounts,
    config.minTokens,
  );

  const codeClones = filterRawGroupsToReportableClones(rawCloneGroups, tokenizedFiles, config);
  const codeCloneFamilies = groupClonesIntoFamilies(codeClones);
  const mirroredDirectories = detectMirroredDirectoryPairs(codeCloneFamilies, rootDir);

  return { codeClones, codeCloneFamilies, mirroredDirectories };
};
