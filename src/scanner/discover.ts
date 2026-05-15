import fg from "fast-glob";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import type { FileId, DeslopConfig } from "../types.js";
import { DEFAULT_EXTENSIONS, DEFAULT_IGNORE_PATTERNS, HIDDEN_DIRECTORY_ALLOWLIST, SCRIPT_FILE_PATTERN, SCRIPT_CONFIG_FILE_PATTERN, SCRIPT_ENTRY_PATTERNS } from "../constants.js";
import { discoverWorkspacePackages, discoverFrameworkEntryPoints } from "./workspaces.js";
import type { WorkspacePackage } from "./workspaces.js";
import { resolveSourcePath } from "../resolver/source-path.js";
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

  const viteEntries = extractViteEntryPoints(absoluteRoot);
  for (const workspacePackage of workspacePackages) {
    viteEntries.push(...extractViteEntryPoints(workspacePackage.directory));
  }

  const htmlScriptEntries = extractHtmlScriptEntries(absoluteRoot);
  for (const workspacePackage of workspacePackages) {
    htmlScriptEntries.push(...extractHtmlScriptEntries(workspacePackage.directory));
  }

  const angularEntries = extractAngularEntryPoints(absoluteRoot);
  for (const workspacePackage of workspacePackages) {
    angularEntries.push(...extractAngularEntryPoints(workspacePackage.directory));
  }

  const testEntryFiles = discoverTestRunnerEntryPoints(absoluteRoot, workspacePackages);
  const toolingEntryFiles = discoverToolingEntryPoints(absoluteRoot, workspacePackages);

  return [...new Set([...entryFiles, ...packageJsonEntries, ...workspaceEntries, ...frameworkEntries, ...scriptEntries, ...webpackEntries, ...viteEntries, ...htmlScriptEntries, ...angularEntries, ...testEntryFiles, ...toolingEntryFiles])];
};

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

const COMMON_SOURCE_DIRECTORIES = ["src", "lib", "main", "app", "source"];

const findSourceFile = (baseDir: string, relativePath: string): string | undefined => {
  const pathWithoutExtension = join(baseDir, relativePath).replace(/\.[cm]?js$/, "");
  for (const sourceExtension of SOURCE_EXTENSIONS) {
    const candidatePath = pathWithoutExtension + sourceExtension;
    if (existsSync(candidatePath)) return candidatePath;
  }
  const indexCandidate = join(pathWithoutExtension, "index.ts");
  if (existsSync(indexCandidate)) return indexCandidate;
  return undefined;
};

