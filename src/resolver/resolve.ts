import { ResolverFactory } from "oxc-resolver";
import { dirname, resolve, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { DeslopConfig } from "../types.js";
import { BUILTIN_MODULES, RESOLVER_EXTENSIONS } from "../constants.js";
import { resolveSourcePath } from "./source-path.js";

export interface ResolvedImport {
  resolvedPath: string | undefined;
  isExternal: boolean;
  packageName: string | undefined;
}

const EXTENSION_ALIAS = {
  ".js": [".ts", ".tsx", ".js", ".jsx"],
  ".jsx": [".tsx", ".jsx"],
  ".mjs": [".mts", ".mjs"],
  ".cjs": [".cts", ".cjs"],
};

const COMMON_RESOLVER_OPTIONS = {
  conditionNames: ["import", "require", "node", "default"],
  extensions: RESOLVER_EXTENSIONS,
  mainFields: ["module", "main", "browser"],
  extensionAlias: EXTENSION_ALIAS,
};

const TSCONFIG_FILENAMES = ["tsconfig.json", "tsconfig.web.json", "tsconfig.app.json", "tsconfig.base.json"];

const findNearestTsconfig = (fromDir: string, rootDir: string): string | undefined => {
  let currentDirectory = fromDir;
  const normalizedRoot = resolve(rootDir);

  while (currentDirectory.length >= normalizedRoot.length) {
    for (const tsconfigFilename of TSCONFIG_FILENAMES) {
      const tsconfigCandidate = join(currentDirectory, tsconfigFilename);
      if (existsSync(tsconfigCandidate)) {
        return tsconfigCandidate;
      }
    }
    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) break;
    currentDirectory = parentDirectory;
  }

  return undefined;
};

export interface WorkspacePackageMap {
  name: string;
  directory: string;
}

const STYLE_FILE_EXTENSIONS = [".css", ".scss", ".less", ".sass"];
const SCSS_PARTIAL_EXTENSIONS = [".scss", ".sass", ".css"];

const resolveScssPartial = (specifier: string, fromDirectory: string): string | undefined => {
  const basePath = resolve(fromDirectory, specifier);
  const baseDirectory = dirname(basePath);
  const baseFileName = basePath.split("/").pop() ?? "";

  const candidates: string[] = [];

  for (const extension of SCSS_PARTIAL_EXTENSIONS) {
    if (!basePath.endsWith(extension)) {
      candidates.push(`${basePath}${extension}`);
      candidates.push(join(baseDirectory, `_${baseFileName}${extension}`));
    } else {
      candidates.push(basePath);
      candidates.push(join(baseDirectory, `_${baseFileName}`));
    }
  }

  candidates.push(join(basePath, `index.scss`));
  candidates.push(join(basePath, `_index.scss`));
  candidates.push(join(basePath, `index.sass`));
  candidates.push(join(basePath, `_index.sass`));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
};

