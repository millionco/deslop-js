import { readFileSync } from "node:fs";
import { parseSync } from "oxc-parser";
import type {
  DependencyGraph,
  FeatureFlag,
  FeatureFlagsConfig,
  ScanResult,
} from "../types.js";

interface SdkPattern {
  functionName: string;
  nameArgIndex: number;
  provider: string;
}

const BUILTIN_SDK_PATTERNS: readonly SdkPattern[] = [
  { functionName: "useFlag", nameArgIndex: 0, provider: "LaunchDarkly" },
  { functionName: "useLDFlag", nameArgIndex: 0, provider: "LaunchDarkly" },
  { functionName: "useFeatureFlag", nameArgIndex: 0, provider: "LaunchDarkly" },
  { functionName: "variation", nameArgIndex: 0, provider: "LaunchDarkly" },
  { functionName: "boolVariation", nameArgIndex: 0, provider: "LaunchDarkly" },
  { functionName: "stringVariation", nameArgIndex: 0, provider: "LaunchDarkly" },
  { functionName: "numberVariation", nameArgIndex: 0, provider: "LaunchDarkly" },
  { functionName: "jsonVariation", nameArgIndex: 0, provider: "LaunchDarkly" },
  { functionName: "useGate", nameArgIndex: 0, provider: "Statsig" },
  { functionName: "checkGate", nameArgIndex: 0, provider: "Statsig" },
  { functionName: "useExperiment", nameArgIndex: 0, provider: "Statsig" },
  { functionName: "useConfig", nameArgIndex: 0, provider: "Statsig" },
  { functionName: "isEnabled", nameArgIndex: 0, provider: "Unleash" },
  { functionName: "getVariant", nameArgIndex: 0, provider: "Unleash" },
  { functionName: "isOn", nameArgIndex: 0, provider: "GrowthBook" },
  { functionName: "isOff", nameArgIndex: 0, provider: "GrowthBook" },
  { functionName: "getFeatureValue", nameArgIndex: 0, provider: "GrowthBook" },
  { functionName: "getTreatment", nameArgIndex: 0, provider: "Split" },
  { functionName: "useFeatureFlagEnabled", nameArgIndex: 0, provider: "PostHog" },
  { functionName: "useFeatureFlagPayload", nameArgIndex: 0, provider: "PostHog" },
  { functionName: "useFeatureFlagVariantKey", nameArgIndex: 0, provider: "PostHog" },
  { functionName: "getFeatureFlagPayload", nameArgIndex: 0, provider: "PostHog" },
  { functionName: "getValueAsync", nameArgIndex: 0, provider: "ConfigCat" },
  { functionName: "getValueDetailsAsync", nameArgIndex: 0, provider: "ConfigCat" },
  { functionName: "hasFeature", nameArgIndex: 0, provider: "Flagsmith" },
  { functionName: "useDecision", nameArgIndex: 0, provider: "Optimizely" },
  { functionName: "getFeatureVariable", nameArgIndex: 0, provider: "Optimizely" },
  { functionName: "getFeatureVariableBoolean", nameArgIndex: 0, provider: "Optimizely" },
  { functionName: "getFeatureVariableString", nameArgIndex: 0, provider: "Optimizely" },
  { functionName: "getFeatureVariableInteger", nameArgIndex: 0, provider: "Optimizely" },
  { functionName: "getFeatureVariableDouble", nameArgIndex: 0, provider: "Optimizely" },
  { functionName: "getFeatureVariableJson", nameArgIndex: 0, provider: "Optimizely" },
  { functionName: "getFeatureVariableJSON", nameArgIndex: 0, provider: "Optimizely" },
  { functionName: "getStringAssignment", nameArgIndex: 0, provider: "Eppo" },
  { functionName: "getBooleanAssignment", nameArgIndex: 0, provider: "Eppo" },
  { functionName: "getNumericAssignment", nameArgIndex: 0, provider: "Eppo" },
  { functionName: "getIntegerAssignment", nameArgIndex: 0, provider: "Eppo" },
  { functionName: "getJSONAssignment", nameArgIndex: 0, provider: "Eppo" },
];

const VERCEL_FLAGS_FUNCTION_NAMES: ReadonlySet<string> = new Set(["flag", "evaluate"]);

const BUILTIN_ENV_PREFIXES: readonly string[] = [
  "FEATURE_",
  "NEXT_PUBLIC_FEATURE_",
  "NEXT_PUBLIC_ENABLE_",
  "REACT_APP_FEATURE_",
  "REACT_APP_ENABLE_",
  "VITE_FEATURE_",
  "VITE_ENABLE_",
  "NUXT_PUBLIC_FEATURE_",
  "ENABLE_",
  "FF_",
  "FLAG_",
  "TOGGLE_",
];

