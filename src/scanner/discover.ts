import fg from "fast-glob";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import type { FileId, DeslopConfig } from "../types.js";
import { DEFAULT_EXTENSIONS, DEFAULT_IGNORE_PATTERNS, HIDDEN_DIRECTORY_ALLOWLIST, SCRIPT_FILE_PATTERN, SCRIPT_ENTRY_PATTERNS } from "../constants.js";
import { discoverWorkspacePackages, discoverFrameworkEntryPoints } from "./workspaces.js";
import type { WorkspacePackage } from "./workspaces.js";
import { join } from "node:path";

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

  const mainFiles = await fg(extensionGlob, {
    cwd: absoluteRoot,
    absolute: true,
    ignore: ignorePatterns,
    dot: false,
    onlyFiles: true,
  });

  const allowedHiddenGlobs = HIDDEN_DIRECTORY_ALLOWLIST.map(
    (directory) => `${directory}/**/*{${extensions.join(",")}}`,
  );
  const hiddenFiles = allowedHiddenGlobs.length > 0
    ? await fg(allowedHiddenGlobs, {
        cwd: absoluteRoot,
        absolute: true,
        ignore: ignorePatterns,
        dot: true,
        onlyFiles: true,
      })
    : [];

  const files = [...mainFiles, ...hiddenFiles];

  const sortedFiles = files.sort();

  return sortedFiles.map((filePath, fileIndex) => ({
    index: fileIndex,
    path: filePath,
  }));
};

export const discoverEntryPoints = async (config: DeslopConfig): Promise<string[]> => {
  const absoluteRoot = resolve(config.rootDir);

  const entryFiles = config.entryPatterns.length > 0
    ? await fg(config.entryPatterns, {
        cwd: absoluteRoot,
        absolute: true,
        onlyFiles: true,
      })
    : [];

  const packageJsonPath = resolve(absoluteRoot, "package.json");
  const packageJsonEntries = await extractPackageJsonEntries(packageJsonPath);

  const workspacePackages = discoverWorkspacePackages(absoluteRoot);
  const hasDeclaredWorkspaces = workspacePackages.some((workspacePackage) => workspacePackage.isDeclaredWorkspace);
  const workspaceEntries: string[] = [];
  for (const workspacePackage of workspacePackages) {
    workspaceEntries.push(...workspacePackage.entryFiles);

    const shouldRunFrameworkDetection = hasDeclaredWorkspaces ? workspacePackage.isDeclaredWorkspace : true;
    if (shouldRunFrameworkDetection) {
      const workspaceFrameworkEntries = discoverFrameworkEntryPoints(workspacePackage.directory);
      workspaceEntries.push(...workspaceFrameworkEntries);
    }
  }

  const frameworkEntries = discoverFrameworkEntryPoints(absoluteRoot);

  const scriptEntries = extractScriptEntries(absoluteRoot);
  for (const workspacePackage of workspacePackages) {
    scriptEntries.push(...extractScriptEntries(workspacePackage.directory));
  }

  const webpackEntries = extractWebpackEntryPoints(absoluteRoot);
  for (const workspacePackage of workspacePackages) {
    webpackEntries.push(...extractWebpackEntryPoints(workspacePackage.directory));
  }

  const htmlScriptEntries = extractHtmlScriptEntries(absoluteRoot);
  for (const workspacePackage of workspacePackages) {
    htmlScriptEntries.push(...extractHtmlScriptEntries(workspacePackage.directory));
  }

  const testEntryFiles = discoverTestRunnerEntryPoints(absoluteRoot, workspacePackages);

  return [...new Set([...entryFiles, ...packageJsonEntries, ...workspaceEntries, ...frameworkEntries, ...scriptEntries, ...webpackEntries, ...htmlScriptEntries, ...testEntryFiles])];
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
    if (scripts && typeof scripts === "object") {
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
    }
  } catch {

  }

  const scriptDirectoryFiles = fg.sync(SCRIPT_ENTRY_PATTERNS, {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
  });
  entries.push(...scriptDirectoryFiles);

  return entries;
};

