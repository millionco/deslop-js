import { resolve, join, dirname } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import fg from "fast-glob";
import type { DependencyGraph, UnusedDependency, DeslopConfig } from "../types.js";
import { IMPLICIT_DEPENDENCIES } from "../constants.js";
import { extractPackageName } from "../utils/package-name.js";

interface PackageJsonDependencies {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const MONOREPO_ROOT_MARKERS = [
  "pnpm-workspace.yaml",
  "pnpm-workspace.yml",
  "lerna.json",
  "nx.json",
  "turbo.json",
  "rush.json",
];

const LOCKFILE_MARKERS = [
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  "bun.lockb",
  "bun.lock",
];

const MAX_MONOREPO_WALK_DEPTH = 5;

const findMonorepoRoot = (rootDir: string): string | undefined => {
  let currentDirectory = resolve(rootDir);
  let walkedDepth = 0;

  while (walkedDepth < MAX_MONOREPO_WALK_DEPTH) {
    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) break;
    currentDirectory = parentDirectory;
    walkedDepth++;

    if (existsSync(join(currentDirectory, ".git"))) {
      for (const marker of MONOREPO_ROOT_MARKERS) {
        if (existsSync(join(currentDirectory, marker))) return currentDirectory;
      }

      const packageJsonPath = join(currentDirectory, "package.json");
      if (existsSync(packageJsonPath)) {
        try {
          const content = readFileSync(packageJsonPath, "utf-8");
          const packageJson = JSON.parse(content);
          if (packageJson.workspaces) return currentDirectory;
        } catch {
          // fall through
        }
      }

      for (const lockfile of LOCKFILE_MARKERS) {
        if (existsSync(join(currentDirectory, lockfile))) return currentDirectory;
      }

      return undefined;
    }

    for (const marker of MONOREPO_ROOT_MARKERS) {
      if (existsSync(join(currentDirectory, marker))) return currentDirectory;
    }

    const packageJsonPath = join(currentDirectory, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const content = readFileSync(packageJsonPath, "utf-8");
        const packageJson = JSON.parse(content);
        if (packageJson.workspaces) return currentDirectory;
      } catch {
        continue;
      }
    }

    for (const lockfile of LOCKFILE_MARKERS) {
      if (existsSync(join(currentDirectory, lockfile))) return currentDirectory;
    }
  }

  return undefined;
};

const discoverAllPackageJsonPaths = (rootDir: string): string[] => {
  const paths = [join(rootDir, "package.json")];
  const workspacePackageJsons = fg.sync("**/package.json", {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"],
    deep: 5,
  });
  for (const workspacePath of workspacePackageJsons) {
    if (workspacePath !== paths[0] && !paths.includes(workspacePath)) {
      paths.push(workspacePath);
    }
  }
  return paths;
};

