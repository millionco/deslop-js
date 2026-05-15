import { resolve, join, relative } from "node:path";
import { readFileSync, existsSync, statSync } from "node:fs";
import fg from "fast-glob";

export interface WorkspacePackage {
  name: string;
  directory: string;
  entryFiles: string[];
  isDeclaredWorkspace: boolean;
}

export const discoverWorkspacePackages = (rootDir: string): WorkspacePackage[] => {
  const patterns = collectWorkspacePatterns(rootDir);
  const expandedDirectories = patterns.length > 0
    ? expandWorkspaceGlobs(patterns, rootDir)
    : [];

  const declaredDirectorySet = new Set(expandedDirectories);
  const implicitSubProjects = discoverImplicitSubProjects(rootDir, expandedDirectories);
  const allDirectories = [...new Set([...expandedDirectories, ...implicitSubProjects])];

  const workspacePackages: WorkspacePackage[] = [];

  for (const directory of allDirectories) {
    const packageJsonPath = join(directory, "package.json");
    if (!existsSync(packageJsonPath)) continue;

    try {
      const packageContent = readFileSync(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(packageContent);
      const packageName = packageJson.name || relative(rootDir, directory);
      const entryFiles = extractWorkspaceEntries(packageJson, directory);

      workspacePackages.push({
        name: packageName,
        directory,
        entryFiles,
        isDeclaredWorkspace: declaredDirectorySet.has(directory),
      });
    } catch {
    }
  }

  return workspacePackages;
};

const IMPLICIT_SUB_PROJECT_SEARCH_DEPTH = 3;

const discoverImplicitSubProjects = (
  rootDir: string,
  alreadyDiscoveredDirectories: string[],
): string[] => {
  const knownDirectories = new Set(alreadyDiscoveredDirectories);
  const subProjectDirectories: string[] = [];

  const subPackageJsonPaths = fg.sync("**/package.json", {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"],
    deep: IMPLICIT_SUB_PROJECT_SEARCH_DEPTH + 1,
  });

  for (const packageJsonPath of subPackageJsonPaths) {
    const directory = packageJsonPath.replace(/\/package\.json$/, "");
    if (directory === rootDir) continue;
    if (knownDirectories.has(directory)) continue;

    subProjectDirectories.push(directory);
  }

  return subProjectDirectories;
};

const collectWorkspacePatterns = (rootDir: string): string[] => {
  const patterns: string[] = [];

  const packageJsonPath = join(rootDir, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const content = readFileSync(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(content);
      if (Array.isArray(packageJson.workspaces)) {
        patterns.push(...packageJson.workspaces);
      } else if (packageJson.workspaces?.packages) {
        patterns.push(...packageJson.workspaces.packages);
      }
    } catch {
    }
  }

  const pnpmWorkspacePath = join(rootDir, "pnpm-workspace.yaml");
  if (existsSync(pnpmWorkspacePath)) {
    try {
      const content = readFileSync(pnpmWorkspacePath, "utf-8");
      const packageLines = extractPnpmWorkspacePackages(content);
      patterns.push(...packageLines);
    } catch {
    }
  }

  return patterns;
};

const extractPnpmWorkspacePackages = (yamlContent: string): string[] => {
  const packages: string[] = [];
  let inPackagesSection = false;

  for (const line of yamlContent.split("\n")) {
    const trimmedLine = line.trim();
    if (trimmedLine === "packages:") {
      inPackagesSection = true;
      continue;
    }
    if (inPackagesSection) {
      if (trimmedLine.startsWith("- ")) {
        const pattern = trimmedLine
          .slice(2)
          .trim()
          .replace(/^["']|["']$/g, "");
        if (pattern && !pattern.startsWith("!")) {
          packages.push(pattern);
        }
      } else if (trimmedLine && !trimmedLine.startsWith("#")) {
        break;
      }
    }
  }

  return packages;
};

const expandWorkspaceGlobs = (
  patterns: string[],
  rootDir: string,
): string[] => {
  const directories: string[] = [];

  for (const pattern of patterns) {
    if (pattern.includes("*")) {
      const globPattern = pattern.endsWith("/")
        ? `${pattern}package.json`
        : `${pattern}/package.json`;
      try {
        const matchedFiles = fg.sync(globPattern, {
          cwd: rootDir,
          absolute: true,
          onlyFiles: true,
        });
        for (const matchedPath of matchedFiles) {
          directories.push(matchedPath.replace(/\/package\.json$/, ""));
        }
      } catch {
      }
    } else {
      const absoluteDirectory = resolve(rootDir, pattern);
      if (existsSync(join(absoluteDirectory, "package.json"))) {
        directories.push(absoluteDirectory);
      }
    }
  }

  return [...new Set(directories)];
};

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs"];

const OUTPUT_DIR_PREFIXES = [
  "dist/", "build/", "lib/", "lib-dist/", "esm/", "cjs/", "out/",
  "./dist/", "./lib-dist/",
];
const SOURCE_INDEX_FALLBACK_STEMS = ["src/index", "src/main", "index", "main"];

const resolveSourcePath = (distPath: string, directory: string): string[] => {
  const candidates: string[] = [distPath];

  const relativeToDist = relative(directory, distPath);
  const sourceVariants = OUTPUT_DIR_PREFIXES
    .map((prefix) => relativeToDist.replace(new RegExp(`^${prefix.replace(".", "\\.")}`), "src/"))
    .filter((variant) => variant !== relativeToDist);

  for (const variant of sourceVariants) {
    const withoutExtension = variant.replace(/\.[^.]+$/, "");
    for (const sourceExtension of SOURCE_EXTENSIONS) {
      const sourceCandidate = resolve(directory, withoutExtension + sourceExtension);
      if (existsSync(sourceCandidate)) {
        candidates.push(sourceCandidate);
      }
    }
  }

  const isOutputDirEntry = OUTPUT_DIR_PREFIXES.some((prefix) => relativeToDist.startsWith(prefix));
  if (isOutputDirEntry && candidates.length === 1) {
    for (const stem of SOURCE_INDEX_FALLBACK_STEMS) {
      for (const sourceExtension of SOURCE_EXTENSIONS) {
        const fallbackCandidate = resolve(directory, stem + sourceExtension);
        if (existsSync(fallbackCandidate)) {
          candidates.push(fallbackCandidate);
          return candidates;
        }
      }
    }
  }

  return candidates;
};

const extractWorkspaceEntries = (
  packageJson: Record<string, unknown>,
  directory: string,
): string[] => {
  const entries: string[] = [];

  const addWithSourceResolution = (filePath: string) => {
    const resolved = resolve(directory, filePath);
    entries.push(resolved);
    const sourceVariants = resolveSourcePath(resolved, directory);
    entries.push(...sourceVariants);
  };

  const entryFields = ["main", "module", "browser", "types", "typings", "source"];
  for (const field of entryFields) {
    const fieldValue = packageJson[field];
    if (typeof fieldValue === "string") {
      addWithSourceResolution(fieldValue);
    }
  }

  if (packageJson.exports) {
    const exportPaths: string[] = [];
    collectExportPaths(packageJson.exports, directory, exportPaths);
    for (const exportPath of exportPaths) {
      entries.push(exportPath);
      const sourceVariants = resolveSourcePath(exportPath, directory);
      entries.push(...sourceVariants);
    }
  }

  if (packageJson.bin) {
    if (typeof packageJson.bin === "string") {
      addWithSourceResolution(packageJson.bin);
    } else if (typeof packageJson.bin === "object" && packageJson.bin !== null) {
      for (const binPath of Object.values(packageJson.bin)) {
        if (typeof binPath === "string") {
          addWithSourceResolution(binPath);
        }
      }
    }
  }

  const defaultEntryFiles = [
    "src/index.ts",
    "src/index.tsx",
    "src/index.js",
    "src/index.jsx",
    "src/main.ts",
    "src/main.tsx",
    "src/main.js",
    "src/main.jsx",
    "src/app.ts",
    "src/app.tsx",
    "src/app.js",
    "src/app.jsx",
    "src/server.ts",
    "src/server.js",
    "index.ts",
    "index.tsx",
    "index.js",
    "index.jsx",
    "main.ts",
    "main.tsx",
    "main.js",
    "main.jsx",
    "app.ts",
    "app.tsx",
    "app.js",
    "app.jsx",
    "server.ts",
    "server.js",
    "server.tsx",
  ];

  for (const defaultEntry of defaultEntryFiles) {
    const absolutePath = resolve(directory, defaultEntry);
    if (existsSync(absolutePath)) {
      entries.push(absolutePath);
    }
  }

  return [...new Set(entries)];
};

const collectExportPaths = (
  exportValue: unknown,
  rootDir: string,
  entries: string[],
): void => {
  if (typeof exportValue === "string") {
    if (exportValue.startsWith(".")) {
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
        }
      } else {
        entries.push(resolve(rootDir, exportValue));
      }
    }
    return;
  }

  if (typeof exportValue !== "object" || exportValue === null) return;

  for (const nestedValue of Object.values(exportValue)) {
    collectExportPaths(nestedValue, rootDir, entries);
  }
};

const NEXTJS_APP_ROUTER_CONVENTIONS = [
  "page", "layout", "loading", "error", "not-found",
  "template", "default", "route", "global-error",
  "middleware", "instrumentation", "manifest", "robots",
  "sitemap", "opengraph-image", "twitter-image", "icon",
  "apple-icon", "actions",
];

const FRAMEWORK_FILE_GLOB = "**/*.{ts,tsx,js,jsx,mdx,mjs,cjs,astro}";

export const discoverFrameworkEntryPoints = (rootDir: string): string[] => {
  const entryPoints: string[] = [];

  const allFileDirs = [
    join(rootDir, "pages"),
    join(rootDir, "src", "pages"),
    join(rootDir, "src", "routes"),
    join(rootDir, "routes"),
    join(rootDir, "src", "layouts"),
    join(rootDir, "layouts"),
  ];

  for (const frameworkDir of allFileDirs) {
    if (existsSync(frameworkDir) && statSync(frameworkDir).isDirectory()) {
      const frameworkFiles = fg.sync(FRAMEWORK_FILE_GLOB, {
        cwd: frameworkDir,
        absolute: true,
        onlyFiles: true,
        ignore: ["**/node_modules/**"],
      });
      entryPoints.push(...frameworkFiles);
    }
  }

  const appRouterConventionGlob = NEXTJS_APP_ROUTER_CONVENTIONS
    .map((convention) => `**/${convention}.{ts,tsx,js,jsx,mdx}`)
    .join(",");

  const appDirs = [
    join(rootDir, "app"),
    join(rootDir, "src", "app"),
  ];

  for (const appDir of appDirs) {
    if (existsSync(appDir) && statSync(appDir).isDirectory()) {
      const conventionFiles = fg.sync(`{${appRouterConventionGlob}}`, {
        cwd: appDir,
        absolute: true,
        onlyFiles: true,
        ignore: ["**/node_modules/**"],
      });
      entryPoints.push(...conventionFiles);
    }
  }

  const storyPatterns = [
    "**/*.stories.{ts,tsx,js,jsx,mts,mjs}",
    "**/*.story.{ts,tsx,js,jsx,mts,mjs}",
    ".storybook/**/*.{ts,tsx,js,jsx,mts,mjs}",
  ];

  const storyFiles = fg.sync(storyPatterns, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
    dot: true,
  });
  entryPoints.push(...storyFiles);

  const configPatterns = [
    "*.config.{ts,tsx,js,jsx,mjs,cjs}",
    ".*.{ts,tsx,js,jsx,mjs,cjs}",
    "tailwind.config.*",
    "postcss.config.*",
    "next.config.*",
    "vite.config.*",
    "vitest.config.*",
    "vitest.workspace.*",
    "astro.config.*",
    "nuxt.config.*",
    "svelte.config.*",
    "webpack.config.*",
    "rollup.config.*",
    "jest.config.*",
    "babel.config.*",
    "playwright.config.*",
    "drizzle.config.*",
    "knip.config.*",
    "contentlayer.config.*",
    "source.config.*",
    "eslint.config.*",
    ".eslintrc.*",
    "prettier.config.*",
    ".prettierrc.*",
    "middleware.{ts,tsx,js,jsx}",
    "src/middleware.{ts,tsx,js,jsx}",
    "instrumentation.{ts,tsx,js,jsx}",
    "instrumentation-client.{ts,tsx,js,jsx}",
    "src/instrumentation.{ts,tsx,js,jsx}",
    "src/instrumentation-client.{ts,tsx,js,jsx}",
    "env.{ts,js,mjs}",
    "src/env.{ts,js,mjs}",
    "src/routeTree.gen.{ts,tsx}",
    "src/router.{ts,tsx}",
    "src/entry-client.{ts,tsx,js,jsx}",
    "src/entry-server.{ts,tsx,js,jsx}",
    "src/entry.client.{ts,tsx,js,jsx}",
    "src/entry.server.{ts,tsx,js,jsx}",
    "src/root.{ts,tsx,js,jsx}",
    "app/entry.client.{ts,tsx,js,jsx}",
    "app/entry.server.{ts,tsx,js,jsx}",
    "app/root.{ts,tsx,js,jsx}",
  ];

  const configFiles = fg.sync(configPatterns, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
    dot: true,
  });
  entryPoints.push(...configFiles);

  const alwaysEntryDirs = ["e2e", "cypress", ".github", "migrations", "db/migrations", "db/seeds"];
  for (const entryDir of alwaysEntryDirs) {
    const dirPath = join(rootDir, entryDir);
    if (existsSync(dirPath) && statSync(dirPath).isDirectory()) {
      const dirFiles = fg.sync(FRAMEWORK_FILE_GLOB, {
        cwd: dirPath,
        absolute: true,
        onlyFiles: true,
        dot: entryDir.startsWith("."),
      });
      entryPoints.push(...dirFiles);
    }
  }

  const electronEntryPoints = discoverElectronEntryPoints(rootDir);
  entryPoints.push(...electronEntryPoints);

  const docEntryPoints = discoverDocumentationEntryPoints(rootDir);
  entryPoints.push(...docEntryPoints);

  const mobileEntryPoints = discoverMobileEntryPoints(rootDir);
  entryPoints.push(...mobileEntryPoints);

  return [...new Set(entryPoints)];
};

