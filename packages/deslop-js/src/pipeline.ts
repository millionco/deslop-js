import { resolve, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import fg from "fast-glob";
import type { DeslopConfig, DependencyGraph, DeslopError } from "./types.js";
import {
  ConfigError,
  DetectorError,
  ResolverError,
  WorkspaceError,
  describeUnknownError,
} from "./errors.js";
import { OUTPUT_DIRECTORIES } from "./constants.js";
import { collectSourceFiles, resolveEntries, getFrameworkExclusions } from "./collect/entries.js";
import { resolveWorkspaces } from "./collect/workspaces.js";
import { parseSourceFile } from "./collect/parse.js";
import { createResolver } from "./resolver/resolve.js";
import { buildDependencyGraph, type ModuleLinkInput } from "./linker/build.js";
import { traceReachability } from "./linker/reachability.js";
import { resolveReExportChains } from "./linker/re-exports.js";
import { findMonorepoRoot } from "./utils/find-monorepo-root.js";
import { basenameFromPath } from "./utils/basename-from-path.js";

const STYLE_EXTENSIONS = [".css", ".scss"];

const REACT_NATIVE_ENABLERS = ["react-native", "expo"];

export interface PipelineOutcome {
  moduleGraph: DependencyGraph | undefined;
  setupErrors: DeslopError[];
  pipelineStartTime: number;
  isFatal: boolean;
}

export const validatePipelineConfig = (config: DeslopConfig): DeslopError | undefined => {
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

/**
 * Dynamic registry pattern: many codebases use a central "schema/registry"
 * module that lists tool/command/page filenames as string literals, then a
 * runner spawns them via `path.resolve(dir, file)` or `import()`. Static
 * analysis can't follow the indirection, so those targets get falsely
 * flagged as unused.
 *
 * Heuristic: if a parsed string literal exactly matches the basename of
 * exactly one file in the project, treat that file as an entry point.
 * Uniqueness guards against false-positives from common names like
 * `index.ts` matching dozens of unrelated files.
 */
const markFilenameRegistryEntries = (moduleGraph: DependencyGraph): void => {
  const basenameToModuleIndex = new Map<string, number | "ambiguous">();
  for (const module of moduleGraph.modules) {
    const basename = basenameFromPath(module.fileId.path);
    const existing = basenameToModuleIndex.get(basename);
    if (existing === undefined) {
      basenameToModuleIndex.set(basename, module.fileId.index);
    } else if (existing !== "ambiguous") {
      basenameToModuleIndex.set(basename, "ambiguous");
    }
  }

  for (const module of moduleGraph.modules) {
    for (const referencedFilename of module.referencedFilenames) {
      const targetIndex = basenameToModuleIndex.get(referencedFilename);
      if (typeof targetIndex !== "number") continue;
      const targetModule = moduleGraph.modules[targetIndex];
      if (!targetModule || targetModule.isEntryPoint) continue;
      if (targetModule.fileId.index === module.fileId.index) continue;
      targetModule.isEntryPoint = true;
    }
  }
};

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

export const runReachabilityPipeline = async (config: DeslopConfig): Promise<PipelineOutcome> => {
  const pipelineStartTime = performance.now();
  const setupErrors: DeslopError[] = [];

  const configValidationError = validatePipelineConfig(config);
  if (configValidationError) {
    return {
      moduleGraph: undefined,
      setupErrors: [configValidationError],
      pipelineStartTime,
      isFatal: true,
    };
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
  const outputDirectoryExclusions = OUTPUT_DIRECTORIES.flatMap((outputDirectory) => [
    `${absoluteRoot}/${outputDirectory}/**`,
    `${absoluteRoot}/**/${outputDirectory}/**`,
  ]);

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
    return { moduleGraph: undefined, setupErrors, pipelineStartTime, isFatal: true };
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
    return { moduleGraph: undefined, setupErrors, pipelineStartTime, isFatal: true };
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

  let moduleGraph: DependencyGraph;
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
    return { moduleGraph: undefined, setupErrors, pipelineStartTime, isFatal: true };
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

  markFilenameRegistryEntries(moduleGraph);

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

  return { moduleGraph, setupErrors, pipelineStartTime, isFatal: false };
};