const WEBPACK_ENTRY_PATTERN = /entry\s*:\s*\{[^}]*\}/gs;
const WEBPACK_ENTRY_VALUE_PATTERN = /['"]([^'"]+\.(?:js|ts|tsx|jsx))['"]/g;

const extractWebpackEntryPoints = (directory: string): string[] => {
  const entries: string[] = [];
  const webpackConfigPaths = fg.sync("webpack.config.{js,ts,mjs,cjs}", {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
  });

  for (const configPath of webpackConfigPaths) {
    try {
      const content = readFileSync(configPath, "utf-8");
      let entryMatch: RegExpExecArray | null;
      WEBPACK_ENTRY_PATTERN.lastIndex = 0;
      while ((entryMatch = WEBPACK_ENTRY_PATTERN.exec(content)) !== null) {
        const entryBlock = entryMatch[0];
        let valueMatch: RegExpExecArray | null;
        WEBPACK_ENTRY_VALUE_PATTERN.lastIndex = 0;
        while ((valueMatch = WEBPACK_ENTRY_VALUE_PATTERN.exec(entryBlock)) !== null) {
          const entryPath = valueMatch[1];
          if (entryPath.startsWith("./") || entryPath.startsWith("../") || !entryPath.startsWith("/")) {
            const absoluteEntryPath = resolve(directory, entryPath);
            if (existsSync(absoluteEntryPath)) {
              entries.push(absoluteEntryPath);
            }
          }
        }
      }
    } catch {
    }
  }

  return entries;
};

const HTML_SCRIPT_SRC_PATTERN = /<script[^>]+src=["']([^"']+\.(?:ts|tsx|js|jsx|mts|mjs))["'][^>]*>/gi;

