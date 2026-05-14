import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import type { ModuleGraph, UnusedDependency, DeslopConfig } from "../types.js";
import { ALWAYS_USED_PACKAGES } from "../constants.js";
import { extractPackageName } from "../utils/package-name.js";

export const findUnusedDependencies = (
  graph: ModuleGraph,
  config: DeslopConfig,
): UnusedDependency[] => {
  const packageJsonPath = resolve(config.rootDir, "package.json");
  let packageJson: Record<string, unknown>;

  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    packageJson = JSON.parse(content);
  } catch {
    return [];
  }

  const dependencies = (packageJson.dependencies ?? {}) as Record<string, string>;
  const devDependencies = (packageJson.devDependencies ?? {}) as Record<string, string>;

  const declaredDependencies = new Map<string, boolean>();
  for (const dependencyName of Object.keys(dependencies)) {
    declaredDependencies.set(dependencyName, false);
  }
  for (const dependencyName of Object.keys(devDependencies)) {
    declaredDependencies.set(dependencyName, true);
  }

  const usedPackageNames = collectUsedPackages(graph);
  const unusedDependencies: UnusedDependency[] = [];

  for (const [dependencyName, isDevDependency] of declaredDependencies) {
    if (isAlwaysConsideredUsed(dependencyName)) continue;

    if (!usedPackageNames.has(dependencyName)) {
      unusedDependencies.push({
        name: dependencyName,
        isDevDependency,
      });
    }
  }

  return unusedDependencies;
};

const collectUsedPackages = (graph: ModuleGraph): Set<string> => {
  const usedPackages = new Set<string>();

  for (const module of graph.modules) {
    for (const importInfo of module.imports) {
      const packageName = extractPackageName(importInfo.specifier);
      if (packageName) {
        usedPackages.add(packageName);
      }
    }
  }

  return usedPackages;
};

const isAlwaysConsideredUsed = (dependencyName: string): boolean => {
  if (ALWAYS_USED_PACKAGES.has(dependencyName)) return true;
  if (dependencyName.startsWith("@types/")) return true;
  if (dependencyName.startsWith("eslint-config-")) return true;
  if (dependencyName.startsWith("eslint-plugin-")) return true;
  if (dependencyName.startsWith("prettier-plugin-")) return true;
  return false;
};