const CONFIG_OBJECT_KEYWORDS: ReadonlySet<string> = new Set([
  "feature",
  "features",
  "featureflags",
  "featureflag",
  "flag",
  "flags",
  "toggle",
  "toggles",
]);

const isAstNode = (candidate: unknown): candidate is { type: string } =>
  typeof candidate === "object" && candidate !== null && "type" in candidate;

const getStaticName = (node: unknown): string | undefined => {
  if (!isAstNode(node)) return undefined;
  if (node.type === "Identifier" || node.type === "PrivateIdentifier") {
    const identifierName = (node as Record<string, unknown>).name;
    return typeof identifierName === "string" ? identifierName : undefined;
  }
  if (node.type === "Literal") {
    const literalValue = (node as Record<string, unknown>).value;
    return typeof literalValue === "string" ? literalValue : undefined;
  }
  return undefined;
};

const extractStringArgument = (callArguments: unknown, argumentIndex: number): string | undefined => {
  if (!Array.isArray(callArguments)) return undefined;
  const argumentNode = callArguments[argumentIndex];
  if (!isAstNode(argumentNode)) return undefined;
  if (argumentNode.type === "Literal") {
    const literalValue = (argumentNode as Record<string, unknown>).value;
    return typeof literalValue === "string" ? literalValue : undefined;
  }
  if (argumentNode.type === "ObjectExpression") {
    const properties = (argumentNode as Record<string, unknown>).properties;
    if (!Array.isArray(properties)) return undefined;
    for (const property of properties) {
      if (!isAstNode(property)) continue;
      if (property.type !== "Property") continue;
      const propertyKey = getStaticName((property as Record<string, unknown>).key);
      if (propertyKey !== "key" && propertyKey !== "name") continue;
      const propertyValueName = getStaticName((property as Record<string, unknown>).value);
      if (propertyValueName !== undefined) return propertyValueName;
    }
  }
  return undefined;
};

interface VisitContext {
  filePath: string;
  lineStarts: number[];
  results: FeatureFlag[];
  envPrefixes: string[];
  sdkPatterns: SdkPattern[];
  detectConfigObjects: boolean;
  vercelFlagsLocalNames: Set<string>;
  guard: { startLine: number; endLine: number } | undefined;
}

const computeLineStarts = (sourceText: string): number[] => {
  const lineStarts: number[] = [0];
  for (let charIndex = 0; charIndex < sourceText.length; charIndex++) {
    if (sourceText.charCodeAt(charIndex) === 10) lineStarts.push(charIndex + 1);
  }
  return lineStarts;
};

const offsetToLineColumn = (
  byteOffset: number,
  lineStarts: number[],
): { line: number; column: number } => {
  let lowIndex = 0;
  let highIndex = lineStarts.length - 1;
  while (lowIndex < highIndex) {
    const middleIndex = (lowIndex + highIndex + 1) >>> 1;
    if (lineStarts[middleIndex] <= byteOffset) lowIndex = middleIndex;
    else highIndex = middleIndex - 1;
  }
  return { line: lowIndex + 1, column: byteOffset - lineStarts[lowIndex] };
};

const extractProcessEnvName = (memberExpression: unknown): string | undefined => {
  if (!isAstNode(memberExpression)) return undefined;
  if (memberExpression.type !== "MemberExpression" && memberExpression.type !== "StaticMemberExpression") {
    return undefined;
  }
  const propertyName = getStaticName((memberExpression as Record<string, unknown>).property);
  if (propertyName === undefined) return undefined;
  const objectNode = (memberExpression as Record<string, unknown>).object;
  if (!isAstNode(objectNode)) return undefined;
  if (objectNode.type !== "MemberExpression" && objectNode.type !== "StaticMemberExpression") {
    return undefined;
  }
  const innerObjectName = getStaticName((objectNode as Record<string, unknown>).object);
  const innerPropertyName = getStaticName((objectNode as Record<string, unknown>).property);
  if (innerObjectName === "process" && innerPropertyName === "env") return propertyName;
  return undefined;
};

const isFlagEnvName = (envName: string, extraEnvPrefixes: string[]): boolean => {
  for (const prefix of BUILTIN_ENV_PREFIXES) if (envName.startsWith(prefix)) return true;
  for (const prefix of extraEnvPrefixes) if (envName.startsWith(prefix)) return true;
  return false;
};

