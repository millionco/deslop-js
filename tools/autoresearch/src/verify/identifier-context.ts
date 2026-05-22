import type { LineMatch } from "./grep-corpus.js";

const buildOccurrenceRanges = (text: string): Array<[number, number]> => {
  const stringRanges: Array<[number, number]> = [];
  const commentRanges: Array<[number, number]> = [];
  const length = text.length;
  let index = 0;
  while (index < length) {
    const ch = text[index];
    if (ch === "/" && index + 1 < length) {
      const nextChar = text[index + 1];
      if (nextChar === "/") {
        const lineBreakIndex = text.indexOf("\n", index + 2);
        const endIndex = lineBreakIndex === -1 ? length : lineBreakIndex;
        commentRanges.push([index, endIndex]);
        index = endIndex;
        continue;
      }
      if (nextChar === "*") {
        const closeIndex = text.indexOf("*/", index + 2);
        const endIndex = closeIndex === -1 ? length : closeIndex + 2;
        commentRanges.push([index, endIndex]);
        index = endIndex;
        continue;
      }
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quoteChar = ch;
      let scanIndex = index + 1;
      while (scanIndex < length) {
        const scanChar = text[scanIndex];
        if (scanChar === "\\") {
          scanIndex += 2;
          continue;
        }
        if (scanChar === quoteChar) {
          scanIndex++;
          break;
        }
        scanIndex++;
      }
      stringRanges.push([index, scanIndex]);
      index = scanIndex;
      continue;
    }
    index++;
  }
  return [...stringRanges, ...commentRanges];
};

const isOffsetInsideRanges = (offset: number, ranges: Array<[number, number]>): boolean => {
  for (const [start, end] of ranges) {
    if (offset >= start && offset < end) return true;
  }
  return false;
};

const findAllIdentifierOffsets = (text: string, identifier: string): number[] => {
  const offsets: number[] = [];
  const pattern = new RegExp(`\\b${identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    offsets.push(match.index);
    if (match.index === pattern.lastIndex) pattern.lastIndex++;
  }
  return offsets;
};

const NAMED_IMPORT_LINE_PATTERN = /(?:import|export)\s*(?:type\s+)?\{[^}]*\}\s*from\s*['"`]/;

const matchesNamedImportContext = (lineText: string, identifier: string): boolean => {
  if (!NAMED_IMPORT_LINE_PATTERN.test(lineText)) return false;
  const insideBraces = lineText.match(/\{([^}]*)\}/);
  if (!insideBraces) return false;
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const importPattern = new RegExp(
    `(?:^|[,\\s])\\s*(?:type\\s+)?${escaped}(?:\\s+as\\s+\\w+)?\\s*(?:,|$)`,
  );
  return importPattern.test(insideBraces[1]);
};

const matchesDefaultOrNamespaceImport = (lineText: string, identifier: string): boolean => {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const defaultImportPattern = new RegExp(
    `import\\s+${escaped}(?:\\s*,\\s*\\{[^}]*\\})?\\s+from\\s+['"\`]`,
  );
  if (defaultImportPattern.test(lineText)) return true;
  const namespaceImportPattern = new RegExp(`import\\s+\\*\\s+as\\s+${escaped}\\s+from\\s+['"\`]`);
  return namespaceImportPattern.test(lineText);
};

const matchesUsageContext = (lineText: string, identifier: string): boolean => {
  const occurrenceOffsets = findAllIdentifierOffsets(lineText, identifier);
  if (occurrenceOffsets.length === 0) return false;
  const literalRanges = buildOccurrenceRanges(lineText);
  for (const occurrenceOffset of occurrenceOffsets) {
    if (!isOffsetInsideRanges(occurrenceOffset, literalRanges)) {
      return true;
    }
  }
  return false;
};

export const isCredibleImportLine = (lineText: string, identifier: string): boolean => {
  if (matchesNamedImportContext(lineText, identifier)) return true;
  if (matchesDefaultOrNamespaceImport(lineText, identifier)) return true;
  return false;
};

export const isCredibleUsageLine = (lineText: string, identifier: string): boolean => {
  if (isCredibleImportLine(lineText, identifier)) return true;
  if (matchesUsageContext(lineText, identifier)) return true;
  return false;
};

export const filterImportOnlyMatches = (
  matches: { lineText: string; filePath: string; lineNumber: number }[],
  identifier: string,
): { lineText: string; filePath: string; lineNumber: number }[] => {
  return matches.filter((lineMatch) => isCredibleImportLine(lineMatch.lineText, identifier));
};

export const filterCredibleMatches = (matches: LineMatch[], identifier: string): LineMatch[] => {
  return matches.filter((lineMatch) => isCredibleUsageLine(lineMatch.lineText, identifier));
};