const extractHtmlScriptEntries = (directory: string): string[] => {
  const entries: string[] = [];
  const htmlFiles = fg.sync(["index.html", "**/index.html", "*.html"], {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    deep: 3,
  });

  for (const htmlPath of htmlFiles) {
    try {
      const content = readFileSync(htmlPath, "utf-8");
      let scriptMatch: RegExpExecArray | null;
      HTML_SCRIPT_SRC_PATTERN.lastIndex = 0;
      while ((scriptMatch = HTML_SCRIPT_SRC_PATTERN.exec(content)) !== null) {
        const scriptSrc = scriptMatch[1];
        const htmlDirectory = htmlPath.replace(/\/[^/]+$/, "");
        const absoluteScriptPath = resolve(htmlDirectory, scriptSrc);
        if (existsSync(absoluteScriptPath)) {
          entries.push(absoluteScriptPath);
        }
      }
    } catch {
    }
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

interface TestRunnerDefinition {
  enablers: string[];
  configFileActivators: string[];
  entryPatterns: string[];
  fixturePatterns: string[];
  alwaysUsed: string[];
}

const TEST_RUNNER_DEFINITIONS: TestRunnerDefinition[] = [
  {
    enablers: ["vitest", "@vitest/runner", "vite-plus"],
    configFileActivators: [
      "vitest.config.ts", "vitest.config.js", "vitest.config.mts", "vitest.config.mjs",
      "vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs",
    ],
    entryPatterns: [
      "**/*.test.{ts,tsx,js,jsx,mts,mjs}",
      "**/*.spec.{ts,tsx,js,jsx,mts,mjs}",
      "**/*-spec.{ts,tsx,js,jsx,mts,mjs}",
      "**/*_spec.{ts,tsx,js,jsx,mts,mjs}",
      "**/__tests__/**/*.{ts,tsx,js,jsx,mts,mjs}",
      "**/*.bench.{ts,tsx,js,jsx}",
    ],
    fixturePatterns: [
      "**/__fixtures__/**/*.{ts,tsx,js,jsx,json}",
      "**/fixtures/**/*.{ts,tsx,js,jsx,json}",
      "**/__mocks__/**/*.{ts,tsx,js,jsx,mjs,cjs}",
    ],
    alwaysUsed: [
      "vitest.config.{ts,js,mts,mjs}",
      "vitest.setup.{ts,js}",
      "vitest.workspace.{ts,js}",
      "**/setup-vitest.{ts,js}",
      "**/vitest.setup.{ts,js}",
      "**/setupTests.{ts,tsx,js,jsx}",
      "**/src/test-setup.{ts,tsx,js,jsx}",
    ],
  },
  {
    enablers: ["jest", "@jest/core", "ts-jest"],
    configFileActivators: ["jest.config.ts", "jest.config.js", "jest.config.mjs", "jest.config.cjs"],
    entryPatterns: [
      "**/*.test.{ts,tsx,js,jsx,mts,mjs}",
      "**/*.spec.{ts,tsx,js,jsx,mts,mjs}",
      "**/*-spec.{ts,tsx,js,jsx,mts,mjs}",
      "**/*_spec.{ts,tsx,js,jsx,mts,mjs}",
      "**/__tests__/**/*.{ts,tsx,js,jsx,mts,mjs}",
      "**/__mocks__/**/*.{ts,tsx,js,jsx,mjs,cjs}",
    ],
    fixturePatterns: [
      "**/__fixtures__/**/*.{ts,tsx,js,jsx,json}",
      "**/fixtures/**/*.{ts,tsx,js,jsx,json}",
    ],
    alwaysUsed: [
      "jest.config.{ts,js,mjs,cjs}",
      "jest.setup.{ts,js,tsx,jsx}",
    ],
  },
  {
    enablers: ["@playwright/test", "playwright"],
    configFileActivators: ["playwright.config.ts", "playwright.config.js"],
    entryPatterns: [
      "**/*.spec.{ts,tsx,js,jsx}",
      "**/*.test.{ts,tsx,js,jsx}",
      "tests/**/*.{ts,tsx,js,jsx}",
      "e2e/**/*.{ts,tsx,js,jsx}",
    ],
    fixturePatterns: [
      "**/fixtures/**/*.{ts,tsx,js,jsx,json}",
    ],
    alwaysUsed: [
      "playwright.config.{ts,js}",
    ],
  },
  {
    enablers: ["mocha"],
    configFileActivators: [".mocharc.js", ".mocharc.yaml", ".mocharc.yml", ".mocharc.json"],
    entryPatterns: [
      "**/*.test.{ts,tsx,js,jsx}",
      "**/*.spec.{ts,tsx,js,jsx}",
      "test/**/*.{ts,tsx,js,jsx}",
    ],
    fixturePatterns: [],
    alwaysUsed: [
      ".mocharc.*",
    ],
  },
  {
    enablers: ["cypress"],
    configFileActivators: ["cypress.config.ts", "cypress.config.js"],
    entryPatterns: [
      "cypress/**/*.{ts,tsx,js,jsx}",
    ],
    fixturePatterns: [
      "**/fixtures/**/*.{ts,tsx,js,jsx,json}",
    ],
    alwaysUsed: [
      "cypress.config.{ts,js}",
    ],
  },
  {
    enablers: ["bun:test"],
    configFileActivators: [],
    entryPatterns: [
      "**/*.test.{ts,tsx,js,jsx}",
      "**/*.spec.{ts,tsx,js,jsx}",
      "**/__tests__/**/*.{ts,tsx,js,jsx}",
    ],
    fixturePatterns: [
      "**/__fixtures__/**/*.{ts,tsx,js,jsx,json}",
      "**/fixtures/**/*.{ts,tsx,js,jsx,json}",
    ],
    alwaysUsed: [],
  },
];

const detectBunTestRunner = (directory: string): boolean => {
  try {
    const packageJsonPath = join(directory, "package.json");
    if (!existsSync(packageJsonPath)) return false;
    const content = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);
    const scripts = packageJson.scripts ?? {};
    return Object.values(scripts).some(
      (scriptValue) => typeof scriptValue === "string" && /\bbun\s+test\b/.test(scriptValue)
    );
  } catch {
    return false;
  }
};

const discoverTestRunnerEntryPoints = (
  rootDir: string,
  workspacePackages: WorkspacePackage[],
): string[] => {
  const allEntries: string[] = [];
  const directoriesToCheck = [rootDir, ...workspacePackages.map((workspacePackage) => workspacePackage.directory)];

  for (const directory of directoriesToCheck) {
    const packageJsonPath = join(directory, "package.json");
    if (!existsSync(packageJsonPath)) continue;

    let allDependencies: Record<string, string> = {};
    try {
      const content = readFileSync(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(content);
      allDependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };
    } catch {
      continue;
    }

    const activatedPatterns: string[] = [];
    const activatedFixturePatterns: string[] = [];
    const activatedAlwaysUsed: string[] = [];

    const isRunnerEnabled = (runner: TestRunnerDefinition, dependencies: Record<string, string>, checkDirectory: string): boolean => {
      const hasDependency = runner.enablers.some((enabler) => {
        if (enabler === "bun:test") return detectBunTestRunner(checkDirectory);
        return enabler in dependencies;
      });
      if (hasDependency) return true;
      return runner.configFileActivators.some((configFile) => existsSync(join(checkDirectory, configFile)));
    };

    for (const runner of TEST_RUNNER_DEFINITIONS) {
      if (isRunnerEnabled(runner, allDependencies, directory)) {
        activatedPatterns.push(...runner.entryPatterns);
        activatedFixturePatterns.push(...runner.fixturePatterns);
        activatedAlwaysUsed.push(...runner.alwaysUsed);
      }
    }

    if (activatedPatterns.length === 0 && directory !== rootDir) {
      const rootPackageJsonPath = join(rootDir, "package.json");
      if (existsSync(rootPackageJsonPath)) {
        try {
          const rootContent = readFileSync(rootPackageJsonPath, "utf-8");
          const rootPackageJson = JSON.parse(rootContent);
          const rootDeps = {
            ...rootPackageJson.dependencies,
            ...rootPackageJson.devDependencies,
          };
          for (const runner of TEST_RUNNER_DEFINITIONS) {
            if (isRunnerEnabled(runner, rootDeps, rootDir)) {
              activatedPatterns.push(...runner.entryPatterns);
              activatedFixturePatterns.push(...runner.fixturePatterns);
              activatedAlwaysUsed.push(...runner.alwaysUsed);
            }
          }
        } catch {
        }
      }
    }

    if (activatedPatterns.length === 0) continue;

    const uniquePatterns = [...new Set(activatedPatterns)];
    const testFiles = fg.sync(uniquePatterns, {
      cwd: directory,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**"],
    });
    allEntries.push(...testFiles);

    const uniqueFixturePatterns = [...new Set(activatedFixturePatterns)];
    if (uniqueFixturePatterns.length > 0) {
      const fixtureFiles = fg.sync(uniqueFixturePatterns, {
        cwd: directory,
        absolute: true,
        onlyFiles: true,
        ignore: ["**/node_modules/**"],
      });
      allEntries.push(...fixtureFiles);
    }

    const uniqueAlwaysUsed = [...new Set(activatedAlwaysUsed)];
    if (uniqueAlwaysUsed.length > 0) {
      const alwaysUsedFiles = fg.sync(uniqueAlwaysUsed, {
        cwd: directory,
        absolute: true,
        onlyFiles: true,
        ignore: ["**/node_modules/**"],
        dot: true,
      });
      allEntries.push(...alwaysUsedFiles);
    }
  }

  return allEntries;
};
