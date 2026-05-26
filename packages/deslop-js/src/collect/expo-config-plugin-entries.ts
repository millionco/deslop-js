import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import fg from "fast-glob";
import ts from "typescript";
import { EXPO_CONFIG_SCAN_MAX_DEPTH, SOURCE_EXTENSIONS } from "../constants.js";

const EXPO_CONFIG_FILE_GLOBS = [
  "app.config.{ts,mts,cts,js,mjs,cjs}",
  "app.json",
  "**/app.config.{ts,mts,cts,js,mjs,cjs}",
  "**/app.json",
];

const EXPO_REACT_NATIVE_DEPENDENCIES = new Set(["expo", "react-native"]);

const EXPO_PLUGIN_RESOLVABLE_EXTENSIONS = SOURCE_EXTENSIONS.map(
  (sourceExtension) => `.${sourceExtension}`,
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isExpoOrReactNativeWorkspace = (dependencies: Record<string, string>): boolean =>
  [...EXPO_REACT_NATIVE_DEPENDENCIES].some((dependencyName) => dependencyName in dependencies);

const isLocalExpoPluginPath = (value: string): boolean =>
  (value.startsWith("./") || value.startsWith("../")) &&
  !value.includes("*") &&
  !value.includes("?");

const isFile = (filePath: string): boolean => {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
};

const resolveExpoPluginPath = (configDirectory: string, pluginPath: string): string | undefined => {
  const candidatePath = resolve(configDirectory, pluginPath);
  if (isFile(candidatePath)) return candidatePath;

  for (const extension of EXPO_PLUGIN_RESOLVABLE_EXTENSIONS) {
    const candidatePathWithExtension = `${candidatePath}${extension}`;
    if (isFile(candidatePathWithExtension)) return candidatePathWithExtension;
  }

  for (const extension of EXPO_PLUGIN_RESOLVABLE_EXTENSIONS) {
    const indexCandidatePath = join(candidatePath, `index${extension}`);
    if (isFile(indexCandidatePath)) return indexCandidatePath;
  }

  return undefined;
};

const addExpoPluginEntry = (
  entries: Set<string>,
  rootDirectory: string,
  configDirectory: string,
  pluginPath: string,
): void => {
  if (!isLocalExpoPluginPath(pluginPath)) return;

  const resolvedPath = resolveExpoPluginPath(configDirectory, pluginPath);
  if (!resolvedPath) return;

  const relativePath = relative(rootDirectory, resolvedPath);
  if (relativePath.startsWith("../") || isAbsolute(relativePath)) return;

  entries.add(resolvedPath);
};

const getPropertyName = (name: ts.PropertyName): string | undefined => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text;
  return undefined;
};

const collectExpoPluginPathsFromArray = (
  array: ts.ArrayLiteralExpression,
  entries: Set<string>,
  rootDirectory: string,
  configDirectory: string,
): void => {
  for (const element of array.elements) {
    if (ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)) {
      addExpoPluginEntry(entries, rootDirectory, configDirectory, element.text);
      continue;
    }

    if (ts.isArrayLiteralExpression(element)) {
      const [pluginName] = element.elements;
      if (
        pluginName &&
        (ts.isStringLiteral(pluginName) || ts.isNoSubstitutionTemplateLiteral(pluginName))
      ) {
        addExpoPluginEntry(entries, rootDirectory, configDirectory, pluginName.text);
      }
    }
  }
};

const collectExpoPluginPathsFromAppConfig = (
  configPath: string,
  entries: Set<string>,
  rootDirectory: string,
): void => {
  const extension = extname(configPath);
  const sourceFile = ts.createSourceFile(
    configPath,
    readFileSync(configPath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    extension === ".ts" || extension === ".mts" || extension === ".cts"
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS,
  );
  const configDirectory = dirname(configPath);

  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      getPropertyName(node.name) === "plugins" &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      collectExpoPluginPathsFromArray(node.initializer, entries, rootDirectory, configDirectory);
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
};

const collectPluginPathsFromJsonValue = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  const pluginPaths: string[] = [];
  for (const plugin of value) {
    if (typeof plugin === "string") {
      pluginPaths.push(plugin);
      continue;
    }

    if (Array.isArray(plugin) && typeof plugin[0] === "string") pluginPaths.push(plugin[0]);
  }

  return pluginPaths;
};

const collectExpoPluginPathsFromAppJson = (
  configPath: string,
  entries: Set<string>,
  rootDirectory: string,
): void => {
  const parsedJson: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  const configDirectory = dirname(configPath);
  if (!isRecord(parsedJson)) return;

  const expoConfig = parsedJson.expo;
  const expoPluginPaths = isRecord(expoConfig)
    ? collectPluginPathsFromJsonValue(expoConfig.plugins)
    : [];

  for (const pluginPath of [
    ...expoPluginPaths,
    ...collectPluginPathsFromJsonValue(parsedJson.plugins),
  ]) {
    addExpoPluginEntry(entries, rootDirectory, configDirectory, pluginPath);
  }
};

const collectExpoPluginPathsFromConfig = (
  configPath: string,
  entries: Set<string>,
  rootDirectory: string,
): void => {
  try {
    if (basename(configPath) === "app.json") {
      collectExpoPluginPathsFromAppJson(configPath, entries, rootDirectory);
      return;
    }

    collectExpoPluginPathsFromAppConfig(configPath, entries, rootDirectory);
  } catch {}
};

export const extractExpoConfigPluginEntries = (
  directory: string,
  dependencies: Record<string, string>,
): string[] => {
  if (!isExpoOrReactNativeWorkspace(dependencies)) return [];

  const entries = new Set<string>();
  const configPaths = fg.sync(EXPO_CONFIG_FILE_GLOBS, {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    deep: EXPO_CONFIG_SCAN_MAX_DEPTH,
  });

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      collectExpoPluginPathsFromConfig(configPath, entries, directory);
    }
  }

  return [...entries];
};