const collectVercelFlagsImports = (
  programNode: unknown,
): Set<string> => {
  const localNames = new Set<string>();
  if (!isAstNode(programNode)) return localNames;
  const body = (programNode as Record<string, unknown>).body;
  if (!Array.isArray(body)) return localNames;
  for (const statement of body) {
    if (!isAstNode(statement)) continue;
    if (statement.type !== "ImportDeclaration") continue;
    const sourceLiteral = (statement as Record<string, unknown>).source;
    const sourceValue = isAstNode(sourceLiteral)
      ? (sourceLiteral as Record<string, unknown>).value
      : undefined;
    if (typeof sourceValue !== "string") continue;
    const isVercelFlagsSource =
      sourceValue === "flags" ||
      sourceValue.startsWith("flags/") ||
      sourceValue === "@vercel/flags" ||
      sourceValue.startsWith("@vercel/flags/");
    if (!isVercelFlagsSource) continue;
    const specifiers = (statement as Record<string, unknown>).specifiers;
    if (!Array.isArray(specifiers)) continue;
    for (const specifier of specifiers) {
      if (!isAstNode(specifier)) continue;
      if (specifier.type === "ImportSpecifier") {
        const imported = (specifier as Record<string, unknown>).imported;
        const local = (specifier as Record<string, unknown>).local;
        const importedName = getStaticName(imported);
        const localName = getStaticName(local);
        if (importedName && VERCEL_FLAGS_FUNCTION_NAMES.has(importedName) && localName) {
          localNames.add(localName);
        }
      }
    }
  }
  return localNames;
};

const visitChildrenWithGuard = (
  node: unknown,
  visitor: (child: unknown) => void,
): void => {
  if (!isAstNode(node)) return;
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") {
      continue;
    }
    const value = (node as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) visitor(item);
    } else if (value !== null && typeof value === "object") {
      visitor(value);
    }
  }
};

const recordFlag = (
  context: VisitContext,
  flagName: string,
  kind: FeatureFlag["kind"],
  byteOffset: number,
  sdkProvider: string | undefined,
): void => {
  const { line, column } = offsetToLineColumn(byteOffset, context.lineStarts);
  context.results.push({
    path: context.filePath,
    name: flagName,
    kind,
    line,
    column,
    sdkProvider,
    guardLineStart: context.guard?.startLine,
    guardLineEnd: context.guard?.endLine,
    guardsDeadCode: false,
  });
};

const visitNode = (node: unknown, context: VisitContext): void => {
  if (!isAstNode(node)) return;

  if (node.type === "IfStatement") {
    const start = (node as Record<string, unknown>).start;
    const end = (node as Record<string, unknown>).end;
    const guard =
      typeof start === "number" && typeof end === "number"
        ? {
            startLine: offsetToLineColumn(start, context.lineStarts).line,
            endLine: offsetToLineColumn(end, context.lineStarts).line,
          }
        : undefined;
    const previousGuard = context.guard;
    context.guard = guard;
    visitNode((node as Record<string, unknown>).test, context);
    context.guard = previousGuard;
    visitNode((node as Record<string, unknown>).consequent, context);
    visitNode((node as Record<string, unknown>).alternate, context);
    return;
  }

  if (node.type === "ConditionalExpression") {
    const start = (node as Record<string, unknown>).start;
    const end = (node as Record<string, unknown>).end;
    const guard =
      typeof start === "number" && typeof end === "number"
        ? {
            startLine: offsetToLineColumn(start, context.lineStarts).line,
            endLine: offsetToLineColumn(end, context.lineStarts).line,
          }
        : undefined;
    const previousGuard = context.guard;
    context.guard = guard;
    visitNode((node as Record<string, unknown>).test, context);
    context.guard = previousGuard;
    visitNode((node as Record<string, unknown>).consequent, context);
    visitNode((node as Record<string, unknown>).alternate, context);
    return;
  }

  visitFlagPatternsInExpression(node, context);
  visitChildrenWithGuard(node, (child) => visitNode(child, context));
};

