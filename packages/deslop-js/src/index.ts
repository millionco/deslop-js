import { resolve, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import fg from "fast-glob";
import type { DeslopConfig, DeslopError, ScanResult } from "./types.js";
import {
  ConfigError,
  DetectorError,
  ResolverError,
  WorkspaceError,
  describeUnknownError,
} from "./errors.js";
import {
  DEFAULT_ENTRY_GLOBS,
  DEFAULT_EXTENSIONS,
  DEFAULT_SEMANTIC_DECORATOR_ALLOWLIST,
  OUTPUT_DIRECTORIES,
} from "./constants.js";
import { collectSourceFiles, resolveEntries, getFrameworkExclusions } from "./collect/entries.js";
import { resolveWorkspaces } from "./collect/workspaces.js";
import { parseSourceFile } from "./collect/parse.js";
import { createResolver } from "./resolver/resolve.js";
import { buildDependencyGraph, type ModuleLinkInput } from "./linker/build.js";
import { traceReachability } from "./linker/reachability.js";
import { resolveReExportChains } from "./linker/re-exports.js";
import { generateReport } from "./report/generate.js";
import { findMonorepoRoot } from "./utils/find-monorepo-root.js";

const STYLE_EXTENSIONS = [".css", ".scss"];

const REACT_NATIVE_ENABLERS = ["react-native", "expo"];

const detectReactNative = (
  rootDir: string,
  workspacePackages: Array<{ directory: string }>,
): boolean => {
  const directoriesToCheck = [
    rootDir,
    ...workspacePackages.map((workspacePackage) => workspacePackage.directory),
  ];
  for (const directory of directoriesToCheck) {
    const packageJsonPath = resolve(directory, "package.json");
    if (!existsSync(packageJsonPath)) continue;
    try {
      const content = readFileSync(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(content);
      const allDependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.optionalDependencies,
      };
      if (REACT_NATIVE_ENABLERS.some((enabler) => enabler in allDependencies)) return true;
    } catch {
      continue;
    }
  }
  return false;
};

export type {
  ScanResult,
  DeslopConfig,
  UnusedFile,
  UnusedExport,
  UnusedDependency,
  CircularDependency,
  UnusedType,
  UnusedTypeKind,
  SemanticConfig,
  SemanticConfidence,
  MisclassifiedDependency,
  DependencyDeclaredAs,
  UnusedEnumMember,
  UnusedClassMember,
  ClassMemberKind,
  RedundantAlias,
  RedundantAliasKind,
  DuplicateExport,
  DuplicateExportOccurrence,
  DuplicateImport,
  DuplicateImportOccurrence,
  RedundantTypePattern,
  RedundantTypePatternKind,
  IdentityWrapper,
  DuplicateTypeDefinition,
  DuplicateTypeDefinitionInstance,
  DuplicateInlineType,
  InlineTypeOccurrence,
  InlineTypeContext,
  SimplifiableFunction,
  SimplifiableFunctionKind,
  SimplifiableExpression,
  SimplifiableExpressionKind,
  DuplicateConstant,
  DuplicateConstantOccurrence,
  DeslopError,
  DeslopErrorCode,
  DeslopErrorModule,
  DeslopErrorSeverity,
} from "./types.js";

/**
 * Default flags below mark rules off-by-default. Rationale for each:
 *
 * - `reportUnusedClassMembers: false` — class-member dead-code detection
 *   requires whole-program semantic analysis to be sound (subclass overrides,
 *   structural typing, framework method-by-name invocation like `@HttpGet`).
 *   When enabled on real React/Effect/NestJS codebases it produces a high
 *   rate of stylistic-FP findings (lifecycle methods, framework hooks). Off
 *   by default until the heuristics are tightened. Opt in via
 *   `semantic.reportUnusedClassMembers = true` when you accept the noise.
 *
 * - `reportTypes: false` — type-only exports are over-represented in
 *   barrel re-exports (the canonical `export type * from "./types"` pattern)
 *   and are rarely actionable signal. Off by default; opt in when auditing
 *   a type-heavy package.
 *
 * - `includeEntryExports: false` — exports from entry-point files are
 *   "API surface" and intentionally exported for external consumers; flagging
 *   them as "unused" is noise within a single repo scan. Opt in when auditing
 *   a package boundary (e.g. before deleting public APIs).
 *
 * - `reportRedundancy: true` — on because redundancy findings are mostly
 *   high-signal and the detectors carry their own confidence tiers.
 */
const fillSemanticConfig = (
  semanticOverrides: Partial<DeslopConfig["semantic"]> | undefined,
): DeslopConfig["semantic"] => {
  if (semanticOverrides === undefined) return undefined;
  return {
    enabled: semanticOverrides.enabled ?? false,
    reportUnusedTypes: semanticOverrides.reportUnusedTypes ?? true,
    reportUnusedEnumMembers: semanticOverrides.reportUnusedEnumMembers ?? true,
    reportUnusedClassMembers: semanticOverrides.reportUnusedClassMembers ?? false,
    reportRedundantVariableAliases: semanticOverrides.reportRedundantVariableAliases ?? true,
    reportMisclassifiedDependencies: semanticOverrides.reportMisclassifiedDependencies ?? true,
    reportRoundTripAliases: semanticOverrides.reportRoundTripAliases ?? true,
    decoratorAllowlist:
      semanticOverrides.decoratorAllowlist ?? DEFAULT_SEMANTIC_DECORATOR_ALLOWLIST,
  };
};

export const defineConfig = (
  options: Partial<DeslopConfig> & { rootDir: string },
): DeslopConfig => ({
  rootDir: resolve(options.rootDir),
  entryPatterns: options.entryPatterns ?? DEFAULT_ENTRY_GLOBS,
  ignorePatterns: options.ignorePatterns ?? [],
  includeExtensions: options.includeExtensions ?? DEFAULT_EXTENSIONS,
  tsConfigPath: options.tsConfigPath,
  reportTypes: options.reportTypes ?? false,
  includeEntryExports: options.includeEntryExports ?? false,
  reportRedundancy: options.reportRedundancy ?? true,
  semantic: fillSemanticConfig(options.semantic),
});

const buildEmptyScanResult = (errors: DeslopError[], elapsedMs: number): ScanResult => ({
  unusedFiles: [],
  unusedExports: [],
  unusedDependencies: [],
  circularDependencies: [],
  unusedTypes: [],
  misclassifiedDependencies: [],
  unusedEnumMembers: [],
  unusedClassMembers: [],
  redundantAliases: [],
  duplicateExports: [],
  duplicateImports: [],
  redundantTypePatterns: [],
  identityWrappers: [],
  duplicateTypeDefinitions: [],
  duplicateInlineTypes: [],
  simplifiableFunctions: [],
  simplifiableExpressions: [],
  duplicateConstants: [],
  analysisErrors: errors,
  totalFiles: 0,
  totalExports: 0,
  analysisTimeMs: elapsedMs,
});

const validateConfig = (config: DeslopConfig): DeslopError | undefined => {
  if (!config.rootDir || typeof config.rootDir !== "string") {
    return new ConfigError({ message: "config.rootDir must be a non-empty string" });
  }
  if (!existsSync(config.rootDir)) {
    return new ConfigError({
      message: `config.rootDir does not exist: ${config.rootDir}`,
      path: config.rootDir,
    });
  }
  return undefined;
};

export const analyze = async (config: DeslopConfig): Promise<ScanResult> => {
  const pipelineStartTime = performance.now();
  const setupErrors: DeslopError[] = [];

  const configValidationError = validateConfig(config);
  if (configValidationError) {
    return buildEmptyScanResult([configValidationError], performance.now() - pipelineStartTime);
  }

  let workspaceDiscovery: ReturnType<typeof resolveWorkspaces>;
  try {
    workspaceDiscovery = resolveWorkspaces(resolve(config.rootDir));
  } catch (workspaceError) {
    setupErrors.push(
      new WorkspaceError({
        code: "workspace-discovery-failed",
        message: "resolveWorkspaces threw — falling back to single-package mode",
        path: config.rootDir,
        detail: describeUnknownError(workspaceError),
      }),
    );
    workspaceDiscovery = {
      packages: [],
      excludedDirectories: [],
      hasRootLevelWorkspacePatterns: false,
    };
  }
  const workspacePackages = [...workspaceDiscovery.packages];

  let monorepoRoot: string | undefined;
  try {
    monorepoRoot = findMonorepoRoot(config.rootDir);
  } catch (monorepoError) {
    setupErrors.push(
      new WorkspaceError({
        code: "monorepo-discovery-failed",
        message: "findMonorepoRoot threw",
        path: config.rootDir,
        detail: describeUnknownError(monorepoError),
      }),
    );
    monorepoRoot = undefined;
  }
  if (monorepoRoot) {
    try {
      const monorepoWorkspaces = resolveWorkspaces(monorepoRoot);
      const existingDirectories = new Set(
        workspacePackages.map((workspacePackage) => workspacePackage.directory),
      );
      for (const monorepoPackage of monorepoWorkspaces.packages) {
        if (!existingDirectories.has(monorepoPackage.directory)) {
          workspacePackages.push(monorepoPackage);
        }
      }
    } catch (monorepoWorkspaceError) {
      setupErrors.push(
        new WorkspaceError({
          code: "workspace-discovery-failed",
          message: "resolveWorkspaces threw on monorepo root",
          path: monorepoRoot,
          detail: describeUnknownError(monorepoWorkspaceError),
        }),
      );
    }
  }

  let frameworkIgnorePatterns: string[] = [];
  try {
    frameworkIgnorePatterns = getFrameworkExclusions(config.rootDir);
  } catch (frameworkError) {
    setupErrors.push(
      new WorkspaceError({
        code: "workspace-discovery-failed",
        message: "getFrameworkExclusions failed — proceeding without framework exclusion patterns",
        path: config.rootDir,
        detail: describeUnknownError(frameworkError),
      }),
    );
  }

  const absoluteRoot = resolve(config.rootDir);
  const outputDirectoryExclusions = OUTPUT_DIRECTORIES.flatMap((outputDirectory) => {
    const exclusions = [`${absoluteRoot}/${outputDirectory}/**`];
    for (const workspacePackage of workspacePackages) {
      exclusions.push(`${workspacePackage.directory}/${outputDirectory}/**`);
    }
    return exclusions;
  });

  const allExclusionPatterns = [
    ...workspaceDiscovery.excludedDirectories.map((directory) => `${directory}/**`),
    ...frameworkIgnorePatterns,
    ...outputDirectoryExclusions,
  ];

  const configWithExclusions =
    allExclusionPatterns.length > 0
      ? {
          ...config,
          ignorePatterns: [...config.ignorePatterns, ...allExclusionPatterns],
        }
      : config;

  let files: Awaited<ReturnType<typeof collectSourceFiles>>;
  try {
    files = await collectSourceFiles(configWithExclusions);
  } catch (collectError) {
    setupErrors.push(
      new WorkspaceError({
        code: "workspace-discovery-failed",
        severity: "fatal",
        message: "collectSourceFiles failed",
        path: config.rootDir,
        detail: describeUnknownError(collectError),
      }),
    );
    return buildEmptyScanResult(setupErrors, performance.now() - pipelineStartTime);
  }

  let discoveredEntries: Awaited<ReturnType<typeof resolveEntries>>;
  try {
    discoveredEntries = await resolveEntries(configWithExclusions);
  } catch (entriesError) {
    setupErrors.push(
      new WorkspaceError({
        code: "workspace-discovery-failed",
        message: "resolveEntries failed — defaulting to empty entry set",
        path: config.rootDir,
        detail: describeUnknownError(entriesError),
      }),
    );
    discoveredEntries = { productionEntries: [], testEntries: [], alwaysUsedFiles: [] };
  }
  const productionEntrySet = new Set(discoveredEntries.productionEntries);
  const testEntrySet = new Set(discoveredEntries.testEntries);
  const alwaysUsedFileSet = new Set(discoveredEntries.alwaysUsedFiles);

  let hasReactNative = false;
  try {
    hasReactNative = detectReactNative(config.rootDir, workspacePackages);
  } catch {
    hasReactNative = false;
  }

  let moduleResolver: ReturnType<typeof createResolver>;
  try {
    moduleResolver = createResolver(
      config,
      workspacePackages.map((workspacePackage) => ({
        name: workspacePackage.name,
        directory: workspacePackage.directory,
      })),
      { hasReactNative, monorepoRoot },
    );
  } catch (resolverError) {
    setupErrors.push(
      new ResolverError({
        message: "createResolver failed",
        path: config.rootDir,
        detail: describeUnknownError(resolverError),
      }),
    );
    return buildEmptyScanResult(setupErrors, performance.now() - pipelineStartTime);
  }
  const graphInputs: ModuleLinkInput[] = [];

  for (const file of files) {
    const parsedModule = parseSourceFile(file.path);
    const resolvedImportMap = new Map<string, ReturnType<typeof moduleResolver.resolveModule>>();

    const safeResolveImport = (
      specifier: string,
    ): ReturnType<typeof moduleResolver.resolveModule> => {
      try {
        return moduleResolver.resolveModule(specifier, file.path);
      } catch (resolveError) {
        setupErrors.push(
          new ResolverError({
            severity: "warning",
            message: `moduleResolver.resolveModule threw on specifier "${specifier}"`,
            path: file.path,
            detail: describeUnknownError(resolveError),
          }),
        );
        return { resolvedPath: undefined, isExternal: false, packageName: undefined };
      }
    };

    for (const importInfo of parsedModule.imports) {
      if (importInfo.isGlob) {
        const fileDir = dirname(file.path);
        let expandedFiles: string[] = [];
        try {
          expandedFiles = fg.sync(importInfo.specifier, {
            cwd: fileDir,
            absolute: true,
            onlyFiles: true,
            ignore: ["**/node_modules/**"],
          });
        } catch (globError) {
          setupErrors.push(
            new WorkspaceError({
              code: "workspace-discovery-failed",
              message: `fast-glob threw on import glob "${importInfo.specifier}"`,
              path: file.path,
              detail: describeUnknownError(globError),
            }),
          );
        }
        for (const expandedFile of expandedFiles) {
          resolvedImportMap.set(expandedFile, {
            resolvedPath: expandedFile,
            isExternal: false,
            packageName: undefined,
          });
        }
        resolvedImportMap.set(importInfo.specifier, {
          resolvedPath: undefined,
          isExternal: false,
          packageName: undefined,
        });
        continue;
      }
      resolvedImportMap.set(importInfo.specifier, safeResolveImport(importInfo.specifier));
    }

    for (const exportInfo of parsedModule.exports) {
      if (exportInfo.isReExport && exportInfo.reExportSource) {
        if (!resolvedImportMap.has(exportInfo.reExportSource)) {
          resolvedImportMap.set(
            exportInfo.reExportSource,
            safeResolveImport(exportInfo.reExportSource),
          );
        }
      }
    }

    const isAlwaysUsed = alwaysUsedFileSet.has(file.path);
    graphInputs.push({
      fileId: file,
      parsed: parsedModule,
      resolvedImports: resolvedImportMap,
      isEntryPoint:
        isAlwaysUsed || productionEntrySet.has(file.path) || testEntrySet.has(file.path),
      isTestEntry: testEntrySet.has(file.path),
    });
  }

  const discoveredFilePaths = new Set(files.map((file) => file.path));
  const styleFilesToAdd = new Set<string>();

  for (const input of graphInputs) {
    for (const [, resolvedImport] of input.resolvedImports) {
      if (!resolvedImport.resolvedPath || resolvedImport.isExternal) continue;
      if (discoveredFilePaths.has(resolvedImport.resolvedPath)) continue;
      const isStyleFile = STYLE_EXTENSIONS.some((ext) =>
        resolvedImport.resolvedPath!.endsWith(ext),
      );
      if (isStyleFile && existsSync(resolvedImport.resolvedPath)) {
        styleFilesToAdd.add(resolvedImport.resolvedPath);
      }
    }
  }

  const sortedStyleFiles = [...styleFilesToAdd].sort();
  let nextFileIndex = files.length;
  for (const styleFilePath of sortedStyleFiles) {
    const styleSourceFile = { index: nextFileIndex, path: styleFilePath };
    const parsedStyleModule = parseSourceFile(styleFilePath);
    const resolvedStyleImportMap = new Map<
      string,
      ReturnType<typeof moduleResolver.resolveModule>
    >();

    for (const importInfo of parsedStyleModule.imports) {
      let resolvedImport: ReturnType<typeof moduleResolver.resolveModule>;
      try {
        resolvedImport = moduleResolver.resolveModule(importInfo.specifier, styleFilePath);
      } catch (styleResolveError) {
        setupErrors.push(
          new ResolverError({
            severity: "warning",
            message: `moduleResolver.resolveModule threw on style import "${importInfo.specifier}"`,
            path: styleFilePath,
            detail: describeUnknownError(styleResolveError),
          }),
        );
        resolvedImport = { resolvedPath: undefined, isExternal: false, packageName: undefined };
      }
      resolvedStyleImportMap.set(importInfo.specifier, resolvedImport);
      if (resolvedImport.resolvedPath && !discoveredFilePaths.has(resolvedImport.resolvedPath)) {
        const isNestedStyle = STYLE_EXTENSIONS.some((ext) =>
          resolvedImport.resolvedPath!.endsWith(ext),
        );
        if (isNestedStyle && existsSync(resolvedImport.resolvedPath)) {
          styleFilesToAdd.add(resolvedImport.resolvedPath);
        }
      }
    }

    graphInputs.push({
      fileId: styleSourceFile,
      parsed: parsedStyleModule,
      resolvedImports: resolvedStyleImportMap,
      isEntryPoint: false,
      isTestEntry: false,
    });
    discoveredFilePaths.add(styleFilePath);
    nextFileIndex++;
  }

  let moduleGraph: ReturnType<typeof buildDependencyGraph>;
  try {
    moduleGraph = buildDependencyGraph(graphInputs);
  } catch (graphError) {
    setupErrors.push(
      new DetectorError({
        module: "linker",
        severity: "fatal",
        message: "buildDependencyGraph threw",
        detail: describeUnknownError(graphError),
      }),
    );
    return buildEmptyScanResult(setupErrors, performance.now() - pipelineStartTime);
  }

  try {
    resolveReExportChains(moduleGraph);
  } catch (reExportError) {
    setupErrors.push(
      new DetectorError({
        module: "linker",
        message: "resolveReExportChains threw — re-export propagation skipped",
        detail: describeUnknownError(reExportError),
      }),
    );
  }

  try {
    traceReachability(moduleGraph);
  } catch (reachabilityError) {
    setupErrors.push(
      new DetectorError({
        module: "linker",
        message: "traceReachability threw — every module marked reachable to avoid over-reporting",
        detail: describeUnknownError(reachabilityError),
      }),
    );
    for (const module of moduleGraph.modules) module.isReachable = true;
  }

  let analysisResult: ScanResult;
  try {
    analysisResult = generateReport(moduleGraph, config);
  } catch (reportError) {
    setupErrors.push(
      new DetectorError({
        module: "report",
        severity: "fatal",
        message: "generateReport threw at the top level",
        detail: describeUnknownError(reportError),
      }),
    );
    return buildEmptyScanResult(setupErrors, performance.now() - pipelineStartTime);
  }

  if (setupErrors.length > 0) {
    analysisResult.analysisErrors = [...setupErrors, ...analysisResult.analysisErrors];
  }
  analysisResult.analysisTimeMs = performance.now() - pipelineStartTime;

  return analysisResult;
};