export const detectStalePackages = (
  graph: DependencyGraph,
  config: DeslopConfig,
): UnusedDependency[] => {
  const packageJsonPath = resolve(config.rootDir, "package.json");
  let packageJson: PackageJsonDependencies;

  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    packageJson = JSON.parse(content);
  } catch {
    return [];
  }

  const dependencies = packageJson.dependencies ?? {};
  const devDependencies = packageJson.devDependencies ?? {};

  const declaredDependencies = new Map<string, boolean>();
  for (const dependencyName of Object.keys(dependencies)) {
    declaredDependencies.set(dependencyName, false);
  }
  for (const dependencyName of Object.keys(devDependencies)) {
    declaredDependencies.set(dependencyName, true);
  }

  const declaredNames = new Set(declaredDependencies.keys());
  const usedPackageNames = collectUsedPackages(graph);

  const monorepoRoot = findMonorepoRoot(config.rootDir);
  const nodeModulesRoot = monorepoRoot ?? config.rootDir;

  const allPackageJsonPaths = discoverAllPackageJsonPaths(config.rootDir);
  if (monorepoRoot) {
    const monorepoPackageJson = join(monorepoRoot, "package.json");
    if (!allPackageJsonPaths.includes(monorepoPackageJson) && existsSync(monorepoPackageJson)) {
      allPackageJsonPaths.push(monorepoPackageJson);
    }
  }

  const binToPackage = buildBinToPackageMap(nodeModulesRoot, declaredNames);

  for (const workspacePackageJsonPath of allPackageJsonPaths) {
    const scriptReferenced = collectScriptReferencedPackages(
      workspacePackageJsonPath,
      declaredNames,
      binToPackage,
    );
    for (const packageName of scriptReferenced) usedPackageNames.add(packageName);

    const packageJsonConfigReferenced = collectPackageJsonConfigReferences(
      workspacePackageJsonPath,
      declaredNames,
    );
    for (const packageName of packageJsonConfigReferenced) usedPackageNames.add(packageName);
  }

  const configSearchRoots =
    monorepoRoot && monorepoRoot !== config.rootDir
      ? [config.rootDir, monorepoRoot]
      : [config.rootDir];
  for (const configSearchRoot of configSearchRoots) {
    const configReferenced = collectConfigReferencedPackages(
      configSearchRoot,
      graph,
      declaredNames,
    );
    for (const packageName of configReferenced) usedPackageNames.add(packageName);

    const tsconfigReferenced = collectTsconfigReferencedPackages(configSearchRoot);
    for (const packageName of tsconfigReferenced) usedPackageNames.add(packageName);
  }

  if (hasJsxFiles(graph)) {
    if (declaredNames.has("react")) usedPackageNames.add("react");
    if (declaredNames.has("react-dom")) usedPackageNames.add("react-dom");
    if (declaredNames.has("react-native")) usedPackageNames.add("react-native");
    if (declaredNames.has("react-native-web")) usedPackageNames.add("react-native-web");
  }

  const peerSatisfied = collectPeerSatisfiedPackages(
    nodeModulesRoot,
    declaredNames,
    usedPackageNames,
  );
  for (const packageName of peerSatisfied) usedPackageNames.add(packageName);

  const candidateUnused = new Set<string>();
  for (const [dependencyName] of declaredDependencies) {
    if (isAlwaysConsideredUsed(dependencyName)) continue;
    if (usedPackageNames.has(dependencyName)) continue;
    candidateUnused.add(dependencyName);
  }

  if (candidateUnused.size > 0) {
    const sourceFileRescued = scanSourceFilesForPackageImports(config.rootDir, candidateUnused);
    for (const packageName of sourceFileRescued) {
      usedPackageNames.add(packageName);
      candidateUnused.delete(packageName);
    }
  }

  const unusedDependencies: UnusedDependency[] = [];

  for (const dependencyName of candidateUnused) {
    const isDevDependency = declaredDependencies.get(dependencyName) ?? false;
    unusedDependencies.push({
      name: dependencyName,
      isDevDependency,
    });
  }

  return unusedDependencies;
};