const ELECTRON_ENABLERS = ["electron", "electron-builder", "@electron-forge/cli", "electron-vite"];

const ELECTRON_ENTRY_PATTERNS = [
  "src/main/**/*.{ts,js}",
  "src/preload/**/*.{ts,js}",
  "electron/main.{ts,js}",
  "electron.vite.config.{ts,js,mjs}",
  "forge.config.{ts,js,cjs}",
  "electron-builder.{yml,yaml,json,json5,toml}",
];

const discoverElectronEntryPoints = (rootDir: string): string[] => {
  const packageJsonPath = join(rootDir, "package.json");
  if (!existsSync(packageJsonPath)) return [];

  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);
    const allDependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    const isElectronProject = ELECTRON_ENABLERS.some((enabler) => enabler in allDependencies);
    if (!isElectronProject) return [];

    return fg.sync(ELECTRON_ENTRY_PATTERNS, {
      cwd: rootDir,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**"],
    });
  } catch {
    return [];
  }
};

const DOCUSAURUS_ENABLERS = ["@docusaurus/core", "@docusaurus/preset-classic"];

const DOCUSAURUS_CONTENT_PATTERNS = [
  "docs/**/*.{md,mdx}",
  "blog/**/*.{md,mdx}",
  "versioned_docs/**/*.{md,mdx}",
  "src/pages/**/*.{ts,tsx,js,jsx,md,mdx}",
  "src/content/**/*.{ts,tsx,js,jsx,md,mdx}",
  "src/components/**/*.{ts,tsx,js,jsx}",
  "src/theme/**/*.{ts,tsx,js,jsx}",
  "src/hooks/**/*.{ts,tsx,js,jsx}",
  "src/plugins/**/*.{ts,tsx,js,jsx}",
  "src/lib/**/*.{ts,tsx,js,jsx}",
  "sidebars.{js,ts}",
  "i18n/**/*.{md,mdx}",
];