export const createModuleResolver = (config: DeslopConfig, workspacePackages: WorkspacePackageMap[] = []) => {
  const resolverCache = new Map<string, ResolverFactory>();
  const resolveResultCache = new Map<string, ResolvedImport>();

  const failedTsconfigPaths = new Set<string>();

  const getOrCreateResolver = (tsconfigPath: string | undefined): ResolverFactory => {
    const effectivePath = tsconfigPath && !failedTsconfigPaths.has(tsconfigPath)
      ? tsconfigPath
      : undefined;
    const cacheKey = effectivePath ?? "__no_tsconfig__";
    const existingResolver = resolverCache.get(cacheKey);
    if (existingResolver) return existingResolver;

    try {
      const newResolver = new ResolverFactory({
        ...COMMON_RESOLVER_OPTIONS,
        tsconfig: effectivePath
          ? { configFile: effectivePath, references: "auto" }
          : undefined,
      });
      resolverCache.set(cacheKey, newResolver);
      return newResolver;
    } catch {
      if (effectivePath) {
        failedTsconfigPaths.add(effectivePath);
        return getOrCreateResolver(undefined);
      }
      const fallbackResolver = new ResolverFactory(COMMON_RESOLVER_OPTIONS);
      resolverCache.set(cacheKey, fallbackResolver);
      return fallbackResolver;
    }
  };

  const workspaceNameToDirectory = new Map<string, string>();
  for (const workspacePackage of workspacePackages) {
    workspaceNameToDirectory.set(workspacePackage.name, workspacePackage.directory);
  }

  let rootTsconfigPath: string | undefined;
  if (config.tsConfigPath) {
    rootTsconfigPath = resolve(config.rootDir, config.tsConfigPath);
  } else {
    const tsconfigCandidates = [
      "tsconfig.json",
      "tsconfig.web.json",
      "tsconfig.app.json",
      "tsconfig.base.json",
    ];
    for (const candidate of tsconfigCandidates) {
      const candidatePath = resolve(config.rootDir, candidate);
      if (existsSync(candidatePath)) {
        rootTsconfigPath = candidatePath;
        break;
      }
    }
  }

  const tsconfigPathCache = new Map<string, string | undefined>();
  const tsconfigPathAliasCache = new Map<string, Map<string, string[]>>();

  const findTsconfigForFile = (filePath: string): string | undefined => {
    const fileDir = dirname(filePath);
    const cached = tsconfigPathCache.get(fileDir);
    if (cached !== undefined) return cached;

    const found = findNearestTsconfig(fileDir, config.rootDir);
    const tsconfigResult = found ?? rootTsconfigPath;
    tsconfigPathCache.set(fileDir, tsconfigResult);
    return tsconfigResult;
  };

  const tsconfigBaseUrlCache = new Map<string, string | undefined>();

  const getBaseUrlDirectory = (tsconfigFile: string): string | undefined => {
    const cached = tsconfigBaseUrlCache.get(tsconfigFile);
    if (cached !== undefined) return cached;

    try {
      const tsconfigContent = readFileSync(tsconfigFile, "utf-8");
      const cleanedContent = stripJsonComments(tsconfigContent);
      const tsconfigJson = JSON.parse(cleanedContent);
      const baseUrl = tsconfigJson.compilerOptions?.baseUrl;
      if (baseUrl) {
        const absoluteBaseUrl = resolve(dirname(tsconfigFile), baseUrl);
        tsconfigBaseUrlCache.set(tsconfigFile, absoluteBaseUrl);
        return absoluteBaseUrl;
      }
    } catch {
    }
    tsconfigBaseUrlCache.set(tsconfigFile, undefined);
    return undefined;
  };

  const getPathAliases = (tsconfigFile: string): Map<string, string[]> => {
    const cached = tsconfigPathAliasCache.get(tsconfigFile);
    if (cached) return cached;

    const aliasMap = new Map<string, string[]>();
    try {
      const tsconfigContent = readFileSync(tsconfigFile, "utf-8");
      const cleanedContent = stripJsonComments(tsconfigContent);
      const tsconfigJson = JSON.parse(cleanedContent);
      const paths = tsconfigJson.compilerOptions?.paths;
      const baseUrl = tsconfigJson.compilerOptions?.baseUrl ?? ".";
      const tsconfigDir = dirname(tsconfigFile);

      if (paths && typeof paths === "object") {
        for (const [pattern, targets] of Object.entries(paths)) {
          if (Array.isArray(targets)) {
            aliasMap.set(
              pattern,
              targets.map((target: string) => resolve(tsconfigDir, baseUrl, target)),
            );
          }
        }
      }
    } catch {
    }
    tsconfigPathAliasCache.set(tsconfigFile, aliasMap);
    return aliasMap;
  };

  const tryResolveViaPathAlias = (specifier: string, fromFile: string): string | undefined => {
    const tsconfigFile = findTsconfigForFile(fromFile);
    if (!tsconfigFile) return undefined;

    const aliases = getPathAliases(tsconfigFile);
    for (const [pattern, targetPatterns] of aliases) {
      const wildcardIndex = pattern.indexOf("*");
      if (wildcardIndex === -1) {
        if (specifier === pattern) {
          for (const targetPattern of targetPatterns) {
            const candidate = targetPattern.replace("*", "");
            for (const ext of RESOLVER_EXTENSIONS) {
              if (existsSync(candidate + ext)) return candidate + ext;
            }
            const indexCandidate = join(candidate, "index");
            for (const ext of RESOLVER_EXTENSIONS) {
              if (existsSync(indexCandidate + ext)) return indexCandidate + ext;
            }
          }
        }
        continue;
      }

      const prefix = pattern.slice(0, wildcardIndex);
      const suffix = pattern.slice(wildcardIndex + 1);
      if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;

      const matchedWildcard = specifier.slice(prefix.length, specifier.length - suffix.length);
      for (const targetPattern of targetPatterns) {
        const resolvedTarget = targetPattern.replace("*", matchedWildcard);
        for (const ext of RESOLVER_EXTENSIONS) {
          if (existsSync(resolvedTarget + ext)) return resolvedTarget + ext;
        }
        const strippedTarget = resolvedTarget.replace(/\.[cm]?js$/, "");
        if (strippedTarget !== resolvedTarget) {
          for (const ext of RESOLVER_EXTENSIONS) {
            if (existsSync(strippedTarget + ext)) return strippedTarget + ext;
          }
        }
        const indexCandidate = join(resolvedTarget, "index");
        for (const ext of RESOLVER_EXTENSIONS) {
          if (existsSync(indexCandidate + ext)) return indexCandidate + ext;
        }
      }
    }

    return undefined;
  };

  const resolveModule = (specifier: string, fromFile: string): ResolvedImport => {
    const queryIndex = specifier.indexOf("?");
    const cleanedSpecifier = queryIndex !== -1 ? specifier.slice(0, queryIndex) : specifier;
    const fromDir = dirname(fromFile);
    const cacheKey = `${fromDir}::${cleanedSpecifier}`;
    const cached = resolveResultCache.get(cacheKey);
    if (cached) return cached;

    if (isBuiltinModule(cleanedSpecifier)) {
      const resolvedResult: ResolvedImport = {
        resolvedPath: undefined,
        isExternal: true,
        packageName: cleanedSpecifier.startsWith("node:")
          ? cleanedSpecifier.slice(5)
          : cleanedSpecifier,
      };
      resolveResultCache.set(cacheKey, resolvedResult);
      return resolvedResult;
    }

    const isFromStyleFile = STYLE_FILE_EXTENSIONS.some((extension) => fromFile.endsWith(extension));
    if (isFromStyleFile && isBareSpecifier(cleanedSpecifier)) {
      const scssResolved = resolveScssPartial(cleanedSpecifier, fromDir);
      if (scssResolved) {
        const resolvedResult: ResolvedImport = {
          resolvedPath: scssResolved,
          isExternal: false,
          packageName: undefined,
        };
        resolveResultCache.set(cacheKey, resolvedResult);
        return resolvedResult;
      }
    }

    if (isBareSpecifier(cleanedSpecifier) && workspaceNameToDirectory.size > 0) {
      const packageName = extractPackageNameFromSpecifier(cleanedSpecifier);
      const workspaceDirectory = workspaceNameToDirectory.get(packageName);
      if (workspaceDirectory) {
        const subpath = cleanedSpecifier.slice(packageName.length + 1);
        const workspacePackageJsonPath = join(workspaceDirectory, "package.json");
        try {
          const workspacePackageContent = readFileSync(workspacePackageJsonPath, "utf-8");
          const workspacePackageJson = JSON.parse(workspacePackageContent);

          let resolvedEntryPath: string | undefined;
          if (subpath && workspacePackageJson.exports) {
            const exportKey = `./${subpath}`;
            const exportValue = workspacePackageJson.exports[exportKey];
            if (typeof exportValue === "string") {
              resolvedEntryPath = resolve(workspaceDirectory, exportValue);
            } else if (typeof exportValue === "object" && exportValue !== null) {
              const conditionValue = exportValue.import ?? exportValue.require ?? exportValue.default ?? exportValue.types;
              if (typeof conditionValue === "string") {
                resolvedEntryPath = resolve(workspaceDirectory, conditionValue);
              }
            }
          }

          if (subpath && !resolvedEntryPath) {
            const directSubpath = resolve(workspaceDirectory, subpath);
            for (const candidateExtension of RESOLVER_EXTENSIONS) {
              const candidate = directSubpath + candidateExtension;
              if (existsSync(candidate)) {
                resolvedEntryPath = candidate;
                break;
              }
            }
            if (!resolvedEntryPath) {
              for (const candidateExtension of RESOLVER_EXTENSIONS) {
                const indexCandidate = join(directSubpath, `index${candidateExtension}`);
                if (existsSync(indexCandidate)) {
                  resolvedEntryPath = indexCandidate;
                  break;
                }
              }
            }
          }

          if (!subpath) {
            const mainField = workspacePackageJson.main ?? workspacePackageJson.module;
            if (typeof mainField === "string") {
              resolvedEntryPath = resolve(workspaceDirectory, mainField);
            }
            if (!resolvedEntryPath && workspacePackageJson.exports?.["."]){
              const dotExport = workspacePackageJson.exports["."];
              if (typeof dotExport === "string") {
                resolvedEntryPath = resolve(workspaceDirectory, dotExport);
              } else if (typeof dotExport === "object" && dotExport !== null) {
                const conditionValue = dotExport.import ?? dotExport.require ?? dotExport.default ?? dotExport.types;
                if (typeof conditionValue === "string") {
                  resolvedEntryPath = resolve(workspaceDirectory, conditionValue);
                }
              }
            }
          }

          if (resolvedEntryPath) {
            const sourcePath = resolveSourcePath(resolvedEntryPath, workspaceDirectory);
            const finalPath = sourcePath ?? resolvedEntryPath;
            if (existsSync(finalPath)) {
              const resolvedResult: ResolvedImport = {
                resolvedPath: finalPath,
                isExternal: false,
                packageName: undefined,
              };
              resolveResultCache.set(cacheKey, resolvedResult);
              return resolvedResult;
            }
          }
        } catch {
        }
      }
    }

    const tsconfigForFile = findTsconfigForFile(fromFile);
    const resolver = getOrCreateResolver(tsconfigForFile);

    const tryResolve = (activeResolver: ResolverFactory): ResolvedImport | undefined => {
      try {
        const resolverResult = activeResolver.sync(fromDir, cleanedSpecifier);
        if (resolverResult.path) {
          const isInsideNodeModules = resolverResult.path.includes("/node_modules/");
          return {
            resolvedPath: isInsideNodeModules ? undefined : resolverResult.path,
            isExternal: isInsideNodeModules,
            packageName: isInsideNodeModules
              ? extractPackageNameFromSpecifier(cleanedSpecifier)
              : undefined,
          };
        }
      } catch {
        return undefined;
      }
      return undefined;
    };

    const resolversToAttempt = [
      resolver,
      ...(tsconfigForFile !== rootTsconfigPath && rootTsconfigPath
        ? [getOrCreateResolver(rootTsconfigPath)]
        : []),
      ...(tsconfigForFile ? [getOrCreateResolver(undefined)] : []),
    ];

    for (const activeResolver of resolversToAttempt) {
      const resolvedResult = tryResolve(activeResolver);
      if (resolvedResult) {
        resolveResultCache.set(cacheKey, resolvedResult);
        return resolvedResult;
      }
    }

    const pathAliasResolved = tryResolveViaPathAlias(cleanedSpecifier, fromFile);
    if (pathAliasResolved) {
      const resolvedResult: ResolvedImport = {
        resolvedPath: pathAliasResolved,
        isExternal: false,
        packageName: undefined,
      };
      resolveResultCache.set(cacheKey, resolvedResult);
      return resolvedResult;
    }

    if (isBareSpecifier(cleanedSpecifier)) {
      const tsconfigFile = findTsconfigForFile(fromFile);
      if (tsconfigFile) {
        const baseUrlDirectory = getBaseUrlDirectory(tsconfigFile);
        if (baseUrlDirectory) {
          const baseUrlCandidate = resolve(baseUrlDirectory, cleanedSpecifier);
          for (const candidateExtension of RESOLVER_EXTENSIONS) {
            const fullCandidate = baseUrlCandidate + candidateExtension;
            if (existsSync(fullCandidate)) {
              const resolvedResult: ResolvedImport = {
                resolvedPath: fullCandidate,
                isExternal: false,
                packageName: undefined,
              };
              resolveResultCache.set(cacheKey, resolvedResult);
              return resolvedResult;
            }
          }
          const indexCandidate = join(baseUrlCandidate, "index");
          for (const candidateExtension of RESOLVER_EXTENSIONS) {
            const fullCandidate = indexCandidate + candidateExtension;
            if (existsSync(fullCandidate)) {
              const resolvedResult: ResolvedImport = {
                resolvedPath: fullCandidate,
                isExternal: false,
                packageName: undefined,
              };
              resolveResultCache.set(cacheKey, resolvedResult);
              return resolvedResult;
            }
          }
        }
      }
      const packageName = extractPackageNameFromSpecifier(cleanedSpecifier);
      const resolvedResult: ResolvedImport = {
        resolvedPath: undefined,
        isExternal: true,
        packageName,
      };
      resolveResultCache.set(cacheKey, resolvedResult);
      return resolvedResult;
    }

    const unresolvedResult: ResolvedImport = {
      resolvedPath: undefined,
      isExternal: false,
      packageName: undefined,
    };
    resolveResultCache.set(cacheKey, unresolvedResult);
    return unresolvedResult;
  };

  return { resolveModule };
};

