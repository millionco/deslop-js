import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import fg from "fast-glob";
import type { DeslopConfig, AnalysisResult } from "./types.js";
import { DEFAULT_ENTRY_PATTERNS, DEFAULT_EXTENSIONS } from "./constants.js";
import { discoverFiles, discoverEntryPoints, discoverFrameworkIgnorePatterns } from "./scanner/discover.js";
import { discoverWorkspacePackagesWithExclusions } from "./scanner/workspaces.js";
import { parseModule } from "./scanner/parse.js";
import { createModuleResolver } from "./resolver/resolve.js";
import { buildModuleGraph } from "./graph/build.js";
import type { GraphBuildInput } from "./graph/build.js";
import { markReachable } from "./graph/reachability.js";
import { propagateReExports } from "./graph/re-exports.js";
import { analyzeGraph } from "./analyzer/analyze.js";

const STYLE_EXTENSIONS = [".css", ".scss"];

export type { AnalysisResult, DeslopConfig, UnusedFile, UnusedExport, UnusedDependency } from "./types.js";

export const createConfig = (
  options: Partial<DeslopConfig> & { rootDir: string },
): DeslopConfig => ({
  rootDir: resolve(options.rootDir),
  entryPatterns: options.entryPatterns ?? DEFAULT_ENTRY_PATTERNS,
  ignorePatterns: options.ignorePatterns ?? [],
  includeExtensions: options.includeExtensions ?? DEFAULT_EXTENSIONS,
  tsConfigPath: options.tsConfigPath ?? undefined,
  reportTypes: options.reportTypes ?? false,
  includeEntryExports: options.includeEntryExports ?? false,
});

export const analyze = async (config: DeslopConfig): Promise<AnalysisResult> => {
  const pipelineStartTime = performance.now();

  const workspaceDiscovery = discoverWorkspacePackagesWithExclusions(resolve(config.rootDir));
  const workspacePackages = workspaceDiscovery.packages;

  const frameworkIgnorePatterns = discoverFrameworkIgnorePatterns(config.rootDir);

  const allExclusionPatterns = [
    ...workspaceDiscovery.excludedDirectories.map((directory) => `${directory}/**`),
    ...frameworkIgnorePatterns,
  ];

  const configWithExclusions = allExclusionPatterns.length > 0
    ? {
        ...config,
        ignorePatterns: [
          ...config.ignorePatterns,
          ...allExclusionPatterns,
        ],
      }
    : config;

  const files = await discoverFiles(configWithExclusions);
  const entryPoints = await discoverEntryPoints(configWithExclusions);
  const entryPointSet = new Set(entryPoints);
  const moduleResolver = createModuleResolver(config, workspacePackages.map((workspacePackage) => ({
    name: workspacePackage.name,
    directory: workspacePackage.directory,
  })));
  const graphInputs: GraphBuildInput[] = [];

  for (const file of files) {
    const parsedModule = parseModule(file.path);
    const resolvedImportMap = new Map<
      string,
      ReturnType<typeof moduleResolver.resolveModule>
    >();

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
      const resolvedImport = moduleResolver.resolveModule(
        importInfo.specifier,
        file.path,
      );
      resolvedImportMap.set(importInfo.specifier, resolvedImport);
    }

    for (const exportInfo of parsedModule.exports) {
      if (exportInfo.isReExport && exportInfo.reExportSource) {
        if (!resolvedImportMap.has(exportInfo.reExportSource)) {
          const resolvedImport = moduleResolver.resolveModule(
            exportInfo.reExportSource,
            file.path,
          );
          resolvedImportMap.set(exportInfo.reExportSource, resolvedImport);
        }
      }
    }

    graphInputs.push({
      fileId: file,
      parsed: parsedModule,
      resolvedImports: resolvedImportMap,
      isEntryPoint: entryPointSet.has(file.path),
    });
  }

  const discoveredFilePaths = new Set(files.map((file) => file.path));
  const styleFilesToAdd = new Set<string>();

  for (const input of graphInputs) {
    for (const [, resolvedImport] of input.resolvedImports) {
      if (!resolvedImport.resolvedPath || resolvedImport.isExternal) continue;
      if (discoveredFilePaths.has(resolvedImport.resolvedPath)) continue;
      const isStyleFile = STYLE_EXTENSIONS.some((ext) => resolvedImport.resolvedPath!.endsWith(ext));
      if (isStyleFile && existsSync(resolvedImport.resolvedPath)) {
        styleFilesToAdd.add(resolvedImport.resolvedPath);
      }
    }
  }

  const sortedStyleFiles = [...styleFilesToAdd].sort();
  let nextFileIndex = files.length;
  for (const styleFilePath of sortedStyleFiles) {
    const styleFileId = { index: nextFileIndex, path: styleFilePath };
    const parsedStyleModule = parseModule(styleFilePath);
    const resolvedStyleImportMap = new Map<string, ReturnType<typeof moduleResolver.resolveModule>>();

    for (const importInfo of parsedStyleModule.imports) {
      const resolvedImport = moduleResolver.resolveModule(importInfo.specifier, styleFilePath);
      resolvedStyleImportMap.set(importInfo.specifier, resolvedImport);
      if (resolvedImport.resolvedPath && !discoveredFilePaths.has(resolvedImport.resolvedPath)) {
        const isNestedStyle = STYLE_EXTENSIONS.some((ext) => resolvedImport.resolvedPath!.endsWith(ext));
        if (isNestedStyle && existsSync(resolvedImport.resolvedPath)) {
          styleFilesToAdd.add(resolvedImport.resolvedPath);
        }
      }
    }

    graphInputs.push({
      fileId: styleFileId,
      parsed: parsedStyleModule,
      resolvedImports: resolvedStyleImportMap,
      isEntryPoint: false,
    });
    discoveredFilePaths.add(styleFilePath);
    nextFileIndex++;
  }

  const moduleGraph = buildModuleGraph(graphInputs);

  propagateReExports(moduleGraph);

  markReachable(moduleGraph);

  const analysisResult = analyzeGraph(moduleGraph, config);

  analysisResult.analysisTimeMs = performance.now() - pipelineStartTime;

  return analysisResult;
};
