import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import type {
  DependencyGraph,
  DeslopConfig,
  MisclassifiedDependency,
  SourceModule,
} from "../types.js";
import { SEMANTIC_TRACE_MAX_ENTRIES } from "../constants.js";
import { extractPackageName } from "../utils/package-name.js";

interface ImportSummary {
  totalImports: number;
  typeOnlyImports: number;
  valueImports: number;
  importerPaths: Set<string>;
}

const isTypeOnlyImport = (module: SourceModule, packageName: string): boolean[] => {
  const results: boolean[] = [];
  for (const importInfo of module.imports) {
    const resolvedPackage = extractPackageName(importInfo.specifier);
    if (resolvedPackage !== packageName) continue;
    if (importInfo.isTypeOnly) {
      results.push(true);
      continue;
    }
    const everyBindingIsTypeOnly =
      importInfo.importedNames.length > 0 &&
      importInfo.importedNames.every((binding) => binding.isTypeOnly);
    results.push(everyBindingIsTypeOnly);
  }
  return results;
};

const summarizeImports = (graph: DependencyGraph, packageName: string): ImportSummary => {
  const summary: ImportSummary = {
    totalImports: 0,
    typeOnlyImports: 0,
    valueImports: 0,
    importerPaths: new Set(),
  };
  for (const module of graph.modules) {
    const decisions = isTypeOnlyImport(module, packageName);
    if (decisions.length === 0) continue;
    summary.importerPaths.add(module.fileId.path);
    for (const isTypeOnly of decisions) {
      summary.totalImports += 1;
      if (isTypeOnly) summary.typeOnlyImports += 1;
      else summary.valueImports += 1;
    }
  }
  return summary;
};

export const detectMisclassifiedDependencies = (
  graph: DependencyGraph,
  config: DeslopConfig,
): MisclassifiedDependency[] => {
  if (!config.semantic.enabled) return [];
  if (!config.semantic.reportMisclassifiedDependencies) return [];

  const packageJsonPath = resolve(config.rootDir, "package.json");
  let packageJson: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    packageJson = JSON.parse(content);
  } catch {
    return [];
  }

  const declaredProdDependencies = Object.keys(packageJson.dependencies ?? {});
  if (declaredProdDependencies.length === 0) return [];

  const findings: MisclassifiedDependency[] = [];
  for (const dependencyName of declaredProdDependencies) {
    if (dependencyName.startsWith("@types/")) continue;
    const summary = summarizeImports(graph, dependencyName);
    if (summary.totalImports === 0) continue;
    if (summary.valueImports > 0) continue;

    findings.push({
      name: dependencyName,
      declaredAs: "dependency",
      recommended: "devDependency",
      confidence: summary.typeOnlyImports >= 2 ? "high" : "medium",
      reason:
        `\`${dependencyName}\` is declared in dependencies but only imported as types ` +
        `(${summary.typeOnlyImports} type-only import${summary.typeOnlyImports === 1 ? "" : "s"})`,
      trace: [
        `${summary.totalImports} total import sites`,
        `${summary.typeOnlyImports} type-only, ${summary.valueImports} value`,
        `importers: ${[...summary.importerPaths].slice(0, 3).join(" | ")}`,
      ].slice(0, SEMANTIC_TRACE_MAX_ENTRIES),
    });
  }

  return findings;
};
