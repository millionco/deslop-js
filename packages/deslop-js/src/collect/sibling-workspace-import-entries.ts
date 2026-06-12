import fg from "fast-glob";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { findMonorepoRoot } from "../utils/find-monorepo-root.js";
import { resolveWorkspaces } from "./workspaces.js";
import { resolveEntryWithExtensions } from "../utils/resolve-entry-with-extensions.js";
import { resolveSourcePath } from "../resolver/source-path.js";

const IMPORT_SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"'\n]+)["']/g;

const SIBLING_SOURCE_GLOB = "**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}";

const SIBLING_IGNORE_PATTERNS = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"];

const readPackageName = (directory: string): string | undefined => {
  try {
    const content = readFileSync(join(directory, "package.json"), "utf-8");
    const packageJson = JSON.parse(content);
    return typeof packageJson.name === "string" ? packageJson.name : undefined;
  } catch {
    return undefined;
  }
};

const readPackageExports = (directory: string): Record<string, unknown> | undefined => {
  try {
    const content = readFileSync(join(directory, "package.json"), "utf-8");
    const packageJson = JSON.parse(content);
    return typeof packageJson.exports === "object" && packageJson.exports !== null
      ? packageJson.exports
      : undefined;
  } catch {
    return undefined;
  }
};

const resolveExportTarget = (exportValue: unknown): string | undefined => {
  if (typeof exportValue === "string") return exportValue;
  if (typeof exportValue !== "object" || exportValue === null) return undefined;
  const conditions = exportValue as Record<string, unknown>;
  const conditionValue =
    conditions["import"] ?? conditions["require"] ?? conditions["default"] ?? conditions["types"];
  return typeof conditionValue === "string" ? conditionValue : undefined;
};

const resolveSubpathToFile = (packageDirectory: string, subpath: string): string | undefined => {
  const packageExports = readPackageExports(packageDirectory);
  if (packageExports) {
    const exportTarget = resolveExportTarget(packageExports[`./${subpath}`]);
    if (exportTarget) {
      const targetPath = join(packageDirectory, exportTarget);
      const resolvedTarget =
        resolveEntryWithExtensions(targetPath) ?? resolveSourcePath(targetPath, packageDirectory);
      if (resolvedTarget) return resolvedTarget;
    }
  }

  const directCandidates = [
    join(packageDirectory, subpath),
    join(packageDirectory, "src", subpath),
  ];
  for (const directCandidate of directCandidates) {
    const resolvedCandidate =
      resolveEntryWithExtensions(directCandidate) ??
      resolveSourcePath(directCandidate, packageDirectory);
    if (resolvedCandidate) return resolvedCandidate;
  }

  return undefined;
};

const extractImportSpecifiers = (sourceText: string): string[] => {
  const specifiers: string[] = [];
  for (const specifierMatch of sourceText.matchAll(IMPORT_SPECIFIER_PATTERN)) {
    specifiers.push(specifierMatch[1]);
  }
  return specifiers;
};

export const extractSiblingWorkspaceImportEntries = (absoluteRoot: string): string[] => {
  const monorepoRoot = findMonorepoRoot(absoluteRoot);
  if (!monorepoRoot || monorepoRoot === absoluteRoot) return [];

  const packageName = readPackageName(absoluteRoot);
  if (!packageName) return [];

  const siblingDirectories = resolveWorkspaces(monorepoRoot)
    .packages.map((workspacePackage) => workspacePackage.directory)
    .filter(
      (workspaceDirectory) =>
        workspaceDirectory !== absoluteRoot &&
        !workspaceDirectory.startsWith(`${absoluteRoot}/`) &&
        !absoluteRoot.startsWith(`${workspaceDirectory}/`),
    );
  if (siblingDirectories.length === 0) return [];

  const importedEntries: string[] = [];
  for (const siblingDirectory of siblingDirectories) {
    const siblingSourceFiles = fg.sync(SIBLING_SOURCE_GLOB, {
      cwd: siblingDirectory,
      absolute: true,
      onlyFiles: true,
      ignore: SIBLING_IGNORE_PATTERNS,
    });

    for (const siblingSourceFile of siblingSourceFiles) {
      let sourceText: string;
      try {
        sourceText = readFileSync(siblingSourceFile, "utf-8");
      } catch {
        continue;
      }
      if (!sourceText.includes(packageName)) continue;

      for (const importSpecifier of extractImportSpecifiers(sourceText)) {
        if (importSpecifier !== packageName && !importSpecifier.startsWith(`${packageName}/`)) {
          continue;
        }
        const subpath = importSpecifier.slice(packageName.length + 1);
        if (!subpath) continue;
        const resolvedEntry = resolveSubpathToFile(absoluteRoot, subpath);
        if (resolvedEntry) {
          importedEntries.push(resolvedEntry);
        }
      }
    }
  }

  return [...new Set(importedEntries)];
};
