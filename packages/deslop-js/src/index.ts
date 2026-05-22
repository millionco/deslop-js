import { resolve, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import fg from "fast-glob";
import type { DeslopConfig, ScanResult } from "./types.js";
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
import { buildDependencyGraph } from "./linker/build.js";
import type { ModuleLinkInput } from "./linker/build.js";
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
  UnusedEnumMember,
  UnusedClassMember,
  RedundantExport,
} from "./types.js";
import type { SemanticConfig } from "./types.js";
export type { SemanticConfig };

const DEFAULT_SEMANTIC_CONFIG: SemanticConfig = {
  enabled: false,
  reportUnusedTypes: true,
  reportUnusedEnumMembers: false,
  reportUnusedClassMembers: false,
  reportRedundantExports: false,
  reportPrivateTypeLeaks: false,
  decoratorAllowlist: DEFAULT_SEMANTIC_DECORATOR_ALLOWLIST,
};

const resolveSemanticConfig = (override: Partial<SemanticConfig> | undefined): SemanticConfig => ({
  ...DEFAULT_SEMANTIC_CONFIG,
  ...(override ?? {}),
  decoratorAllowlist: override?.decoratorAllowlist ?? DEFAULT_SEMANTIC_CONFIG.decoratorAllowlist,
});

export interface DefineConfigOptions {
  rootDir: string;
  entryPatterns?: string[];
  ignorePatterns?: string[];
  includeExtensions?: string[];
  tsConfigPath?: string;
  reportTypes?: boolean;
  includeEntryExports?: boolean;
  semantic?: Partial<SemanticConfig>;
}

export const defineConfig = (options: DefineConfigOptions): DeslopConfig => ({
  rootDir: resolve(options.rootDir),
  entryPatterns: options.entryPatterns ?? DEFAULT_ENTRY_GLOBS,
  ignorePatterns: options.ignorePatterns ?? [],
  includeExtensions: options.includeExtensions ?? DEFAULT_EXTENSIONS,
  tsConfigPath: options.tsConfigPath ?? undefined,
  reportTypes: options.reportTypes ?? false,
  includeEntryExports: options.includeEntryExports ?? false,
  semantic: resolveSemanticConfig(options.semantic),
});

export const analyze = async (config: DeslopConfig): Promise<ScanResult> => {
  const pipelineStartTime = performance.now();

  const workspaceDiscovery = resolveWorkspaces(resolve(config.rootDir));
  const workspacePackages = [...workspaceDiscovery.packages];

  const monorepoRoot = findMonorepoRoot(config.rootDir);
  if (monorepoRoot) {
    const monorepoWorkspaces = resolveWorkspaces(monorepoRoot);
    const existingDirectories = new Set(
      workspacePackages.map((workspacePackage) => workspacePackage.directory),
    );
    for (const monorepoPackage of monorepoWorkspaces.packages) {
      if (!existingDirectories.has(monorepoPackage.directory)) {
        workspacePackages.push(monorepoPackage);
      }
    }
  }

  const frameworkIgnorePatterns = getFrameworkExclusions(config.rootDir);

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

  const files = await collectSourceFiles(configWithExclusions);
  const discoveredEntries = await resolveEntries(configWithExclusions);
  const productionEntrySet = new Set(discoveredEntries.productionEntries);
  const testEntrySet = new Set(discoveredEntries.testEntries);
  const alwaysUsedFileSet = new Set(discoveredEntries.alwaysUsedFiles);
  const hasReactNative = detectReactNative(config.rootDir, workspacePackages);
  const moduleResolver = createResolver(
    config,
    workspacePackages.map((workspacePackage) => ({
      name: workspacePackage.name,
      directory: workspacePackage.directory,
    })),
    { hasReactNative, monorepoRoot },
  );
  const graphInputs: ModuleLinkInput[] = [];

  for (const file of files) {
    const parsedModule = parseSourceFile(file.path);
    const resolvedImportMap = new Map<string, ReturnType<typeof moduleResolver.resolveModule>>();

    for (const importInfo of parsedModule.imports) {
      if (importInfo.isGlob) {
        const fileDir = dirname(file.path);
        const expandedFiles = fg.sync(importInfo.specifier, {
          cwd: fileDir,
          absolute: true,
          onlyFiles: true,
          ignore: ["**/node_modules/**"],
        });
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
      const resolvedImport = moduleResolver.resolveModule(importInfo.specifier, file.path);
      resolvedImportMap.set(importInfo.specifier, resolvedImport);
    }

    for (const exportInfo of parsedModule.exports) {
      if (exportInfo.isReExport && exportInfo.reExportSource) {
        if (!resolvedImportMap.has(exportInfo.reExportSource)) {
          const resolvedImport = moduleResolver.resolveModule(exportInfo.reExportSource, file.path);
          resolvedImportMap.set(exportInfo.reExportSource, resolvedImport);
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
      const resolvedImport = moduleResolver.resolveModule(importInfo.specifier, styleFilePath);
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

  const moduleGraph = buildDependencyGraph(graphInputs);

  resolveReExportChains(moduleGraph);

  traceReachability(moduleGraph);

  const analysisResult = generateReport(moduleGraph, config);

  analysisResult.analysisTimeMs = performance.now() - pipelineStartTime;

  return analysisResult;
};