const resolveBuiltPathToSource = (builtAbsolutePath: string, rootDir: string): string | undefined => {
  if (existsSync(builtAbsolutePath)) return undefined;

  try {
    const tsconfigPath = join(rootDir, "tsconfig.json");
    if (!existsSync(tsconfigPath)) return undefined;
    const tsconfigContent = readFileSync(tsconfigPath, "utf-8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const tsconfig = JSON.parse(tsconfigContent);
    const outDir = tsconfig?.compilerOptions?.outDir;
    if (!outDir) return undefined;

    const absoluteOutDir = resolve(rootDir, outDir);
    const relativeToBuild = builtAbsolutePath.startsWith(absoluteOutDir)
      ? builtAbsolutePath.slice(absoluteOutDir.length)
      : undefined;
    if (!relativeToBuild) return undefined;

    const rootDirOption = tsconfig?.compilerOptions?.rootDir;
    if (rootDirOption) {
      const sourceRootDir = resolve(rootDir, rootDirOption);
      return findSourceFile(sourceRootDir, relativeToBuild);
    }

    const fromProjectRoot = findSourceFile(rootDir, relativeToBuild);
    if (fromProjectRoot) return fromProjectRoot;

    for (const sourceDir of COMMON_SOURCE_DIRECTORIES) {
      const candidateSourceDir = resolve(rootDir, sourceDir);
      if (existsSync(candidateSourceDir)) {
        const fromSourceDir = findSourceFile(candidateSourceDir, relativeToBuild);
        if (fromSourceDir) return fromSourceDir;
      }
    }
  } catch {
  }
  return undefined;
};

const resolveEntryPath = (entryPath: string, rootDir: string): string => {
  const absolutePath = resolve(rootDir, entryPath);
  if (existsSync(absolutePath)) return absolutePath;
  const sourcePath = resolveBuiltPathToSource(absolutePath, rootDir);
  return sourcePath ?? absolutePath;
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
        entries.push(resolveEntryPath(packageJson[field], rootDir));
      }
    }

    if (packageJson.exports) {
      collectExportPaths(packageJson.exports, rootDir, entries);
    }

    if (packageJson.bin) {
      if (typeof packageJson.bin === "string") {
        entries.push(resolveEntryPath(packageJson.bin, rootDir));
      } else if (typeof packageJson.bin === "object") {
        for (const binPath of Object.values(packageJson.bin)) {
          if (typeof binPath === "string") {
            entries.push(resolveEntryPath(binPath, rootDir));
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
          } else {
            const sourcePath = resolveSourcePath(scriptFilePath, directory);
            if (sourcePath) {
              entries.push(sourcePath);
            }
          }
        }

        const configMatch = scriptCommand.match(SCRIPT_CONFIG_FILE_PATTERN);
        if (configMatch?.[1]) {
          const configFilePath = resolve(directory, configMatch[1]);
          if (existsSync(configFilePath)) {
            entries.push(configFilePath);
          } else {
            const sourcePath = resolveSourcePath(configFilePath, directory);
            if (sourcePath) {
              entries.push(sourcePath);
            }
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

const VITE_INPUT_BLOCK_PATTERN = /input\s*:\s*(?:\{[^}]*\}|\[[^\]]*\]|['"][^'"]+['"])/gs;
const BUNDLER_ENTRY_FILE_PATTERN = /['"]([^'"]+\.(?:js|ts|tsx|jsx|mjs|mts|less|scss|css|sass|html))['"]/g;

const extractViteEntryPoints = (directory: string): string[] => {
  const entries: string[] = [];
  const viteConfigPaths = fg.sync("vite.config.{js,ts,mjs,mts}", {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
  });

  for (const configPath of viteConfigPaths) {
    try {
      const content = readFileSync(configPath, "utf-8");
      let inputMatch: RegExpExecArray | null;
      VITE_INPUT_BLOCK_PATTERN.lastIndex = 0;
      while ((inputMatch = VITE_INPUT_BLOCK_PATTERN.exec(content)) !== null) {
        const inputBlock = inputMatch[0];
        let valueMatch: RegExpExecArray | null;
        BUNDLER_ENTRY_FILE_PATTERN.lastIndex = 0;
        while ((valueMatch = BUNDLER_ENTRY_FILE_PATTERN.exec(inputBlock)) !== null) {
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

const WEBPACK_ENTRY_BLOCK_PATTERN = /entry\s*:\s*(?:\{[^}]*\}|\[[^\]]*\]|['"][^'"]+['"])/gs;
const WEBPACK_ENTRY_FILE_PATTERN = /['"]([^'"]+\.(?:js|ts|tsx|jsx|mjs|mts|less|scss|css|sass))['"]/g;

const extractWebpackEntryPoints = (directory: string): string[] => {
  const entries: string[] = [];
  const webpackConfigPaths = fg.sync(["webpack.config.{js,ts,mjs,cjs}", "**/webpack*.config.{js,ts,mjs,cjs}"], {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
    deep: 3,
  });

  for (const configPath of webpackConfigPaths) {
    try {
      const content = readFileSync(configPath, "utf-8");
      let entryMatch: RegExpExecArray | null;
      WEBPACK_ENTRY_BLOCK_PATTERN.lastIndex = 0;
      while ((entryMatch = WEBPACK_ENTRY_BLOCK_PATTERN.exec(content)) !== null) {
        const entryBlock = entryMatch[0];
        let valueMatch: RegExpExecArray | null;
        WEBPACK_ENTRY_FILE_PATTERN.lastIndex = 0;
        while ((valueMatch = WEBPACK_ENTRY_FILE_PATTERN.exec(entryBlock)) !== null) {
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
        const scriptSrc = scriptMatch[1].replace(/^\//, "");
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

const ANGULAR_ENTRY_KEYS = ["main", "polyfills", "styles"] as const;

const extractAngularEntryPoints = (directory: string): string[] => {
  const entries: string[] = [];
  const angularJsonPaths = fg.sync(["angular.json", ".angular-cli.json"], {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
  });

  for (const angularJsonPath of angularJsonPaths) {
    try {
      const content = readFileSync(angularJsonPath, "utf-8");
      const angularConfig = JSON.parse(content);
      const projects = angularConfig.projects ?? {};
      const angularDir = angularJsonPath.replace(/\/[^/]+$/, "");

      for (const projectConfig of Object.values(projects)) {
        const architect = (projectConfig as Record<string, unknown>).architect as Record<string, Record<string, unknown>> | undefined;
        if (!architect) continue;

        for (const targetConfig of Object.values(architect)) {
          const options = targetConfig.options as Record<string, unknown> | undefined;
          if (!options) continue;

          for (const entryKey of ANGULAR_ENTRY_KEYS) {
            const entryValue = options[entryKey];
            if (typeof entryValue === "string") {
              const absolutePath = resolve(angularDir, entryValue);
              if (existsSync(absolutePath)) {
                entries.push(absolutePath);
              }
            }
            if (Array.isArray(entryValue)) {
              for (const entryItem of entryValue) {
                if (typeof entryItem === "string") {
                  const absolutePath = resolve(angularDir, entryItem);
                  if (existsSync(absolutePath)) {
                    entries.push(absolutePath);
                  }
                }
              }
            }
          }
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
      "**/__e2e__/**/*.{ts,tsx,js,jsx,mts,mjs}",
      "**/*.bench.{ts,tsx,js,jsx}",
      "**/*.clienttest.{ts,tsx,js,jsx}",
      "**/*.servertest.{ts,tsx,js,jsx}",
    ],
    fixturePatterns: [
      "**/__fixtures__/**/*.{ts,tsx,js,jsx,json}",
      "**/fixtures/**/*.{ts,tsx,js,jsx,json}",
    ],
    alwaysUsed: [
      "vitest.config.{ts,js,mts,mjs}",
      "**/vitest.config.{ts,js,mts,mjs,mts}",
      "vitest.web.config.{ts,js,mts,mjs}",
      "vitest.setup.{ts,js}",
      "vitest.workspace.{ts,js,mts,mjs}",
      "vitest.globalSetup.{ts,js}",
      "**/setup-vitest.{ts,js}",
      "**/vitest.setup.{ts,js}",
      "**/vitest.globalSetup.{ts,js}",
      "**/setupTests.{ts,tsx,js,jsx}",
      "**/src/setupTests.{ts,tsx,js,jsx}",
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

interface ToolingPluginDefinition {
  enablers: string[];
  enablerPrefixes: string[];
  entryPatterns: string[];
  alwaysUsed: string[];
}

const TOOLING_PLUGIN_DEFINITIONS: ToolingPluginDefinition[] = [
  {
    enablers: ["storybook"],
    enablerPrefixes: ["@storybook/"],
    entryPatterns: [
      "**/*.stories.{ts,tsx,js,jsx,mdx}",
      ".storybook/**/*.{ts,tsx,js,jsx}",
    ],
    alwaysUsed: [
      ".storybook/main.{ts,js,mjs,cjs}",
      ".storybook/preview.{ts,tsx,js,jsx}",
      ".storybook/manager.{ts,tsx,js,jsx}",
    ],
  },
  {
    enablers: ["msw"],
    enablerPrefixes: [],
    entryPatterns: [
      "mocks/**/*.{ts,tsx,js,jsx}",
      "src/mocks/**/*.{ts,tsx,js,jsx}",
      "**/mocks/**/*.{ts,tsx,js,jsx}",
    ],
    alwaysUsed: [],
  },
  {
    enablers: ["typeorm"],
    enablerPrefixes: [],
    entryPatterns: [
      "migrations/**/*.{ts,js}",
      "src/migrations/**/*.{ts,js}",
      "src/migration/**/*.{ts,js}",
      "migration/**/*.{ts,js}",
      "src/entity/**/*.{ts,js}",
    ],
    alwaysUsed: ["ormconfig.{ts,js,json}"],
  },
  {
    enablers: ["knex"],
    enablerPrefixes: [],
    entryPatterns: [
      "migrations/**/*.{ts,js}",
      "seeds/**/*.{ts,js}",
    ],
    alwaysUsed: ["knexfile.{ts,js}"],
  },
  {
    enablers: ["drizzle-orm"],
    enablerPrefixes: [],
    entryPatterns: [
      "drizzle/**/*.{ts,js}",
    ],
    alwaysUsed: ["drizzle.config.{ts,js,mjs}"],
  },
  {
    enablers: ["kysely"],
    enablerPrefixes: [],
    entryPatterns: [
      "migrations/**/*.{ts,js}",
      "src/migrations/**/*.{ts,js}",
    ],
    alwaysUsed: [],
  },
  {
    enablers: ["prisma", "@prisma/client"],
    enablerPrefixes: [],
    entryPatterns: [
      "prisma/**/*.{ts,js}",
      "prisma/seed.{ts,js}",
    ],
    alwaysUsed: [],
  },
  {
    enablers: ["@nestjs/core"],
    enablerPrefixes: ["@nestjs/"],
    entryPatterns: [
      "src/main.ts",
      "src/**/*.module.ts",
      "src/**/*.controller.ts",
      "src/**/*.service.ts",
      "src/**/*.guard.ts",
      "src/**/*.interceptor.ts",
      "src/**/*.pipe.ts",
      "src/**/*.filter.ts",
      "src/**/*.middleware.ts",
      "src/**/*.decorator.ts",
      "src/**/*.gateway.ts",
      "src/**/*.resolver.ts",
    ],
    alwaysUsed: ["nest-cli.json"],
  },
  {
    enablers: ["wrangler"],
    enablerPrefixes: ["@cloudflare/"],
    entryPatterns: [
      "src/index.{ts,js}",
      "src/worker.{ts,js}",
      "functions/**/*.{ts,js}",
    ],
    alwaysUsed: [],
  },
  {
    enablers: ["gatsby"],
    enablerPrefixes: ["gatsby-"],
    entryPatterns: [
      "src/pages/**/*.{ts,tsx,js,jsx}",
      "src/templates/**/*.{ts,tsx,js,jsx}",
      "src/components/**/*.{ts,tsx,js,jsx}",
    ],
    alwaysUsed: [
      "gatsby-config.{ts,js,mjs}",
      "gatsby-node.{ts,js,mjs}",
      "gatsby-browser.{ts,tsx,js,jsx}",
      "gatsby-ssr.{ts,tsx,js,jsx}",
    ],
  },
  {
    enablers: ["@angular/core"],
    enablerPrefixes: ["@angular/"],
    entryPatterns: [
      "src/main.ts",
      "src/app/**/*.ts",
      "src/environments/**/*.ts",
      "src/polyfills.ts",
      "src/test.ts",
    ],
    alwaysUsed: [
      "angular.json",
      "**/karma.conf.js",
    ],
  },
  {
    enablers: ["react-scripts", "react-app-rewired"],
    enablerPrefixes: [],
    entryPatterns: [
      "src/index.{ts,tsx,js,jsx}",
    ],
    alwaysUsed: [
      "src/setupTests.{ts,tsx,js,jsx}",
      "src/reportWebVitals.{ts,tsx,js,jsx}",
      "src/react-app-env.d.ts",
    ],
  },
  {
    enablers: ["@remix-run/node", "@remix-run/react", "@remix-run/cloudflare", "@react-router/node", "@react-router/serve", "@react-router/dev"],
    enablerPrefixes: ["@remix-run/", "@react-router/"],
    entryPatterns: [
      "app/routes/**/*.{ts,tsx,js,jsx}",
      "app/root.{ts,tsx,js,jsx}",
      "app/entry.client.{ts,tsx,js,jsx}",
      "app/entry.server.{ts,tsx,js,jsx}",
      "app/**/page.{ts,tsx,js,jsx}",
      "app/**/layout.{ts,tsx,js,jsx}",
      "app/**/error.{ts,tsx,js,jsx}",
      "app/**/loading.{ts,tsx,js,jsx}",
    ],
    alwaysUsed: [
      "react-router.config.{ts,js,mjs}",
      "remix.config.{ts,js,mjs}",
    ],
  },
  {
    enablers: ["@docusaurus/core"],
    enablerPrefixes: ["@docusaurus/"],
    entryPatterns: [
      "docs/**/*.{md,mdx}",
      "blog/**/*.{md,mdx}",
      "src/pages/**/*.{ts,tsx,js,jsx,md,mdx}",
      "src/components/**/*.{ts,tsx,js,jsx}",
      "src/theme/**/*.{ts,tsx,js,jsx}",
    ],
    alwaysUsed: [
      "docusaurus.config.{ts,js,mjs}",
      "sidebars.{ts,js,mjs,cjs}",
      "*-sidebar.{ts,js,mjs,cjs}",
      "*-sidebars.{ts,js,mjs,cjs}",
      "docs-sidebar.{ts,js,mjs,cjs}",
      "src/css/custom.css",
      "src/css/custom.scss",
    ],
  },
  {
    enablers: ["eslint", "@eslint/js"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: [
      "eslint.config.{js,mjs,cjs,ts,mts,cts}",
      ".eslintrc.{js,cjs,mjs,json,yaml,yml}",
    ],
  },
  {
    enablers: ["prettier"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: [
      ".prettierrc.{js,cjs,mjs,json,yaml,yml}",
      "prettier.config.{js,mjs,cjs,ts}",
    ],
  },
  {
    enablers: ["tailwindcss", "@tailwindcss/postcss"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["tailwind.config.{ts,js,cjs,mjs}"],
  },
  {
    enablers: ["postcss"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["postcss.config.{ts,js,cjs,mjs}"],
  },
  {
    enablers: ["typescript"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["tsconfig.json", "tsconfig.*.json"],
  },
  {
    enablers: ["lint-staged"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: [
      ".lintstagedrc.{js,cjs,mjs,json}",
      "lint-staged.config.{js,mjs,cjs}",
    ],
  },
  {
    enablers: ["husky"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: [".husky/**/*"],
  },
  {
    enablers: ["@biomejs/biome"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["biome.json", "biome.jsonc"],
  },
  {
    enablers: ["@commitlint/cli"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: [
      "commitlint.config.{js,cjs,mjs,ts}",
      ".commitlintrc.{js,cjs,mjs,json,yaml,yml}",
    ],
  },
  {
    enablers: ["semantic-release"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: [
      ".releaserc.{js,cjs,mjs,json,yaml,yml}",
      "release.config.{js,cjs,mjs,ts}",
    ],
  },
  {
    enablers: ["@changesets/cli"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: [".changeset/**/*"],
  },
  {
    enablers: ["vite", "rolldown-vite"],
    enablerPrefixes: ["@vitejs/"],
    entryPatterns: [],
    alwaysUsed: ["vite.config.{ts,js,mts,mjs}"],
  },
  {
    enablers: ["vue", "@vue/cli-service"],
    enablerPrefixes: ["@vue/"],
    entryPatterns: [
      "src/main.{ts,js}",
      "src/App.vue",
    ],
    alwaysUsed: ["vue.config.{ts,js,mjs,cjs}"],
  },
  {
    enablers: ["nuxt", "nuxt3"],
    enablerPrefixes: ["@nuxt/"],
    entryPatterns: [
      "pages/**/*.vue",
      "layouts/**/*.vue",
      "components/**/*.vue",
      "composables/**/*.{ts,js}",
      "plugins/**/*.{ts,js}",
      "middleware/**/*.{ts,js}",
      "server/**/*.{ts,js}",
      "app.vue",
    ],
    alwaysUsed: ["nuxt.config.{ts,js,mjs}"],
  },
  {
    enablers: ["svelte", "@sveltejs/kit"],
    enablerPrefixes: ["@sveltejs/"],
    entryPatterns: [
      "src/routes/**/*.svelte",
      "src/lib/**/*.svelte",
      "src/routes/**/+page.{ts,js,svelte}",
      "src/routes/**/+layout.{ts,js,svelte}",
      "src/routes/**/+server.{ts,js}",
    ],
    alwaysUsed: ["svelte.config.{ts,js,mjs}"],
  },
  {
    enablers: ["webpack", "webpack-cli"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: [
      "webpack.config.{ts,js,mjs,cjs}",
      "webpack.*.config.{ts,js,mjs,cjs}",
    ],
  },
  {
    enablers: ["rollup"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["rollup.config.{ts,js,mjs,cjs}"],
  },
  {
    enablers: ["tsup"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["tsup.config.{ts,js,cjs,mjs}"],
  },
  {
    enablers: ["@swc/core"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: [".swcrc"],
  },
  {
    enablers: ["@babel/core"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: [
      "babel.config.{js,cjs,mjs,json}",
      ".babelrc.{js,cjs,mjs,json}",
    ],
  },
  {
    enablers: ["i18next", "react-i18next", "vue-i18n", "next-i18next"],
    enablerPrefixes: [],
    entryPatterns: [
      "src/i18n.{ts,js,mjs}",
      "src/i18n/index.{ts,js}",
      "i18n.{ts,js,mjs}",
      "i18n/index.{ts,js}",
    ],
    alwaysUsed: [
      "src/i18n.{ts,js,mjs}",
      "src/i18n/index.{ts,js}",
      "i18n.{ts,js,mjs}",
      "i18n/index.{ts,js}",
      "i18next.config.{js,ts,mjs}",
      "next-i18next.config.{js,mjs}",
      "locales/**/*.json",
      "public/locales/**/*.json",
      "src/locales/**/*.json",
    ],
  },
  {
    enablers: ["turbo"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["turbo.json", "turbo/generators/config.{ts,js}"],
  },
  {
    enablers: ["@sentry/nextjs", "@sentry/react", "@sentry/node", "@sentry/browser"],
    enablerPrefixes: ["@sentry/"],
    entryPatterns: [],
    alwaysUsed: [
      "sentry.client.config.{ts,js,mjs}",
      "sentry.server.config.{ts,js,mjs}",
      "sentry.edge.config.{ts,js,mjs}",
    ],
  },
  {
    enablers: ["nodemon"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["nodemon.json", ".nodemonrc", ".nodemonrc.{json,yml,yaml}"],
  },
  {
    enablers: ["nx"],
    enablerPrefixes: ["@nx/"],
    entryPatterns: [],
    alwaysUsed: ["nx.json", "**/project.json"],
  },
  {
    enablers: ["expo"],
    enablerPrefixes: ["@expo/"],
    entryPatterns: [
      "App.{ts,tsx,js,jsx}",
      "app/_layout.{ts,tsx,js,jsx}",
      "app/index.{ts,tsx,js,jsx}",
    ],
    alwaysUsed: ["app.json", "app.config.{ts,js}"],
  },
  {
    enablers: ["electron"],
    enablerPrefixes: [],
    entryPatterns: [
      "src/main.{ts,js}",
      "src/preload.{ts,js}",
      "src/renderer.{ts,tsx,js,jsx}",
      "electron/main.{ts,js}",
      "electron/preload.{ts,js}",
    ],
    alwaysUsed: [],
  },
  {
    enablers: ["lage"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["lage.config.{js,cjs,mjs}"],
  },
  {
    enablers: ["lefthook"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["lefthook.yml", "lefthook.yaml", ".lefthook.yml"],
  },
  {
    enablers: ["syncpack"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: [".syncpackrc", ".syncpackrc.{json,yaml,yml}", "syncpack.config.{js,mjs,cjs}"],
  },
  {
    enablers: ["@react-router/dev"],
    enablerPrefixes: [],
    entryPatterns: [
      "app/routes/**/*.{ts,tsx,js,jsx}",
      "app/root.{ts,tsx,js,jsx}",
      "app/entry.client.{ts,tsx,js,jsx}",
      "app/entry.server.{ts,tsx,js,jsx}",
    ],
    alwaysUsed: ["react-router.config.{ts,js,mjs,cjs}"],
  },
  {
    enablers: ["@capacitor/core", "@capacitor/cli"],
    enablerPrefixes: ["@capacitor/"],
    entryPatterns: [],
    alwaysUsed: ["capacitor.config.{ts,js,json}"],
  },
];

const detectNodeTestRunner = (directory: string): boolean => {
  try {
    const packageJsonPath = join(directory, "package.json");
    if (!existsSync(packageJsonPath)) return false;
    const content = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);
    const scripts = packageJson.scripts ?? {};
    return Object.values(scripts).some(
      (scriptValue) => typeof scriptValue === "string" && /\bnode\b.*\s--test\b/.test(scriptValue)
    );
  } catch {
    return false;
  }
};

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

    const hasNodeTestScript = detectNodeTestRunner(directory) || detectNodeTestRunner(rootDir);
    if (hasNodeTestScript) {
      activatedPatterns.push(
        "**/*.test.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
        "**/*.spec.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
        "**/__tests__/**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
      );
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

const isToolingPluginEnabled = (
  plugin: ToolingPluginDefinition,
  dependencies: Record<string, string>,
): boolean => {
  if (plugin.enablers.some((enabler) => enabler in dependencies)) return true;
  if (plugin.enablerPrefixes.length > 0) {
    const depNames = Object.keys(dependencies);
    return plugin.enablerPrefixes.some((prefix) =>
      depNames.some((depName) => depName.startsWith(prefix)),
    );
  }
  return false;
};

const discoverToolingEntryPoints = (
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
    const activatedAlwaysUsed: string[] = [];

    for (const plugin of TOOLING_PLUGIN_DEFINITIONS) {
      if (isToolingPluginEnabled(plugin, allDependencies)) {
        activatedPatterns.push(...plugin.entryPatterns);
        activatedAlwaysUsed.push(...plugin.alwaysUsed);
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
          for (const plugin of TOOLING_PLUGIN_DEFINITIONS) {
            if (isToolingPluginEnabled(plugin, rootDeps)) {
              activatedPatterns.push(...plugin.entryPatterns);
              activatedAlwaysUsed.push(...plugin.alwaysUsed);
            }
          }
        } catch {
        }
      }
    }

    if (activatedPatterns.length === 0) continue;

    const uniquePatterns = [...new Set(activatedPatterns)];
    const toolingFiles = fg.sync(uniquePatterns, {
      cwd: directory,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**"],
      dot: true,
    });
    allEntries.push(...toolingFiles);

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
