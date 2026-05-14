import { ResolverFactory } from "oxc-resolver";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import type { DeslopConfig } from "../types.js";
import { BUILTIN_MODULES, RESOLVER_EXTENSIONS } from "../constants.js";

export interface ResolvedImport {
  resolvedPath: string | undefined;
  isExternal: boolean;
  packageName: string | undefined;
}

export const createModuleResolver = (config: DeslopConfig) => {
  let tsconfigPath: string | undefined;
  if (config.tsConfigPath) {
    tsconfigPath = resolve(config.rootDir, config.tsConfigPath);
  } else {
    const defaultTsConfig = resolve(config.rootDir, "tsconfig.json");
    if (existsSync(defaultTsConfig)) {
      tsconfigPath = defaultTsConfig;
    }
  }

  const resolver = new ResolverFactory({
    conditionNames: ["import", "require", "node", "default"],
    extensions: RESOLVER_EXTENSIONS,
    mainFields: ["module", "main", "browser"],
    tsconfig: tsconfigPath
      ? { configFile: tsconfigPath, references: "auto" }
      : undefined,
  });

  const resolveCache = new Map<string, ResolvedImport>();

  const resolveModule = (specifier: string, fromFile: string): ResolvedImport => {
    const cacheKey = `${dirname(fromFile)}::${specifier}`;
    const cached = resolveCache.get(cacheKey);
    if (cached) return cached;

    if (isBuiltinModule(specifier)) {
      const resolvedResult: ResolvedImport = {
        resolvedPath: undefined,
        isExternal: true,
        packageName: specifier.startsWith("node:")
          ? specifier.slice(5)
          : specifier,
      };
      resolveCache.set(cacheKey, resolvedResult);
      return resolvedResult;
    }

    try {
      const resolverResult = resolver.sync(dirname(fromFile), specifier);

      if (resolverResult.path) {
        const isInsideNodeModules = resolverResult.path.includes("/node_modules/");
        const resolvedResult: ResolvedImport = {
          resolvedPath: isInsideNodeModules ? undefined : resolverResult.path,
          isExternal: isInsideNodeModules,
          packageName: isInsideNodeModules
            ? extractPackageNameFromSpecifier(specifier)
            : undefined,
        };
        resolveCache.set(cacheKey, resolvedResult);
        return resolvedResult;
      }
    } catch {
      // resolution failed
    }

    if (isBareSpecifier(specifier)) {
      const packageName = extractPackageNameFromSpecifier(specifier);
      const resolvedResult: ResolvedImport = {
        resolvedPath: undefined,
        isExternal: true,
        packageName,
      };
      resolveCache.set(cacheKey, resolvedResult);
      return resolvedResult;
    }

    const unresolvedResult: ResolvedImport = {
      resolvedPath: undefined,
      isExternal: false,
      packageName: undefined,
    };
    resolveCache.set(cacheKey, unresolvedResult);
    return unresolvedResult;
  };

  return { resolveModule };
};

const isBuiltinModule = (specifier: string): boolean => {
  if (specifier.startsWith("node:")) return true;
  const baseName = specifier.split("/")[0];
  return BUILTIN_MODULES.has(baseName);
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
