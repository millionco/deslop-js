import fg from "fast-glob";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { findMonorepoRoot } from "../utils/find-monorepo-root.js";
import { resolveWorkspaces } from "./workspaces.js";
import { resolveEntryWithExtensions } from "../utils/resolve-entry-with-extensions.js";
import { resolveSourcePath } from "../resolver/source-path.js";

interface SiblingPackageManifest {
  name?: string;
  exports?: Record<string, unknown>;
}

const IMPORT_SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"'\n]+)["']/g;

const SIBLING_SOURCE_GLOB = "**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}";

const SIBLING_IGNORE_PATTERNS = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readPackageManifest = (directory: string): SiblingPackageManifest => {
  try {
    const content = readFileSync(join(directory, "package.json"), "utf-8");
    const packageJson: unknown = JSON.parse(content);
    if (!isRecord(packageJson)) return {};
    return {
      name: typeof packageJson.name === "string" ? packageJson.name : undefined,
      exports: isRecord(packageJson.exports) ? packageJson.exports : undefined,
    };
  } catch {
    return {};
  }
};

const EXPORT_CONDITION_PRIORITY = ["import", "require", "default", "types"];

const resolveExportTarget = (exportValue: unknown): string | undefined => {
  if (typeof exportValue === "string") return exportValue;
  if (!isRecord(exportValue)) return undefined;
  for (const condition of EXPORT_CONDITION_PRIORITY) {
    const conditionTarget = resolveExportTarget(exportValue[condition]);
    if (conditionTarget) return conditionTarget;
  }
  return undefined;
};

const matchWildcardExportTarget = (
  packageExports: Record<string, unknown>,
  subpath: string,
): string | undefined => {
  const wildcardKeys = Object.keys(packageExports)
    .filter((exportKey) => exportKey.startsWith("./") && exportKey.includes("*"))
    .sort((leftKey, rightKey) => rightKey.indexOf("*") - leftKey.indexOf("*"));

  for (const exportKey of wildcardKeys) {
    const keyPattern = exportKey.slice(2);
    const wildcardIndex = keyPattern.indexOf("*");
    const keyPrefix = keyPattern.slice(0, wildcardIndex);
    const keySuffix = keyPattern.slice(wildcardIndex + 1);
    const isPatternMatch =
      subpath.length >= keyPrefix.length + keySuffix.length &&
      subpath.startsWith(keyPrefix) &&
      subpath.endsWith(keySuffix);
    if (!isPatternMatch) continue;

    const exportTarget = resolveExportTarget(packageExports[exportKey]);
    if (!exportTarget) continue;

    const wildcardValue = subpath.slice(keyPrefix.length, subpath.length - keySuffix.length);
    return exportTarget.split("*").join(wildcardValue);
  }

  return undefined;
};

const resolveSubpathToFile = (
  packageDirectory: string,
  packageExports: Record<string, unknown> | undefined,
  subpath: string,
): string | undefined => {
  if (packageExports) {
    const exportTarget =
      resolveExportTarget(packageExports[`./${subpath}`]) ??
      matchWildcardExportTarget(packageExports, subpath);
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

  const { name: packageName, exports: packageExports } = readPackageManifest(absoluteRoot);
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
        const resolvedEntry = resolveSubpathToFile(absoluteRoot, packageExports, subpath);
        if (resolvedEntry) {
          importedEntries.push(resolvedEntry);
        }
      }
    }
  }

  return [...new Set(importedEntries)];
};