const visitFlagPatternsInExpression = (node: unknown, context: VisitContext): void => {
  if (!isAstNode(node)) return;

  if (node.type === "MemberExpression" || node.type === "StaticMemberExpression") {
    const envName = extractProcessEnvName(node);
    if (envName !== undefined && isFlagEnvName(envName, context.envPrefixes)) {
      const start = (node as Record<string, unknown>).start;
      if (typeof start === "number") recordFlag(context, envName, "env-var", start, undefined);
    } else if (context.detectConfigObjects) {
      const objectName = getStaticName((node as Record<string, unknown>).object);
      const propertyName = getStaticName((node as Record<string, unknown>).property);
      if (objectName && propertyName) {
        if (
          CONFIG_OBJECT_KEYWORDS.has(objectName.toLowerCase()) ||
          CONFIG_OBJECT_KEYWORDS.has(propertyName.toLowerCase())
        ) {
          const start = (node as Record<string, unknown>).start;
          if (typeof start === "number") {
            recordFlag(context, `${objectName}.${propertyName}`, "config-object", start, undefined);
          }
        }
      }
    }
  }

  if (node.type === "CallExpression") {
    const callee = (node as Record<string, unknown>).callee;
    let functionName: string | undefined;
    if (isAstNode(callee)) {
      if (callee.type === "Identifier") functionName = getStaticName(callee);
      else if (callee.type === "MemberExpression" || callee.type === "StaticMemberExpression") {
        functionName = getStaticName((callee as Record<string, unknown>).property);
      }
    }
    if (functionName !== undefined) {
      if (
        context.vercelFlagsLocalNames.has(functionName) ||
        VERCEL_FLAGS_FUNCTION_NAMES.has(functionName)
      ) {
        const callArguments = (node as Record<string, unknown>).arguments;
        const flagName = extractStringArgument(callArguments, 0);
        if (flagName !== undefined) {
          const start = (node as Record<string, unknown>).start;
          if (typeof start === "number") {
            recordFlag(context, flagName, "sdk-call", start, "Vercel Flags");
          }
        }
        return;
      }
      for (const sdkPattern of context.sdkPatterns) {
        if (sdkPattern.functionName !== functionName) continue;
        const callArguments = (node as Record<string, unknown>).arguments;
        const flagName = extractStringArgument(callArguments, sdkPattern.nameArgIndex);
        if (flagName === undefined) continue;
        const start = (node as Record<string, unknown>).start;
        if (typeof start === "number") {
          recordFlag(
            context,
            flagName,
            "sdk-call",
            start,
            sdkPattern.provider === "" ? undefined : sdkPattern.provider,
          );
        }
        break;
      }
    }
  }
};

const buildSdkPatterns = (extraSdkFunctionNames: string[]): SdkPattern[] => {
  const merged: SdkPattern[] = [...BUILTIN_SDK_PATTERNS];
  for (const extraName of extraSdkFunctionNames) {
    merged.push({ functionName: extraName, nameArgIndex: 0, provider: "" });
  }
  return merged;
};

export const detectFeatureFlags = (
  graph: DependencyGraph,
  config: FeatureFlagsConfig | undefined,
): FeatureFlag[] => {
  if (!config?.enabled) return [];

  const sdkPatterns = buildSdkPatterns(config.extraSdkFunctionNames);
  const collectedFlags: FeatureFlag[] = [];

  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;
    if (module.isConfigFile) continue;

    let sourceText: string;
    try {
      sourceText = readFileSync(module.fileId.path, "utf-8");
    } catch {
      continue;
    }

    let parseResult: ReturnType<typeof parseSync>;
    try {
      parseResult = parseSync(module.fileId.path, sourceText);
    } catch {
      continue;
    }

    const lineStarts = computeLineStarts(sourceText);
    const vercelFlagsLocalNames = collectVercelFlagsImports(parseResult.program);

    const visitContext: VisitContext = {
      filePath: module.fileId.path,
      lineStarts,
      results: [],
      envPrefixes: config.extraEnvPrefixes,
      sdkPatterns,
      detectConfigObjects: config.detectConfigObjects,
      vercelFlagsLocalNames,
      guard: undefined,
    };

    visitNode(parseResult.program, visitContext);
    collectedFlags.push(...visitContext.results);
  }

  collectedFlags.sort((leftFlag, rightFlag) => {
    if (leftFlag.path !== rightFlag.path) return leftFlag.path.localeCompare(rightFlag.path);
    if (leftFlag.line !== rightFlag.line) return leftFlag.line - rightFlag.line;
    return leftFlag.column - rightFlag.column;
  });

  return collectedFlags;
};

/**
 * Mark each flag whose guard span overlaps an unused export as
 * `guardsDeadCode: true`. Mirrors fallow's `correlate_with_dead_code`.
 */
export const correlateFlagsWithDeadCode = (
  flags: FeatureFlag[],
  scanResult: Pick<ScanResult, "unusedExports">,
): void => {
  if (flags.length === 0 || scanResult.unusedExports.length === 0) return;
  const unusedByFile = new Map<string, number[]>();
  for (const unusedExport of scanResult.unusedExports) {
    const existing = unusedByFile.get(unusedExport.path);
    if (existing) existing.push(unusedExport.line);
    else unusedByFile.set(unusedExport.path, [unusedExport.line]);
  }

  for (const flag of flags) {
    if (flag.guardLineStart === undefined || flag.guardLineEnd === undefined) continue;
    const linesInFile = unusedByFile.get(flag.path);
    if (!linesInFile) continue;
    const guardStart = flag.guardLineStart;
    const guardEnd = flag.guardLineEnd;
    for (const unusedLine of linesInFile) {
      if (unusedLine >= guardStart && unusedLine <= guardEnd) {
        flag.guardsDeadCode = true;
        break;
      }
    }
  }
};
