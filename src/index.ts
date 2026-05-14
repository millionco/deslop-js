import { resolve } from "node:path";
import type { DeslopConfig, AnalysisResult } from "./types.js";
import { DEFAULT_ENTRY_PATTERNS, DEFAULT_EXTENSIONS } from "./constants.js";
import { discoverFiles, discoverEntryPoints } from "./scanner/discover.js";
import { parseModule } from "./scanner/parse.js";
import { createModuleResolver } from "./resolver/resolve.js";
import { buildModuleGraph } from "./graph/build.js";
import type { GraphBuildInput } from "./graph/build.js";
import { markReachable } from "./graph/reachability.js";
import { propagateReExports } from "./graph/re-exports.js";
import { analyzeGraph } from "./analyzer/analyze.js";

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

  const files = await discoverFiles(config);
  const entryPoints = await discoverEntryPoints(config);
  const entryPointSet = new Set(entryPoints);

  const moduleResolver = createModuleResolver(config);
  const graphInputs: GraphBuildInput[] = [];

  for (const file of files) {
    const parsedModule = parseModule(file.path);
    const resolvedImportMap = new Map<
      string,
      ReturnType<typeof moduleResolver.resolveModule>
    >();

    for (const importInfo of parsedModule.imports) {
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

  const moduleGraph = buildModuleGraph(graphInputs);

  propagateReExports(moduleGraph);

  markReachable(moduleGraph);

  const analysisResult = analyzeGraph(moduleGraph, config);

  analysisResult.analysisTimeMs = performance.now() - pipelineStartTime;

  return analysisResult;
};