const collectUsedPackages = (graph: DependencyGraph): Set<string> => {
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

const hasJsxFiles = (graph: DependencyGraph): boolean =>
  graph.modules.some((module) => {
    const filePath = module.fileId.path;
    return filePath.endsWith(".tsx") || filePath.endsWith(".jsx");
  });

const collectPeerSatisfiedPackages = (
  rootDir: string,
  declaredNames: Set<string>,
  confirmedUsedNames: Set<string>,
): Set<string> => {
  const peerSatisfied = new Set<string>();
  const nodeModulesDir = join(rootDir, "node_modules");

  for (const installedName of declaredNames) {
    if (!confirmedUsedNames.has(installedName)) continue;

    const packageJsonPath = installedName.startsWith("@")
      ? join(nodeModulesDir, ...installedName.split("/"), "package.json")
      : join(nodeModulesDir, installedName, "package.json");
    try {
      const content = readFileSync(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(content);
      const peerDeps = packageJson.peerDependencies;
      if (peerDeps && typeof peerDeps === "object") {
        for (const peerName of Object.keys(peerDeps)) {
          if (declaredNames.has(peerName)) {
            peerSatisfied.add(peerName);
          }
        }
      }
    } catch {
      continue;
    }
  }

  return peerSatisfied;
};

const SHELL_SPLIT_PATTERN = /\s*(?:&&|\|\||[;&|])\s*/;

const CLI_BINARY_TO_PACKAGE: Record<string, string> = {
  "react-scripts": "react-scripts",
  "webpack-cli": "webpack-cli",
  "webpack-dev-server": "webpack-dev-server",
  vitest: "vitest",
  jest: "jest",
  prisma: "prisma",
  sequelize: "sequelize-cli",
  rimraf: "rimraf",
  concurrently: "concurrently",
  parcel: "parcel",
  rescript: "rescript",
  webstudio: "webstudio",
  cap: "@capacitor/cli",
  "source-map-explorer": "source-map-explorer",
  "ts-standard": "ts-standard",
  "rndebugger-open": "react-native-debugger-open",
  "simple-git-hooks": "simple-git-hooks",
  "generate-arg-types": "@webstudio-is/generate-arg-types",
  email: "@react-email/preview-server",
};

const ENV_WRAPPER_BINARY_SET = new Set(["cross-env", "dotenv", "dotenv-flow", "env-cmd"]);

const INLINE_ENV_VAR_PATTERN = /^[A-Z_][A-Z0-9_]*=/;

const buildBinToPackageMap = (rootDir: string, declaredNames: Set<string>): Map<string, string> => {
  const binToPackage = new Map<string, string>();
  for (const [binary, packageName] of Object.entries(CLI_BINARY_TO_PACKAGE)) {
    binToPackage.set(binary, packageName);
  }
  for (const packageName of declaredNames) {
    const packageBinJsonPath = packageName.startsWith("@")
      ? join(rootDir, "node_modules", ...packageName.split("/"), "package.json")
      : join(rootDir, "node_modules", packageName, "package.json");
    try {
      const binContent = readFileSync(packageBinJsonPath, "utf-8");
      const binPackageJson = JSON.parse(binContent);
      if (typeof binPackageJson.bin === "string") {
        binToPackage.set(packageName.split("/").pop()!, packageName);
      } else if (typeof binPackageJson.bin === "object" && binPackageJson.bin !== null) {
        for (const binaryName of Object.keys(binPackageJson.bin)) {
          binToPackage.set(binaryName, packageName);
        }
      }
    } catch {
      continue;
    }
  }
  return binToPackage;
};

const collectScriptReferencedPackages = (
  packageJsonPath: string,
  declaredNames: Set<string>,
  binToPackage: Map<string, string>,
): Set<string> => {
  const referenced = new Set<string>();

  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);
    const scripts = packageJson.scripts;
    if (!scripts || typeof scripts !== "object") return referenced;

    for (const scriptCommand of Object.values(scripts)) {
      if (typeof scriptCommand !== "string") continue;

      const segments = scriptCommand.split(SHELL_SPLIT_PATTERN);
      for (const segment of segments) {
        const tokens = segment.trim().split(/\s+/);
        if (tokens.length === 0) continue;

        let binaryIndex = 0;
        const firstToken = tokens[0].replace(/^.*\//, "");
        if (ENV_WRAPPER_BINARY_SET.has(firstToken)) {
          const envPackage = binToPackage.get(firstToken);
          if (envPackage && declaredNames.has(envPackage)) referenced.add(envPackage);
          binaryIndex = 1;
          while (binaryIndex < tokens.length && INLINE_ENV_VAR_PATTERN.test(tokens[binaryIndex])) {
            binaryIndex++;
          }
          if (binaryIndex >= tokens.length) continue;
        }

        while (binaryIndex < tokens.length && INLINE_ENV_VAR_PATTERN.test(tokens[binaryIndex])) {
          binaryIndex++;
        }
        if (binaryIndex >= tokens.length) continue;

        const binaryToken = tokens[binaryIndex].replace(/^.*\//, "");
        const effectiveBinary =
          binaryToken === "npx" || binaryToken === "pnpx" || binaryToken === "bunx"
            ? (tokens[binaryIndex + 1]?.replace(/^.*\//, "") ?? "")
            : binaryToken;

        for (const candidateBinary of [binaryToken, effectiveBinary]) {
          if (!candidateBinary) continue;
          const mappedPackage = binToPackage.get(candidateBinary);
          if (mappedPackage && declaredNames.has(mappedPackage)) {
            referenced.add(mappedPackage);
          }
          if (declaredNames.has(candidateBinary)) {
            referenced.add(candidateBinary);
          }
        }
      }
    }
  } catch {
    return referenced;
  }

  return referenced;
};

const CONFIG_FILE_GLOBS = [
  "postcss.config.{js,cjs,mjs,ts}",
  ".babelrc",
  ".babelrc.{js,cjs,mjs,json}",
  "babel.config.{js,cjs,mjs,json,ts}",
  ".eslintrc",
  ".eslintrc.{js,cjs,mjs,json,yaml,yml}",
  "eslint.config.{js,cjs,mjs,ts,mts,cts}",
  "webpack.config.{js,ts,mjs,cjs}",
  "**/webpack*.config.{js,ts,mjs,cjs}",
  "**/webpack*.config*.{js,ts,mjs,cjs}",
  "**/webpack*.babel.{js,ts}",
  "vite.config.{js,ts,mjs,mts}",
  "rollup.config.{js,ts,mjs,cjs}",
  ".storybook/main.{js,ts,mjs,cjs}",
  ".storybook/preview.{js,ts,mjs,cjs,tsx,jsx}",
  "docusaurus.config.{js,ts,mjs}",
  "next.config.{js,ts,mjs,mts}",
  "tailwind.config.{js,ts,cjs,mjs}",
  "jest.config.{js,ts,mjs,cjs}",
  "vitest.config.{js,ts,mjs,mts}",
  "app.json",
  "forge.config.{js,ts,cjs}",
  "wrangler.toml",
  "wrangler.json",
  "wrangler.jsonc",
  "metro.config.{js,ts}",
  "electron.vite.config.{js,ts,mjs}",
  "api-extractor.json",
  "codegen.{ts,js,yml,yaml}",
  ".graphqlrc.{ts,js,json,yml,yaml}",
  "graphql.config.{ts,js,json,yml,yaml}",
  ".lintstagedrc.{js,cjs,mjs,json}",
  "commitlint.config.{js,cjs,mjs,ts}",
  ".commitlintrc.{js,cjs,mjs,json,yaml,yml}",
  "tslint.json",
];

const collectConfigReferencedPackages = (
  rootDir: string,
  graph: DependencyGraph,
  declaredNames: Set<string>,
): Set<string> => {
  const referenced = new Set<string>();

  for (const module of graph.modules) {
    if (!module.isConfigFile) continue;
    try {
      const content = readFileSync(module.fileId.path, "utf-8");
      for (const packageName of declaredNames) {
        if (content.includes(packageName)) {
          referenced.add(packageName);
        }
      }
    } catch {
      continue;
    }
  }

  const configFiles = fg.sync(CONFIG_FILE_GLOBS, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
    dot: true,
    deep: 3,
  });

  for (const configPath of configFiles) {
    try {
      const content = readFileSync(configPath, "utf-8");
      for (const packageName of declaredNames) {
        if (content.includes(packageName)) {
          referenced.add(packageName);
        }
      }
    } catch {
      continue;
    }
  }

  return referenced;
};

const PACKAGE_JSON_CONFIG_SECTIONS = [
  "jest",
  "babel",
  "eslintConfig",
  "prettier",
  "stylelint",
  "lint-staged",
  "commitlint",
  "browserslist",
  "postcss",
  "ava",
] as const;

const collectPackageJsonConfigReferences = (
  packageJsonPath: string,
  declaredNames: Set<string>,
): Set<string> => {
  const referenced = new Set<string>();

  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);

    for (const sectionName of PACKAGE_JSON_CONFIG_SECTIONS) {
      const sectionValue = packageJson[sectionName];
      if (!sectionValue || typeof sectionValue !== "object") continue;

      const sectionText = JSON.stringify(sectionValue);
      for (const packageName of declaredNames) {
        if (sectionText.includes(packageName)) {
          referenced.add(packageName);
        }
      }
    }
  } catch {
    return referenced;
  }

  return referenced;
};

const TSCONFIG_GLOBS = [
  "tsconfig.json",
  "tsconfig.*.json",
  "jsconfig.json",
  "**/tsconfig.json",
  "**/tsconfig.*.json",
];

const collectTsconfigReferencedPackages = (rootDir: string): Set<string> => {
  const referenced = new Set<string>();

  const tsconfigFiles = fg.sync(TSCONFIG_GLOBS, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
    dot: false,
    deep: 4,
  });

  for (const tsconfigPath of tsconfigFiles) {
    try {
      const content = readFileSync(tsconfigPath, "utf-8");
      const cleaned = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      const parsed = JSON.parse(cleaned);

      if (typeof parsed.extends === "string") {
        const extendsPackage = extractExtendsPackageName(parsed.extends);
        if (extendsPackage) referenced.add(extendsPackage);
      }
      if (Array.isArray(parsed.extends)) {
        for (const extendsEntry of parsed.extends) {
          if (typeof extendsEntry === "string") {
            const extendsPackage = extractExtendsPackageName(extendsEntry);
            if (extendsPackage) referenced.add(extendsPackage);
          }
        }
      }

      const compilerOptions = parsed.compilerOptions;
      if (compilerOptions?.jsxImportSource && typeof compilerOptions.jsxImportSource === "string") {
        referenced.add(compilerOptions.jsxImportSource);
      }
      if (Array.isArray(compilerOptions?.types)) {
        for (const typesEntry of compilerOptions.types) {
          if (typeof typesEntry === "string") {
            const typesPackage = extractPackageName(typesEntry);
            if (typesPackage) referenced.add(typesPackage);
          }
        }
      }
    } catch {
      continue;
    }
  }

  return referenced;
};

