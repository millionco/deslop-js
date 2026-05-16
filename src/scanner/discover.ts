import fg from "fast-glob";
import { resolve, dirname } from "node:path";
import { readFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import type { FileId, DeslopConfig, DiscoveredEntryPoints } from "../types.js";
import { DEFAULT_EXTENSIONS, DEFAULT_IGNORE_PATTERNS, HIDDEN_DIRECTORY_ALLOWLIST, SCRIPT_FILE_PATTERN, SCRIPT_CONFIG_FILE_PATTERN, SCRIPT_ENTRY_PATTERNS, SHALLOW_WORKSPACE_MAX_DEPTH } from "../constants.js";
import { discoverWorkspacePackagesWithExclusions, discoverFrameworkEntryPoints } from "./workspaces.js";
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

  const allowedHiddenGlobs = HIDDEN_DIRECTORY_ALLOWLIST.flatMap(
    (directory) => [
      `${directory}/**/*{${extensions.join(",")}}`,
      `**/${directory}/**/*{${extensions.join(",")}}`,
    ],
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

export const discoverFrameworkIgnorePatterns = (rootDir: string): string[] => {
  const absoluteRoot = resolve(rootDir);
  const workspacePackages = discoverWorkspacePackagesWithExclusions(absoluteRoot).packages;
  const directoriesToCheck = [absoluteRoot, ...workspacePackages.map((workspacePackage) => workspacePackage.directory)];
  const ignorePatterns: string[] = [];

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

    for (const plugin of TOOLING_PLUGIN_DEFINITIONS) {
      if (plugin.contentIgnorePatterns && isToolingPluginEnabled(plugin, allDependencies)) {
        for (const pattern of plugin.contentIgnorePatterns) {
          const absolutePattern = join(directory, pattern);
          ignorePatterns.push(absolutePattern);
        }
      }
    }
  }

  return ignorePatterns;
};

export const discoverEntryPoints = async (config: DeslopConfig): Promise<DiscoveredEntryPoints> => {
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

  const workspaceDiscovery = discoverWorkspacePackagesWithExclusions(absoluteRoot);
  const workspacePackages = workspaceDiscovery.packages;
  const isEntryEligible = (workspacePackage: WorkspacePackage): boolean => {
    if (workspaceDiscovery.hasRootLevelWorkspacePatterns) return true;
    return workspacePackage.depthFromRoot <= SHALLOW_WORKSPACE_MAX_DEPTH;
  };

  const hasDeclaredWorkspaces = workspacePackages.some((workspacePackage) => workspacePackage.isDeclaredWorkspace);

  const workspaceEntries: string[] = [];
  for (const workspacePackage of workspacePackages) {
    const isEligible = isEntryEligible(workspacePackage);

    const shouldRunFrameworkDetection = workspaceDiscovery.hasRootLevelWorkspacePatterns && hasDeclaredWorkspaces
      ? workspacePackage.isDeclaredWorkspace && isEligible
      : isEligible;
    if (shouldRunFrameworkDetection) {
      const workspaceFrameworkEntries = discoverFrameworkEntryPoints(workspacePackage.directory);
      workspaceEntries.push(...workspaceFrameworkEntries);
    }

    const shouldExtractEntries = isEligible && (workspacePackage.isDeclaredWorkspace || !workspaceDiscovery.hasRootLevelWorkspacePatterns);
    if (shouldExtractEntries) {
      const workspacePackageJsonPath = resolve(workspacePackage.directory, "package.json");
      const workspacePackageJsonEntries = await extractPackageJsonEntries(workspacePackageJsonPath);
      const hasValidEntries = workspacePackageJsonEntries.some((entryPath) => existsSync(entryPath));
      if (hasValidEntries) {
        workspaceEntries.push(...workspacePackageJsonEntries);
      } else {
        const defaultFallback = findDefaultIndexEntry(workspacePackage.directory);
        if (defaultFallback) {
          workspaceEntries.push(defaultFallback);
        }
      }
    }
  }

  const frameworkEntries = discoverFrameworkEntryPoints(absoluteRoot);

  const entryEligiblePackages = workspacePackages.filter(isEntryEligible);

  const scriptEntries = extractScriptEntries(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    scriptEntries.push(...extractScriptEntries(workspacePackage.directory));
  }

  const webpackEntries = extractWebpackEntryPoints(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    webpackEntries.push(...extractWebpackEntryPoints(workspacePackage.directory));
  }

  const viteEntries = extractViteEntryPoints(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    viteEntries.push(...extractViteEntryPoints(workspacePackage.directory));
  }

  const htmlScriptEntries = extractHtmlScriptEntries(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    htmlScriptEntries.push(...extractHtmlScriptEntries(workspacePackage.directory));
  }

  const allDiscoveredEntries = [...scriptEntries, ...webpackEntries, ...viteEntries];
  for (const entryPath of allDiscoveredEntries) {
    if (entryPath.endsWith(".html") && existsSync(entryPath)) {
      htmlScriptEntries.push(...extractScriptTagsFromHtmlFile(entryPath));
    }
  }

  const angularEntries = extractAngularEntryPoints(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    angularEntries.push(...extractAngularEntryPoints(workspacePackage.directory));
  }

  const testSetupEntries = extractTestSetupFiles(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    testSetupEntries.push(...extractTestSetupFiles(workspacePackage.directory));
  }

  const pluginFileEntries = extractNextConfigPluginFiles(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    pluginFileEntries.push(...extractNextConfigPluginFiles(workspacePackage.directory));
  }

  const testRunnerDiscovery = discoverTestRunnerEntryPoints(absoluteRoot, entryEligiblePackages);
  const toolingDiscovery = discoverToolingEntryPoints(absoluteRoot, entryEligiblePackages);
  const ciEntries = extractCiWorkflowEntries(absoluteRoot);

  const testEntries = [...new Set([...testRunnerDiscovery.entryFiles, ...testSetupEntries])];
  const testEntryPathSet = new Set(testEntries);
  const productionEntries = [...new Set([...entryFiles, ...packageJsonEntries, ...workspaceEntries, ...frameworkEntries, ...scriptEntries, ...webpackEntries, ...viteEntries, ...htmlScriptEntries, ...angularEntries, ...pluginFileEntries, ...toolingDiscovery.entryFiles, ...ciEntries])].filter(
    (entryPath) => !testEntryPathSet.has(entryPath),
  );
  const alwaysUsedFiles = [...new Set([...toolingDiscovery.alwaysUsedFiles, ...testRunnerDiscovery.alwaysUsedFiles])];

  return { productionEntries, testEntries, alwaysUsedFiles };
};

const DEFAULT_INDEX_PATTERNS = [
  "src/index.ts", "src/index.tsx", "src/index.js", "src/index.jsx",
  "src/main.ts", "src/main.tsx", "src/main.js", "src/main.jsx",
  "index.ts", "index.tsx", "index.js", "index.jsx",
  "main.ts", "main.tsx", "main.js", "main.jsx",
];

const findDefaultIndexEntry = (directory: string): string | undefined => {
  for (const pattern of DEFAULT_INDEX_PATTERNS) {
    const candidatePath = resolve(directory, pattern);
    if (existsSync(candidatePath)) return candidatePath;
  }
  return undefined;
};

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

const COMMON_SOURCE_DIRECTORIES = ["src", "lib", "main", "app", "source"];
const BUILD_OUTPUT_DIRECTORY_PATTERN = /^(?:\.\/)?(?:dist(?:-[a-z]+)?|build|lib-dist|lib|out|output|cjs|esm|es|umd|module)\/(?:(?:esm|cjs|es|lib|commonjs|module)\/)?/;

const findSourceFile = (baseDir: string, relativePath: string): string | undefined => {
  const pathWithoutExtension = join(baseDir, relativePath).replace(/\.[cm]?js(x?)$/, "");
  for (const sourceExtension of SOURCE_EXTENSIONS) {
    const candidatePath = pathWithoutExtension + sourceExtension;
    if (existsSync(candidatePath)) return candidatePath;
  }
  const indexCandidate = join(pathWithoutExtension, "index.ts");
  if (existsSync(indexCandidate)) return indexCandidate;
  return undefined;
};

const findSourceFileStrict = (baseDir: string, relativePath: string): string | undefined => {
  const pathWithoutExtension = join(baseDir, relativePath).replace(/\.[cm]?js(x?)$/, "");
  for (const sourceExtension of SOURCE_EXTENSIONS) {
    const candidatePath = pathWithoutExtension + sourceExtension;
    if (existsSync(candidatePath)) return candidatePath;
  }
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
    const sourceRoot = rootDirOption ? resolve(rootDir, rootDirOption) : rootDir;
    const sourceFileMatch = findSourceFile(sourceRoot, relativeToBuild);
    if (sourceFileMatch) return sourceFileMatch;
    const directCandidate = join(sourceRoot, relativeToBuild);
    if (existsSync(directCandidate)) return directCandidate;
  } catch {
  }
  return undefined;
};