const VITEPRESS_ENABLERS = ["vitepress"];

const VITEPRESS_CONTENT_PATTERNS = [
  "**/*.md",
  ".vitepress/**/*.{ts,tsx,js,jsx,vue}",
];

const NEXTRA_ENABLERS = ["nextra", "nextra-theme-docs", "nextra-theme-blog"];

const NEXTRA_CONTENT_PATTERNS = [
  "pages/**/*.{md,mdx}",
  "content/**/*.{md,mdx}",
];

const EXPO_ENABLERS = ["expo"];
const EXPO_ROUTER_ENABLERS = ["expo-router"];

const EXPO_ENTRY_PATTERNS = [
  "App.{ts,tsx,js,jsx}",
  "src/App.{ts,tsx,js,jsx}",
  "app.config.{ts,js,mjs,cjs}",
  "metro.config.{ts,js,mjs,cjs}",
  "babel.config.{ts,js,mjs,cjs}",
];

const EXPO_ROUTER_ENTRY_PATTERNS = [
  "app/**/*.{ts,tsx,js,jsx}",
  "app.config.{ts,js,mjs,cjs}",
  "metro.config.{ts,js,mjs,cjs}",
  "babel.config.{ts,js,mjs,cjs}",
];

const REACT_NATIVE_ENABLERS = ["react-native"];