const extractExtendsPackageName = (extendsValue: string): string | undefined => {
  if (extendsValue.startsWith(".") || extendsValue.startsWith("/")) return undefined;
  if (extendsValue.startsWith("@")) {
    const parts = extendsValue.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined;
  }
  return extendsValue.split("/")[0];
};

const SOURCE_FILE_GLOBS = ["**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}"];

const SOURCE_FILE_IGNORES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.git/**",
  "**/coverage/**",
  "**/*.min.js",
  "**/*.d.ts",
];

const scanSourceFilesForPackageImports = (
  rootDir: string,
  candidatePackages: Set<string>,
): Set<string> => {
  const found = new Set<string>();
  if (candidatePackages.size === 0) return found;

  const sourceFiles = fg.sync(SOURCE_FILE_GLOBS, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: SOURCE_FILE_IGNORES,
    deep: 15,
  });

  for (const filePath of sourceFiles) {
    if (candidatePackages.size === 0) break;
    try {
      const content = readFileSync(filePath, "utf-8");
      for (const packageName of candidatePackages) {
        if (
          content.includes(`'${packageName}'`) ||
          content.includes(`"${packageName}"`) ||
          content.includes(`'${packageName}/`) ||
          content.includes(`"${packageName}/`)
        ) {
          found.add(packageName);
          candidatePackages.delete(packageName);
        }
      }
    } catch {
      continue;
    }
  }

  return found;
};

