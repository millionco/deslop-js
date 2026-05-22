import { dirname, resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import ts from "typescript";
import type { DependencyGraph, DeslopConfig } from "../types.js";
import { SEMANTIC_MAX_PROGRAM_FILES } from "../constants.js";

export interface SemanticContext {
  program: ts.Program;
  checker: ts.TypeChecker;
  tsconfigPath: string;
  rootDir: string;
  sourceFileByPath: Map<string, ts.SourceFile>;
}

const TSCONFIG_CANDIDATES = [
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.base.json",
  "jsconfig.json",
];

const findTsconfig = (rootDir: string, overridePath: string | undefined): string | undefined => {
  if (overridePath) {
    const resolved = resolve(rootDir, overridePath);
    if (existsSync(resolved)) return resolved;
  }
  for (const candidate of TSCONFIG_CANDIDATES) {
    const candidatePath = resolve(rootDir, candidate);
    if (existsSync(candidatePath)) return candidatePath;
  }
  return undefined;
};

const normalizePath = (filePath: string): string => filePath.split(sep).join("/");

export const createSemanticContext = (
  graph: DependencyGraph,
  config: DeslopConfig,
): SemanticContext | undefined => {
  const tsconfigPath = findTsconfig(config.rootDir, config.tsConfigPath);
  if (!tsconfigPath) return undefined;

  let program: ts.Program;
  let checker: ts.TypeChecker;
  try {
    const parsedCommandLine = readTsconfig(tsconfigPath);
    if (!parsedCommandLine) return undefined;

    const rootNames = collectRootNames(parsedCommandLine, graph);
    if (rootNames.length === 0) return undefined;
    if (rootNames.length > SEMANTIC_MAX_PROGRAM_FILES) return undefined;

    program = ts.createProgram({
      rootNames,
      options: {
        ...parsedCommandLine.options,
        noEmit: true,
        skipLibCheck: true,
        noLib: false,
        allowJs: true,
        isolatedModules: false,
      },
    });

    const sourceFileCount = program.getSourceFiles().length;
    if (sourceFileCount > SEMANTIC_MAX_PROGRAM_FILES) return undefined;

    checker = program.getTypeChecker();
  } catch {
    return undefined;
  }

  const sourceFileByPath = new Map<string, ts.SourceFile>();
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    sourceFileByPath.set(normalizePath(sourceFile.fileName), sourceFile);
  }

  return {
    program,
    checker,
    tsconfigPath,
    rootDir: config.rootDir,
    sourceFileByPath,
  };
};

const readTsconfig = (tsconfigPath: string): ts.ParsedCommandLine | undefined => {
  const readResult = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (readResult.error) return undefined;

  const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, dirname(tsconfigPath));
  if (parsed.errors.length > 0) {
    const fatalErrors = parsed.errors.filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
    if (fatalErrors.length > 0 && parsed.fileNames.length === 0) return undefined;
  }
  return parsed;
};

const collectRootNames = (
  parsedCommandLine: ts.ParsedCommandLine,
  graph: DependencyGraph,
): string[] => {
  const fromConfig = new Set(parsedCommandLine.fileNames.map(normalizePath));
  const fromGraph = new Set(graph.modules.map((module) => normalizePath(module.fileId.path)));

  if (fromConfig.size === 0) return [...fromGraph];

  const merged = new Set<string>();
  for (const filePath of fromConfig) merged.add(filePath);
  for (const filePath of fromGraph) {
    if (filePath.endsWith(".ts") || filePath.endsWith(".tsx") || filePath.endsWith(".mts")) {
      merged.add(filePath);
    }
  }
  return [...merged];
};

export const lookupSourceFile = (
  context: SemanticContext,
  filePath: string,
): ts.SourceFile | undefined => context.sourceFileByPath.get(normalizePath(filePath));
