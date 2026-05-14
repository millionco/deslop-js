import fg from "fast-glob";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import type { FileId, DeslopConfig } from "../types.js";
import { DEFAULT_EXTENSIONS, DEFAULT_IGNORE_PATTERNS, TEST_FILE_PATTERNS, SCRIPT_FILE_PATTERN, SCRIPT_ENTRY_PATTERNS } from "../constants.js";
import { discoverWorkspacePackages, discoverFrameworkEntryPoints } from "./workspaces.js";

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

  const workspacePackages = discoverWorkspacePackages(absoluteRoot);
  const workspaceEntries: string[] = [];
  for (const workspacePackage of workspacePackages) {
    workspaceEntries.push(...workspacePackage.entryFiles);

    const workspaceFrameworkEntries = discoverFrameworkEntryPoints(workspacePackage.directory);
    workspaceEntries.push(...workspaceFrameworkEntries);
  }

  const frameworkEntries = discoverFrameworkEntryPoints(absoluteRoot);

  const scriptEntries = extractScriptEntries(absoluteRoot);
  for (const workspacePackage of workspacePackages) {
    scriptEntries.push(...extractScriptEntries(workspacePackage.directory));
  }

  const scriptPatternFiles = await fg(SCRIPT_ENTRY_PATTERNS, {
    cwd: absoluteRoot,
    absolute: true,
    onlyFiles: true,
    ignore: [...DEFAULT_IGNORE_PATTERNS],
  });

  const testEntryFiles = await fg(TEST_FILE_PATTERNS, {
    cwd: absoluteRoot,
    absolute: true,
    onlyFiles: true,
    ignore: [...DEFAULT_IGNORE_PATTERNS],
  });

  return [...new Set([...entryFiles, ...packageJsonEntries, ...workspaceEntries, ...frameworkEntries, ...scriptEntries, ...scriptPatternFiles, ...testEntryFiles])];
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

  }

  return entries;
};

const extractScriptEntries = (directory: string): string[] => {
  const packageJsonPath = resolve(directory, "package.json");
  if (!existsSync(packageJsonPath)) return [];

  const entries: string[] = [];
  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);
    const scripts = packageJson.scripts;
    if (!scripts || typeof scripts !== "object") return entries;

    for (const scriptCommand of Object.values(scripts)) {
      if (typeof scriptCommand !== "string") continue;

      const match = scriptCommand.match(SCRIPT_FILE_PATTERN);
      if (match?.[1]) {
        const scriptFilePath = resolve(directory, match[1]);
        if (existsSync(scriptFilePath)) {
          entries.push(scriptFilePath);
        }
      }
    }
  } catch {

  }

  return entries;
};

const collectExportPaths = (
  exportValue: unknown,
  rootDir: string,
  entries: string[],
): void => {
  if (typeof exportValue === "string") {
    if (exportValue.includes("*")) {
      const globPattern = exportValue.replace(/^\.\/?/, "");
      try {
        const expandedFiles = fg.sync(globPattern, {
          cwd: rootDir,
          absolute: true,
          onlyFiles: true,
          ignore: ["**/node_modules/**"],
        });
        entries.push(...expandedFiles);
      } catch {
        entries.push(resolve(rootDir, exportValue));
      }
    } else {
      entries.push(resolve(rootDir, exportValue));
    }
    return;
  }

  if (typeof exportValue !== "object" || exportValue === null) return;

  for (const nestedValue of Object.values(exportValue)) {
    collectExportPaths(nestedValue, rootDir, entries);
  }
};