const ALWAYS_USED_PREFIXES = [
  "@types/",
  "eslint-config-",
  "eslint-plugin-",
  "@eslint/",
  "prettier-plugin-",
  "@commitlint/",
  "babel-plugin-",
  "babel-preset-",
  "@babel/plugin-",
  "@babel/preset-",
  "@fontsource/",
  "@next/",
  "@svgr/",
  "@docusaurus/",
  "stylelint-config-",
  "stylelint-plugin-",
  "@testing-library/",
  "@vitest/",
  "@playwright/",
  "@storybook/",
  "jest-environment-",
  "@graphql-codegen/",
  "@size-limit/",
  "@nestjs/",
  "@swc/",
  "@electron-forge/",
  "@parcel/",
  "@wyw-in-js/",
  "@typescript-eslint/",
  "@react-native/",
  "@react-native-community/",
  "postcss-",
  "@tailwindcss/",
  "rollup-plugin-",
  "vite-plugin-",
  "@vitejs/",
  "webpack-",
  "esbuild-",
  "@esbuild-plugins/",
  "@lingui/",
  "@emotion/",
  "tslint-config-",
  "eslint-import-resolver-",
  "@changesets/",
  "@react-navigation/",
  "@vercel/",
  "@expo/",
  "expo-",
  "react-native-",
];

const ALWAYS_USED_SUFFIXES = ["-loader"];

const isAlwaysConsideredUsed = (dependencyName: string): boolean => {
  if (IMPLICIT_DEPENDENCIES.has(dependencyName)) return true;
  if (ALWAYS_USED_PREFIXES.some((prefix) => dependencyName.startsWith(prefix))) return true;
  if (ALWAYS_USED_SUFFIXES.some((suffix) => dependencyName.endsWith(suffix))) return true;
  return false;
};