const resolveEntryPathViaHeuristic = (entryPath: string, rootDir: string): string | undefined => {
  if (!BUILD_OUTPUT_DIRECTORY_PATTERN.test(entryPath)) return undefined;
  const buildDirMatch = entryPath.match(BUILD_OUTPUT_DIRECTORY_PATTERN);
  if (!buildDirMatch) return undefined;
  const relativeToBuildDir = entryPath.slice(buildDirMatch[0].length);
  for (const sourceDir of COMMON_SOURCE_DIRECTORIES) {
    const sourceBaseDir = resolve(rootDir, sourceDir);
    if (!existsSync(sourceBaseDir)) continue;
    const sourceFileMatch = findSourceFileStrict(sourceBaseDir, relativeToBuildDir);
    if (sourceFileMatch) return sourceFileMatch;
  }
  const rootSourceMatch = findSourceFile(rootDir, relativeToBuildDir);
  if (rootSourceMatch) return rootSourceMatch;
  return undefined;
};

const resolveEntryPath = (entryPath: string, rootDir: string): string => {
  const absolutePath = resolve(rootDir, entryPath);
  const normalizedEntry = entryPath.replace(/^\.\//, "");
  const isInBuildOutputDirectory = BUILD_OUTPUT_DIRECTORY_PATTERN.test(normalizedEntry);
  if (isInBuildOutputDirectory) {
    const sourcePath = resolveBuiltPathToSource(absolutePath, rootDir);
    if (sourcePath) return sourcePath;
    const heuristicMatch = resolveEntryPathViaHeuristic(normalizedEntry, rootDir);
    if (heuristicMatch) return heuristicMatch;
  }
  if (existsSync(absolutePath)) return absolutePath;
  const sourcePath = resolveBuiltPathToSource(absolutePath, rootDir);
  if (sourcePath) return sourcePath;
  const directSourceMatch = findSourceFile(rootDir, normalizedEntry);
  if (directSourceMatch) return directSourceMatch;
  const heuristicMatch = resolveEntryPathViaHeuristic(normalizedEntry, rootDir);
  if (heuristicMatch) return heuristicMatch;
  return absolutePath;
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
      const exportEntries: string[] = [];
      collectExportPaths(packageJson.exports, rootDir, exportEntries);
      for (const exportEntry of exportEntries) {
        if (existsSync(exportEntry)) {
          entries.push(exportEntry);
        } else {
          const sourcePath = resolveSourcePath(exportEntry, rootDir);
          if (sourcePath) {
            entries.push(sourcePath);
          } else if (exportEntry.endsWith(".ts")) {
            const tsxFallback = exportEntry.replace(/\.ts$/, ".tsx");
            if (existsSync(tsxFallback)) {
              entries.push(tsxFallback);
            } else {
              entries.push(exportEntry);
            }
          } else {
            entries.push(resolveEntryPath(exportEntry, rootDir));
          }
        }
      }
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

const SHELL_OPERATORS_PATTERN = /\s*(?:&&|\|\||[;&|])\s*/;

const SCRIPT_MULTIPLEXERS = new Set([
  "concurrently", "run-s", "run-p", "npm-run-all", "npm-run-all2",
  "wireit", "turbo", "lerna", "ultra",
]);

const CONFIG_LIKE_FLAGS = new Set([
  "--config", "-c", "--format", "--formatter",
  "--tsconfig", "--project", "-p", "--setup", "--global-setup",
]);

const ENV_WRAPPER_BINARIES = new Set([
  "cross-env", "dotenv", "dotenv-flow", "env-cmd",
]);

const NON_ENTRY_BINARIES = new Set([
  "prettier", "eslint", "tslint", "stylelint", "biome", "oxlint", "oxfmt",
  "tsc", "tsup", "esbuild", "rollup", "webpack",
  "rimraf", "del-cli", "shx", "cpy-cli", "cpx",
  "echo", "cat", "mkdir", "rm", "cp", "mv", "ls", "pwd", "test",

  "husky", "lint-staged", "commitlint",
  "changeset", "changesets",
  "typedoc", "api-extractor",
  "madge", "depcheck", "knip", "fallow",
  "sort-package-json",
  "pnpm", "npm", "yarn", "ni", "nr", "nun",
  "next", "nuxt", "astro", "vite", "svelte-kit",
  "prisma", "drizzle-kit",
  "formatjs", "i18next", "i18next-parser", "lingui",
  "storybook", "chromatic", "msw",
  "patch-package", "syncpack", "manypkg",
  "jest", "vitest", "mocha", "ava", "tap", "c8", "nyc",
  "playwright", "cypress", "puppeteer", "webdriver",
  "sequelize", "typeorm", "mikro-orm",
  "wait-on", "start-server-and-test",
  "remark", "markdownlint", "markdownlint-cli2", "textlint", "alex", "cspell",
  "ncu", "npm-check-updates", "size-limit", "bundlewatch",
  "dbdocs", "lobe-i18n", "lobe-seo",
]);

const looksLikeFilePath = (token: string): boolean => {
  if (token.startsWith("-") || token.includes("${{") || token.includes("://")) return false;
  if (token.includes("}}") && !token.includes("{{")) return false;
  const hasKnownExtension = /\.(?:[cm]?[jt]sx?|css|scss|json|yaml|yml|toml|html|mjs|cjs|mts|cts|graphql|gql|mdx|astro|vue|svelte)$/.test(token);
  if (hasKnownExtension) return true;
  const hasGlobWithExtension = /\.\{[^}]+\}$/.test(token);
  if (hasGlobWithExtension) return true;
  if (token.startsWith("./") || token.startsWith("../")) return true;
  return token.includes("/") && !token.startsWith("@");
};

const isGlobPattern = (token: string): boolean => {
  return token.includes("*") || token.includes("{") || token.includes("?");
};

const extractScriptFileArguments = (scriptCommand: string, directory: string): string[] => {
  const entries: string[] = [];
  const segments = scriptCommand.split(SHELL_OPERATORS_PATTERN);

  for (const segment of segments) {
    const trimmedSegment = segment.trim();
    if (!trimmedSegment) continue;

    const tokens = trimmedSegment.split(/\s+/);
    if (tokens.length === 0) continue;

    let startIndex = 0;
    const firstBinary = tokens[0].replace(/^.*\//, "");
    if (ENV_WRAPPER_BINARIES.has(firstBinary)) {
      startIndex = 1;
      while (startIndex < tokens.length && /^[A-Z_][A-Z0-9_]*=/.test(tokens[startIndex])) {
        startIndex++;
      }
      if (startIndex >= tokens.length) continue;
    }

    const binaryName = tokens[startIndex].replace(/^.*\//, "");
    if (SCRIPT_MULTIPLEXERS.has(binaryName)) continue;

    const effectiveBinaryName = (binaryName === "npx" || binaryName === "pnpx" || binaryName === "bunx")
      ? (tokens[startIndex + 1]?.replace(/^.*\//, "") ?? "")
      : binaryName;
    const isNonEntryBinary = NON_ENTRY_BINARIES.has(binaryName) ||
      (effectiveBinaryName !== "" && NON_ENTRY_BINARIES.has(effectiveBinaryName));

    for (let tokenIndex = startIndex + 1; tokenIndex < tokens.length; tokenIndex++) {
      const token = tokens[tokenIndex].replace(/^['"]|['"]$/g, "");

      if (CONFIG_LIKE_FLAGS.has(token)) {
        if (tokenIndex + 1 < tokens.length && !tokens[tokenIndex + 1].startsWith("-")) {
          const configPath = tokens[tokenIndex + 1].replace(/^['"]|['"]$/g, "");
          if (looksLikeFilePath(configPath)) {
            const absoluteConfigPath = resolve(directory, configPath);
            if (existsSync(absoluteConfigPath)) {
              entries.push(absoluteConfigPath);
            }
          }
          tokenIndex++;
        }
        continue;
      }

      const equalsIndex = token.indexOf("=");
      if (equalsIndex > 0 && CONFIG_LIKE_FLAGS.has(token.slice(0, equalsIndex))) {
        const configValue = token.slice(equalsIndex + 1);
        if (configValue && looksLikeFilePath(configValue)) {
          const absoluteConfigPath = resolve(directory, configValue);
          if (existsSync(absoluteConfigPath)) {
            entries.push(absoluteConfigPath);
          }
        }
        continue;
      }

      if (token.startsWith("-")) continue;

      if (isNonEntryBinary) continue;

      if (!looksLikeFilePath(token)) continue;

      if (isGlobPattern(token)) {
        const expandedFiles = fg.sync(token, {
          cwd: directory,
          absolute: true,
          onlyFiles: true,
          ignore: ["**/node_modules/**"],
        });
        entries.push(...expandedFiles);
      } else {
        const absoluteFilePath = resolve(directory, token);
        if (existsSync(absoluteFilePath)) {
          entries.push(absoluteFilePath);
        } else {
          const sourcePath = resolveSourcePath(absoluteFilePath, directory);
          if (sourcePath) {
            entries.push(sourcePath);
          }
        }
      }
    }
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

        entries.push(...extractScriptFileArguments(scriptCommand, directory));
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

const isYamlMapping = (line: string): boolean => {
  const firstWord = line.split(/\s/)[0];
  if (!firstWord) return false;
  return firstWord.endsWith(":") && !firstWord.startsWith("http") && !firstWord.startsWith("ftp");
};

const extractCiRunCommands = (content: string): string[] => {
  const commands: string[] = [];
  let inMultilineRun = false;
  let multilineIndent = 0;

  for (const line of content.split("\n")) {
    const trimmedLine = line.trim();
    if (trimmedLine === "" || trimmedLine.startsWith("#")) continue;

    if (inMultilineRun) {
      const indent = line.length - line.trimStart().length;
      if (indent > multilineIndent && trimmedLine !== "") {
        commands.push(trimmedLine);
        continue;
      }
      inMultilineRun = false;
    }

    const runMatch = trimmedLine.match(/^(?:-\s+)?run:\s*(.*)$/);
    if (runMatch) {
      const runValue = runMatch[1].trim();
      if (runValue === "|" || runValue === "|-" || runValue === "|+") {
        inMultilineRun = true;
        multilineIndent = line.length - line.trimStart().length;
      } else if (runValue !== "") {
        commands.push(runValue);
      }
      continue;
    }

    if (trimmedLine.startsWith("- ")) {
      const listItem = trimmedLine.slice(2).trim();
      if (listItem !== "" && !listItem.startsWith("{") && !listItem.startsWith("[") && !isYamlMapping(listItem)) {
        commands.push(listItem);
      }
    }
  }
  return commands;
};

const extractCiWorkflowEntries = (rootDir: string): string[] => {
  const entries: string[] = [];
  const workflowsDir = join(rootDir, ".github", "workflows");
  if (!existsSync(workflowsDir)) return entries;

  const workflowFiles = fg.sync("*.{yml,yaml}", {
    cwd: workflowsDir,
    absolute: true,
    onlyFiles: true,
  });

  for (const workflowFile of workflowFiles) {
    try {
      const content = readFileSync(workflowFile, "utf-8");
      const runCommands = extractCiRunCommands(content);
      for (const command of runCommands) {
        const scriptMatch = command.match(SCRIPT_FILE_PATTERN);
        if (scriptMatch?.[1]) {
          const scriptFilePath = resolve(rootDir, scriptMatch[1]);
          if (existsSync(scriptFilePath)) {
            entries.push(scriptFilePath);
          }
        }
        const configMatch = command.match(SCRIPT_CONFIG_FILE_PATTERN);
        if (configMatch?.[1]) {
          const configFilePath = resolve(rootDir, configMatch[1]);
          if (existsSync(configFilePath)) {
            entries.push(configFilePath);
          }
        }
      }
    } catch {
    }
  }

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

const WEBPACK_ENTRY_BLOCK_PATTERN = /entry\s*:\s*(?:\{[^}]*\}|\[[^\]]*\]|['"][^'"]+['"]|path\.(?:join|resolve)\([^)]*\))/gs;
const WEBPACK_ENTRY_FILE_PATTERN = /['"]([^'"]+)['"]/g;
const WEBPACK_PATH_JOIN_PATTERN = /path\.(?:join|resolve)\(\s*__dirname\s*,\s*((?:['"][^'"]*['"]\s*,?\s*)+)\)/g;
const RESOLVABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"];

const resolveEntryWithExtensions = (basePath: string): string | undefined => {
  if (existsSync(basePath)) return basePath;
  for (const extension of RESOLVABLE_EXTENSIONS) {
    const withExtension = basePath + extension;
    if (existsSync(withExtension)) return withExtension;
  }
  const indexCandidates = RESOLVABLE_EXTENSIONS.map((extension) => resolve(basePath, `index${extension}`));
  for (const candidate of indexCandidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
};

const extractWebpackEntryPoints = (directory: string): string[] => {
  const entries: string[] = [];
  const webpackConfigPaths = fg.sync([
    "webpack.config.{js,ts,mjs,cjs}",
    "**/webpack*.config.{js,ts,mjs,cjs}",
    "**/webpack.config*.{js,ts,mjs,cjs}",
    "**/webpack*.config*.babel.{js,ts}",
  ], {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
    deep: 3,
  });

  for (const configPath of webpackConfigPaths) {
    try {
      const content = readFileSync(configPath, "utf-8");
      const configDirectory = dirname(configPath);

      let pathJoinMatch: RegExpExecArray | null;
      WEBPACK_PATH_JOIN_PATTERN.lastIndex = 0;
      while ((pathJoinMatch = WEBPACK_PATH_JOIN_PATTERN.exec(content)) !== null) {
        const segmentsRaw = pathJoinMatch[1];
        const segments = [...segmentsRaw.matchAll(/['"]([^'"]*)['"]/g)].map((match) => match[1]);
        if (segments.length > 0) {
          const joinedPath = resolve(configDirectory, ...segments);
          const resolvedEntry = resolveEntryWithExtensions(joinedPath);
          if (resolvedEntry) {
            entries.push(resolvedEntry);
          }
        }
      }

      let entryMatch: RegExpExecArray | null;
      WEBPACK_ENTRY_BLOCK_PATTERN.lastIndex = 0;
      while ((entryMatch = WEBPACK_ENTRY_BLOCK_PATTERN.exec(content)) !== null) {
        const entryBlock = entryMatch[0];
        if (entryBlock.includes("path.join") || entryBlock.includes("path.resolve")) continue;
        let valueMatch: RegExpExecArray | null;
        WEBPACK_ENTRY_FILE_PATTERN.lastIndex = 0;
        while ((valueMatch = WEBPACK_ENTRY_FILE_PATTERN.exec(entryBlock)) !== null) {
          const entryPath = valueMatch[1];
          if (entryPath.startsWith("./") || entryPath.startsWith("../") || !entryPath.startsWith("/")) {
            const absoluteEntryPath = resolve(directory, entryPath);
            const resolvedEntry = resolveEntryWithExtensions(absoluteEntryPath);
            if (resolvedEntry) {
              entries.push(resolvedEntry);
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
  const htmlFiles = fg.sync(["index.html", "*.html"], {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    deep: 1,
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

const extractScriptTagsFromHtmlFile = (htmlFilePath: string): string[] => {
  const entries: string[] = [];
  try {
    const content = readFileSync(htmlFilePath, "utf-8");
    let scriptMatch: RegExpExecArray | null;
    HTML_SCRIPT_SRC_PATTERN.lastIndex = 0;
    while ((scriptMatch = HTML_SCRIPT_SRC_PATTERN.exec(content)) !== null) {
      const scriptSrc = scriptMatch[1].replace(/^\//, "");
      const htmlDirectory = dirname(htmlFilePath);
      const absoluteScriptPath = resolve(htmlDirectory, scriptSrc);
      if (existsSync(absoluteScriptPath)) {
        entries.push(absoluteScriptPath);
      }
    }
  } catch {
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
        const projectRecord = projectConfig as Record<string, unknown>;
        const architect = projectRecord.architect as Record<string, Record<string, unknown>> | undefined;
        if (architect) {
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

        const projectRoot = typeof projectRecord.root === "string" ? projectRecord.root : "";
        const projectDir = resolve(angularDir, projectRoot);
        const ngPackagePaths = fg.sync(["ng-package.json", "**/ng-package.json"], {
          cwd: projectDir,
          absolute: true,
          onlyFiles: true,
          deep: 2,
          ignore: ["**/node_modules/**"],
        });
        for (const ngPackagePath of ngPackagePaths) {
          try {
            const ngContent = readFileSync(ngPackagePath, "utf-8");
            const ngPackage = JSON.parse(ngContent);
            const ngDir = ngPackagePath.replace(/\/[^/]+$/, "");
            const libEntry = ngPackage?.lib?.entryFile;
            if (typeof libEntry === "string") {
              const absoluteEntry = resolve(ngDir, libEntry);
              if (existsSync(absoluteEntry)) {
                entries.push(absoluteEntry);
              }
            }
          } catch {}
        }
      }
    } catch {
    }
  }

  return entries;
};

const PLUGIN_FILE_ARGUMENT_PATTERN = /(?:createNextIntlPlugin|createMDX|withContentlayer|withPlaiceholder)\s*\(\s*['"]([^'"]+)['"]/g;
const NEXT_INTL_IMPORT_PATTERN = /createNextIntlPlugin/;
const NEXT_INTL_DEFAULT_PATHS = [
  "src/i18n/request.ts",
  "src/i18n/request.tsx",
  "src/i18n/request.js",
  "i18n/request.ts",
  "i18n/request.tsx",
  "i18n/request.js",
  "i18n.ts",
  "i18n.tsx",
];

const extractNextConfigPluginFiles = (directory: string): string[] => {
  const entries: string[] = [];
  const nextConfigPaths = fg.sync(["next.config.{ts,js,mjs,mts}"], {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
  });

  for (const configPath of nextConfigPaths) {
    try {
      const content = readFileSync(configPath, "utf-8");
      const configDirectory = configPath.replace(/\/[^/]+$/, "");
      let pluginMatch: RegExpExecArray | null;
      PLUGIN_FILE_ARGUMENT_PATTERN.lastIndex = 0;
      let didMatchNextIntlWithPath = false;
      while ((pluginMatch = PLUGIN_FILE_ARGUMENT_PATTERN.exec(content)) !== null) {
        const filePath = pluginMatch[1];
        const absolutePath = resolve(configDirectory, filePath);
        if (existsSync(absolutePath)) {
          entries.push(absolutePath);
        }
        if (pluginMatch[0].includes("createNextIntlPlugin")) {
          didMatchNextIntlWithPath = true;
        }
      }

      if (!didMatchNextIntlWithPath && NEXT_INTL_IMPORT_PATTERN.test(content)) {
        for (const defaultPath of NEXT_INTL_DEFAULT_PATHS) {
          const absolutePath = resolve(configDirectory, defaultPath);
          if (existsSync(absolutePath)) {
            entries.push(absolutePath);
            break;
          }
        }
      }
    } catch {
    }
  }

  return entries;
};

const VITEST_INCLUDE_ITEM_PATTERN = /['"]([^'"]+)['"]/g;
const COVERAGE_BLOCK_PATTERN = /coverage\s*:\s*\{/g;

const extractVitestIncludePatterns = (directory: string): string[] => {
  const configPaths = fg.sync([
    "vitest.config.{ts,js,mts,mjs}",
    "vitest.web.config.{ts,js,mts,mjs}",
  ], {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
  });

  const patterns: string[] = [];
  for (const configPath of configPaths) {
    try {
      const content = readFileSync(configPath, "utf-8");
      const coverageBlockRanges = findNestedBlockRanges(content, COVERAGE_BLOCK_PATTERN);
      const includePattern = /include\s*:\s*\[([^\]]*)\]/g;
      includePattern.lastIndex = 0;
      let includeMatch: RegExpExecArray | null;
      while ((includeMatch = includePattern.exec(content)) !== null) {
        const matchStart = includeMatch.index;
        const isInsideCoverageBlock = coverageBlockRanges.some(
          ([blockStart, blockEnd]) => matchStart > blockStart && matchStart < blockEnd,
        );
        if (isInsideCoverageBlock) continue;

        const arrayContent = includeMatch[1];
        VITEST_INCLUDE_ITEM_PATTERN.lastIndex = 0;
        let itemMatch: RegExpExecArray | null;
        while ((itemMatch = VITEST_INCLUDE_ITEM_PATTERN.exec(arrayContent)) !== null) {
          patterns.push(itemMatch[1]);
        }
      }
    } catch {
    }
  }
  return patterns;
};

const findNestedBlockRanges = (content: string, blockStartPattern: RegExp): [number, number][] => {
  const ranges: [number, number][] = [];
  blockStartPattern.lastIndex = 0;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockStartPattern.exec(content)) !== null) {
    const openBraceIndex = content.indexOf("{", blockMatch.index);
    if (openBraceIndex === -1) continue;
    let braceDepth = 1;
    let position = openBraceIndex + 1;
    while (position < content.length && braceDepth > 0) {
      if (content[position] === "{") braceDepth++;
      if (content[position] === "}") braceDepth--;
      position++;
    }
    ranges.push([blockMatch.index, position]);
  }
  return ranges;
};

const SETUP_FILES_PATTERN = /(?:setupFiles|setupFilesAfterEnv|globalSetup|globalTeardown)\s*:\s*(?:\[([^\]]*)\]|['"]([^'"]+)['"])/gs;
const SETUP_FILE_PATH_PATTERN = /['"]([^'"]+)['"]/g;
const MODULE_NAME_MAPPER_PATTERN = /moduleNameMapper\s*:\s*\{([^}]*)\}/gs;
const MODULE_NAME_MAPPER_VALUE_PATTERN = /<rootDir>\/([^'"]+)/g;

const extractTestSetupFiles = (directory: string): string[] => {
  const entries: string[] = [];
  const configPaths = fg.sync([
    "vitest.config.{ts,js,mts,mjs}",
    "vitest.web.config.{ts,js,mts,mjs}",
    "vite.config.{ts,js,mts,mjs}",
    "jest.config.{ts,js,mjs,cjs}",
    "**/vitest.config.{ts,js,mts,mjs}",
  ], {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
    deep: 3,
  });

  for (const configPath of configPaths) {
    try {
      const content = readFileSync(configPath, "utf-8");
      const configDirectory = configPath.replace(/\/[^/]+$/, "");
      let setupMatch: RegExpExecArray | null;
      SETUP_FILES_PATTERN.lastIndex = 0;
      while ((setupMatch = SETUP_FILES_PATTERN.exec(content)) !== null) {
        const arrayContent = setupMatch[1];
        const singleValue = setupMatch[2];

        if (singleValue) {
          const absolutePath = resolve(configDirectory, singleValue);
          if (existsSync(absolutePath)) {
            entries.push(absolutePath);
          }
        }

        if (arrayContent) {
          let pathMatch: RegExpExecArray | null;
          SETUP_FILE_PATH_PATTERN.lastIndex = 0;
          while ((pathMatch = SETUP_FILE_PATH_PATTERN.exec(arrayContent)) !== null) {
            const absolutePath = resolve(configDirectory, pathMatch[1]);
            if (existsSync(absolutePath)) {
              entries.push(absolutePath);
            }
          }
        }
      }

      let mapperMatch: RegExpExecArray | null;
      MODULE_NAME_MAPPER_PATTERN.lastIndex = 0;
      while ((mapperMatch = MODULE_NAME_MAPPER_PATTERN.exec(content)) !== null) {
        const mapperContent = mapperMatch[1];
        let valueMatch: RegExpExecArray | null;
        MODULE_NAME_MAPPER_VALUE_PATTERN.lastIndex = 0;
        while ((valueMatch = MODULE_NAME_MAPPER_VALUE_PATTERN.exec(mapperContent)) !== null) {
          const relativePath = valueMatch[1];
          const absolutePath = resolve(configDirectory, relativePath);
          if (existsSync(absolutePath)) {
            entries.push(absolutePath);
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
      entries.push(resolveEntryPath(exportValue, rootDir));
    }
    return;
  }

  if (typeof exportValue !== "object" || exportValue === null) return;

  for (const [, nestedValue] of Object.entries(exportValue as Record<string, unknown>)) {
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
    ],
    entryPatterns: [
      "**/*.test.{ts,tsx,js,jsx,mts,mjs}",
      "**/*.spec.{ts,tsx,js,jsx,mts,mjs}",
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
      "vitest.config.*.{ts,js,mts,mjs}",
      "**/vitest.config.{ts,js,mts,mjs}",
      "**/vitest.config.*.{ts,js,mts,mjs}",
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
      "specs/**/*.{ts,tsx,js,jsx}",
      "e2e/**/*.{ts,tsx,js,jsx}",
      "lib/**/*.{ts,tsx,js,jsx}",
      "support/**/*.{ts,tsx,js,jsx}",
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
      "tests/**/*.{ts,tsx,js,jsx}",
      "support/**/*.{ts,tsx,js,jsx}",
      "plugins/**/*.{ts,tsx,js,jsx}",
      "**/*.cy.{ts,tsx,js,jsx}",
    ],
    fixturePatterns: [
      "**/fixtures/**/*.{ts,tsx,js,jsx,json}",
    ],
    alwaysUsed: [
      "cypress.config.{ts,js}",
      "cypress.config.*.{ts,js}",
    ],
  },
];

interface ToolingPluginDefinition {
  enablers: string[];
  enablerPrefixes: string[];
  entryPatterns: string[];
  alwaysUsed: string[];
  contentIgnorePatterns?: string[];
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
    alwaysUsed: [
      "prisma/schema.prisma",
      "schema.prisma",
      "prisma/schema/*.prisma",
      "prisma.config.{ts,mts,cts,js,mjs,cjs}",
      ".config/prisma.{ts,mts,cts,js,mjs,cjs}",
    ],
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
      "**/*.{md,mdx}",
      "src/pages/**/*.{ts,tsx,js,jsx}",
      "src/theme/**/*.{ts,tsx,js,jsx}",
      "src/theme/**/index.{ts,tsx,js,jsx}",
      "plugins/**/*.{ts,js,mjs}",
    ],
    alwaysUsed: [
      "docusaurus.config.{ts,js,mjs}",
      "sidebars.{ts,js,mjs,cjs}",
      "sidebar*.{ts,js,mjs,cjs}",
      "*-sidebar.{ts,js,mjs,cjs}",
      "*-sidebars.{ts,js,mjs,cjs}",
      "*Sidebar*.{ts,js,mjs,cjs}",
      "*sidebar*.{ts,js,mjs,cjs}",
    ],
    contentIgnorePatterns: [
      "versioned_sidebars/**",
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
    enablers: ["next"],
    enablerPrefixes: [],
    entryPatterns: [
      "middleware.{ts,js}",
      "src/middleware.{ts,js}",
      "proxy.{ts,js}",
      "src/proxy.{ts,js}",
      "instrumentation.{ts,js}",
      "instrumentation-client.{ts,js}",
      "src/instrumentation.{ts,js}",
      "src/instrumentation-client.{ts,js}",
    ],
    alwaysUsed: [
      "next.config.{ts,js,mjs,mts}",
      "next-env.d.ts",
      "mdx-components.{ts,tsx,js,jsx}",
      "src/mdx-components.{ts,tsx,js,jsx}",
      "src/i18n/request.{ts,js}",
      "src/i18n/routing.{ts,js}",
      "i18n/request.{ts,js}",
      "i18n/routing.{ts,js}",
    ],
  },
  {
    enablers: ["@tanstack/react-router", "@tanstack/react-start", "@tanstack/start", "@tanstack/solid-router", "@tanstack/solid-start"],
    enablerPrefixes: ["@tanstack/router"],
    entryPatterns: [
      "src/routes/**/*.{ts,tsx,js,jsx}",
      "app/routes/**/*.{ts,tsx,js,jsx}",
      "src/server.{ts,tsx,js,jsx}",
      "src/client.{ts,tsx,js,jsx}",
      "src/router.{ts,tsx,js,jsx}",
      "src/routeTree.gen.{ts,js}",
    ],
    alwaysUsed: ["tsr.config.json", "app.config.{ts,js}"],
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
    alwaysUsed: ["rollup.config.{ts,js,mjs,cjs}", "rollup.*.config.{ts,js,mjs,cjs}"],
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
    enablers: ["sanity", "@sanity/cli"],
    enablerPrefixes: ["@sanity/"],
    entryPatterns: [],
    alwaysUsed: [
      "sanity.config.{ts,js}",
      "sanity.cli.{ts,js}",
    ],
  },
  {
    enablers: ["astro"],
    enablerPrefixes: ["@astrojs/"],
    entryPatterns: [
      "src/pages/**/*.{astro,ts,tsx,js,jsx,md,mdx}",
      "src/content/**/*.{ts,js,md,mdx}",
      "src/layouts/**/*.astro",
      "src/middleware.{js,ts,mjs,mts,cjs,cts}",
      "src/middleware/index.{js,ts,mjs,mts,cjs,cts}",
    ],
    alwaysUsed: ["astro.config.{ts,js,mjs,cjs}"],
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
    enablers: ["wrangler"],
    enablerPrefixes: ["@cloudflare/"],
    entryPatterns: [
      "src/index.{ts,js}",
      "src/worker.{ts,js}",
      "functions/**/*.{ts,js}",
    ],
    alwaysUsed: ["wrangler.toml", "wrangler.json", "wrangler.jsonc"],
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



interface TestRunnerDiscoveryResult {
  entryFiles: string[];
  alwaysUsedFiles: string[];
}

const discoverTestRunnerEntryPoints = (
  rootDir: string,
  workspacePackages: WorkspacePackage[],
): TestRunnerDiscoveryResult => {
  const allEntries: string[] = [];
  const allAlwaysUsed: string[] = [];
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
        return enabler in dependencies;
      });
      if (hasDependency) return true;
      return runner.configFileActivators.some((configFile) => existsSync(join(checkDirectory, configFile)));
    };

    for (const runner of TEST_RUNNER_DEFINITIONS) {
      if (isRunnerEnabled(runner, allDependencies, directory)) {
        const isVitestRunner = runner.enablers.includes("vitest");
        const customIncludePatterns = isVitestRunner
          ? extractVitestIncludePatterns(directory)
          : [];
        if (customIncludePatterns.length > 0) {
          activatedPatterns.push(...customIncludePatterns);
        } else {
          activatedPatterns.push(...runner.entryPatterns);
        }
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
    const hasBunTestScript = detectBunTestRunner(directory) || detectBunTestRunner(rootDir);
    if (hasNodeTestScript || hasBunTestScript) {
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
      ignore: ["**/node_modules/**", "**/*.gen.{ts,tsx,js,jsx}"],
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
      allAlwaysUsed.push(...alwaysUsedFiles);
    }
  }

  return { entryFiles: allEntries, alwaysUsedFiles: allAlwaysUsed };
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

interface ToolingDiscoveryResult {
  entryFiles: string[];
  alwaysUsedFiles: string[];
}

const discoverToolingEntryPoints = (
  rootDir: string,
  workspacePackages: WorkspacePackage[],
): ToolingDiscoveryResult => {
  const allEntries: string[] = [];
  const allAlwaysUsed: string[] = [];
  const directoriesToCheck = [rootDir, ...workspacePackages.map((workspacePackage) => workspacePackage.directory)];

  let rootDependencies: Record<string, string> = {};
  const rootPackageJsonPath = join(rootDir, "package.json");
  if (existsSync(rootPackageJsonPath)) {
    try {
      const rootContent = readFileSync(rootPackageJsonPath, "utf-8");
      const rootPackageJson = JSON.parse(rootContent);
      rootDependencies = {
        ...rootPackageJson.dependencies,
        ...rootPackageJson.devDependencies,
      };
    } catch {
    }
  }

  for (const directory of directoriesToCheck) {
    const packageJsonPath = join(directory, "package.json");
    if (!existsSync(packageJsonPath)) continue;

    let workspaceDependencies: Record<string, string> = {};
    try {
      const content = readFileSync(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(content);
      workspaceDependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };
    } catch {
      continue;
    }

    const mergedDependencies = directory === rootDir
      ? rootDependencies
      : { ...rootDependencies, ...workspaceDependencies };

    const activatedPatterns: string[] = [];
    const activatedAlwaysUsed: string[] = [];

    for (const plugin of TOOLING_PLUGIN_DEFINITIONS) {
      if (isToolingPluginEnabled(plugin, mergedDependencies)) {
        activatedPatterns.push(...plugin.entryPatterns);
        activatedAlwaysUsed.push(...plugin.alwaysUsed);
      }
    }

    if (activatedPatterns.length === 0 && activatedAlwaysUsed.length === 0) continue;

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
      allAlwaysUsed.push(...alwaysUsedFiles);
    }
  }

  const rootActivatedGlobalPatterns: string[] = [];
  for (const plugin of TOOLING_PLUGIN_DEFINITIONS) {
    if (isToolingPluginEnabled(plugin, rootDependencies)) {
      for (const pattern of plugin.alwaysUsed) {
        if (!pattern.startsWith("**/")) {
          rootActivatedGlobalPatterns.push(`**/${pattern}`);
        }
      }
    }
  }

  if (rootActivatedGlobalPatterns.length > 0) {
    const globalAlwaysUsedFiles = fg.sync([...new Set(rootActivatedGlobalPatterns)], {
      cwd: rootDir,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**"],
      dot: true,
    });
    allAlwaysUsed.push(...globalAlwaysUsedFiles);
  }

  return { entryFiles: allEntries, alwaysUsedFiles: allAlwaysUsed };
};
