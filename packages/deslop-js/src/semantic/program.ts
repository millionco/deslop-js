import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ts from "typescript";
import { SEMANTIC_MAX_PROGRAM_FILES, DEFAULT_SEMANTIC_TSCONFIG_NAMES } from "../constants.js";

export interface SemanticContext {
  program: ts.Program;
  checker: ts.TypeChecker;
  rootSourceFiles: ts.SourceFile[];
  tsconfigPath: string;
}

export interface SemanticContextFailure {
  reason:
    | "no-tsconfig"
    | "tsconfig-parse-error"
    | "program-creation-failed"
    | "too-many-files"
    | "typescript-load-failed";
  message: string;
}

export type SemanticContextResult =
  | { ok: true; context: SemanticContext }
  | { ok: false; failure: SemanticContextFailure };

const findNearestTsconfig = (
  rootDir: string,
  explicitPath: string | undefined,
): string | undefined => {
  if (explicitPath) {
    const absoluteExplicit = resolve(rootDir, explicitPath);
    if (existsSync(absoluteExplicit)) return absoluteExplicit;
    return undefined;
  }
  for (const candidateName of DEFAULT_SEMANTIC_TSCONFIG_NAMES) {
    const candidatePath = resolve(rootDir, candidateName);
    if (existsSync(candidatePath)) return candidatePath;
  }
  return undefined;
};

export const createSemanticContext = (
  rootDir: string,
  tsconfigPath: string | undefined,
): SemanticContextResult => {
  const resolvedTsconfigPath = findNearestTsconfig(rootDir, tsconfigPath);
  if (!resolvedTsconfigPath) {
    return {
      ok: false,
      failure: { reason: "no-tsconfig", message: `No tsconfig found under ${rootDir}` },
    };
  }

  const configFileContent = ts.readConfigFile(resolvedTsconfigPath, ts.sys.readFile);
  if (configFileContent.error) {
    return {
      ok: false,
      failure: {
        reason: "tsconfig-parse-error",
        message: ts.flattenDiagnosticMessageText(configFileContent.error.messageText, "\n"),
      },
    };
  }

  const parsedCommandLine = ts.parseJsonConfigFileContent(
    configFileContent.config,
    ts.sys,
    dirname(resolvedTsconfigPath),
    {
      noEmit: true,
      skipLibCheck: true,
      allowJs: true,
      isolatedModules: false,
    },
    resolvedTsconfigPath,
  );

  if (parsedCommandLine.errors.length > 0) {
    const fatalErrors = parsedCommandLine.errors.filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
    if (fatalErrors.length > 0 && parsedCommandLine.fileNames.length === 0) {
      return {
        ok: false,
        failure: {
          reason: "tsconfig-parse-error",
          message: ts.flattenDiagnosticMessageText(fatalErrors[0].messageText, "\n"),
        },
      };
    }
  }

  if (parsedCommandLine.fileNames.length > SEMANTIC_MAX_PROGRAM_FILES) {
    return {
      ok: false,
      failure: {
        reason: "too-many-files",
        message: `Project has ${parsedCommandLine.fileNames.length} files, exceeds SEMANTIC_MAX_PROGRAM_FILES=${SEMANTIC_MAX_PROGRAM_FILES}`,
      },
    };
  }

  try {
    const program = ts.createProgram({
      rootNames: parsedCommandLine.fileNames,
      options: parsedCommandLine.options,
      projectReferences: parsedCommandLine.projectReferences,
    });
    const checker = program.getTypeChecker();
    const rootSourceFiles = program
      .getSourceFiles()
      .filter((sourceFile) => !sourceFile.isDeclarationFile || sourceFile.fileName.endsWith(".d.ts"));

    return {
      ok: true,
      context: {
        program,
        checker,
        rootSourceFiles,
        tsconfigPath: resolvedTsconfigPath,
      },
    };
  } catch (programError) {
    return {
      ok: false,
      failure: {
        reason: "program-creation-failed",
        message: programError instanceof Error ? programError.message : String(programError),
      },
    };
  }
};