const stripJsonComments = (content: string): string => {
  let result = "";
  let insideString = false;
  let index = 0;

  while (index < content.length) {
    if (insideString) {
      if (content[index] === "\\" && index + 1 < content.length) {
        result += content[index] + content[index + 1];
        index += 2;
        continue;
      }
      if (content[index] === '"') {
        insideString = false;
      }
      result += content[index];
      index++;
      continue;
    }

    if (content[index] === '"') {
      insideString = true;
      result += content[index];
      index++;
      continue;
    }

    if (content[index] === "/" && index + 1 < content.length) {
      if (content[index + 1] === "/") {
        while (index < content.length && content[index] !== "\n") index++;
        continue;
      }
      if (content[index + 1] === "*") {
        index += 2;
        while (index + 1 < content.length && !(content[index] === "*" && content[index + 1] === "/")) index++;
        index += 2;
        continue;
      }
    }

    result += content[index];
    index++;
  }

  return result.replace(/,(\s*[}\]])/g, "$1");
};

const BUILTIN_SUBPATH_MODULES = new Set([
  "fs", "dns", "stream", "readline", "timers", "util",
]);

const isBuiltinModule = (specifier: string): boolean => {
  if (specifier.startsWith("node:")) return true;
  const baseName = specifier.split("/")[0];
  if (!BUILTIN_MODULES.has(baseName)) return false;
  const hasSubpath = specifier.includes("/");
  if (!hasSubpath) return true;
  return BUILTIN_SUBPATH_MODULES.has(baseName);
};

const isBareSpecifier = (specifier: string): boolean =>
  !specifier.startsWith(".") && !specifier.startsWith("/");

const extractPackageNameFromSpecifier = (specifier: string): string => {
  if (specifier.startsWith("node:")) {
    return specifier.slice(5).split("/")[0];
  }

  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }

  return specifier.split("/")[0];
};
