import fg from "fast-glob";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { FileId, DeslopConfig } from "../types.js";
import { DEFAULT_EXTENSIONS, DEFAULT_IGNORE_PATTERNS } from "../constants.js";

export const discoverFiles = async (config: DeslopConfig): Promise<FileId[]> => {
  const extensions =
    config.includeExtensions.length > 0
      ? config.includeExtensions
      : DEFAULT_EXTENSIONS;

  const extensionGlob =
    extensions.length === 1
      ? `**/*${extensions[0]}`
      : `**/*{${extensions.join(",")}}`;

  const ignorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...config.ignorePatterns];
  const absoluteRoot = resolve(config.rootDir);

  const files = await fg(extensionGlob, {
    cwd: absoluteRoot,
    absolute: true,
    ignore: ignorePatterns,
    dot: false,
    onlyFiles: true,
  });

  const sortedFiles = files.sort();

  return sortedFiles.map((filePath, fileIndex) => ({
    index: fileIndex,
    path: filePath,
  }));
};

export const discoverEntryPoints = async (config: DeslopConfig): Promise<string[]> => {
  const absoluteRoot = resolve(config.rootDir);

  const entryFiles = await fg(config.entryPatterns, {
    cwd: absoluteRoot,
    absolute: true,
    onlyFiles: true,
  });

  const packageJsonPath = resolve(absoluteRoot, "package.json");
  const packageJsonEntries = await extractPackageJsonEntries(packageJsonPath);

  return [...new Set([...entryFiles, ...packageJsonEntries])];
};

const extractPackageJsonEntries = async (packageJsonPath: string): Promise<string[]> => {
  const entries: string[] = [];

  try {
    const content = await readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);
    const rootDir = packageJsonPath.replace(/\/package\.json$/, "");

    const entryFields = ["main", "module", "browser", "types", "typings"];
    for (const field of entryFields) {
      if (typeof packageJson[field] === "string") {
        entries.push(resolve(rootDir, packageJson[field]));
      }
    }

    if (packageJson.exports) {
      collectExportPaths(packageJson.exports, rootDir, entries);
    }

    if (packageJson.bin) {
      if (typeof packageJson.bin === "string") {
        entries.push(resolve(rootDir, packageJson.bin));
      } else if (typeof packageJson.bin === "object") {
        for (const binPath of Object.values(packageJson.bin)) {
          if (typeof binPath === "string") {
            entries.push(resolve(rootDir, binPath));
          }
        }
      }
    }
  } catch {
    // package.json not found or invalid — this is expected for some fixtures
  }

  return entries;
};

const collectExportPaths = (
  exportValue: unknown,
  rootDir: string,
  entries: string[],
): void => {
  if (typeof exportValue === "string") {
    entries.push(resolve(rootDir, exportValue));
    return;
  }

  if (typeof exportValue !== "object" || exportValue === null) return;

  for (const nestedValue of Object.values(exportValue)) {
    collectExportPaths(nestedValue, rootDir, entries);
  }
};
