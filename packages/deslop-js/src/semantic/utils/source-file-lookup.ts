import ts from "typescript";
import { resolve as resolvePath } from "node:path";

export const normalizeSourcePath = (filePath: string): string => resolvePath(filePath);

export const buildSourceFileLookup = (program: ts.Program): Map<string, ts.SourceFile> => {
  const lookup = new Map<string, ts.SourceFile>();
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    lookup.set(normalizeSourcePath(sourceFile.fileName), sourceFile);
  }
  return lookup;
};