const REACT_NATIVE_ENTRY_PATTERNS = [
  "index.{ts,tsx,js,jsx}",
  "index.android.{ts,tsx,js,jsx}",
  "index.ios.{ts,tsx,js,jsx}",
  "index.native.{ts,tsx,js,jsx}",
  "App.{ts,tsx,js,jsx}",
  "src/App.{ts,tsx,js,jsx}",
  "metro.config.{ts,js}",
  "react-native.config.{ts,js}",
];

const discoverMobileEntryPoints = (directory: string): string[] => {
  const packageJsonPath = join(directory, "package.json");
  if (!existsSync(packageJsonPath)) return [];

  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);
    const allDependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    const detectedPatterns: string[] = [];

    const hasExpoRouter = EXPO_ROUTER_ENABLERS.some((enabler) => enabler in allDependencies);
    if (hasExpoRouter) {
      detectedPatterns.push(...EXPO_ROUTER_ENTRY_PATTERNS);
    } else {
      const hasExpo = EXPO_ENABLERS.some((enabler) => enabler in allDependencies);
      if (hasExpo) {
        detectedPatterns.push(...EXPO_ENTRY_PATTERNS);
      }
    }

    const hasReactNative = REACT_NATIVE_ENABLERS.some((enabler) => enabler in allDependencies);
    if (hasReactNative) {
      detectedPatterns.push(...REACT_NATIVE_ENTRY_PATTERNS);
    }

    if (detectedPatterns.length === 0) return [];

    return fg.sync(detectedPatterns, {
      cwd: directory,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**"],
    });
  } catch {
    return [];
  }
};

const discoverDocumentationEntryPoints = (directory: string): string[] => {
  const packageJsonPath = join(directory, "package.json");
  if (!existsSync(packageJsonPath)) return [];

  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);
    const allDependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    const detectedPatterns: string[] = [];

    const hasDocusaurus = DOCUSAURUS_ENABLERS.some((enabler) => enabler in allDependencies);
    if (hasDocusaurus) {
      detectedPatterns.push(...DOCUSAURUS_CONTENT_PATTERNS);
    }

    const hasVitepress = VITEPRESS_ENABLERS.some((enabler) => enabler in allDependencies);
    if (hasVitepress) {
      detectedPatterns.push(...VITEPRESS_CONTENT_PATTERNS);
    }

    const hasNextra = NEXTRA_ENABLERS.some((enabler) => enabler in allDependencies);
    if (hasNextra) {
      detectedPatterns.push(...NEXTRA_CONTENT_PATTERNS);
    }

    if (detectedPatterns.length === 0) return [];

    return fg.sync(detectedPatterns, {
      cwd: directory,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**"],
    });
  } catch {
    return [];
  }
};


