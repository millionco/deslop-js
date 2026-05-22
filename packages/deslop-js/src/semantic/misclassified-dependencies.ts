import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import type {
  DependencyGraph,
  DeslopConfig,
  MisclassifiedDependency,
  SourceModule,
} from "../types.js";
import { SEMANTIC_TRACE_MAX_ENTRIES } from "../constants.js";
import { extractPackageName } from "../utils/package-name.js";
import type { SemanticContext } from "./program.js";
import { buildImportedSymbolIndex } from "./imported-symbol-kinds.js";

interface SyntacticImportSummary {
  totalImports: number;
  typeOnlyImports: number;
  valueImports: number;
  importerPaths: Set<string>;
}

const syntacticUsage = (module: SourceModule, packageName: string): boolean[] => {
  const decisions: boolean[] = [];
  for (const importInfo of module.imports) {
    const resolvedPackage = extractPackageName(importInfo.specifier);
    if (resolvedPackage !== packageName) continue;
    if (importInfo.isTypeOnly) {
      decisions.push(true);
      continue;
    }
    const everyBindingIsTypeOnly =
      importInfo.importedNames.length > 0 &&
      importInfo.importedNames.every((binding) => binding.isTypeOnly);
    decisions.push(everyBindingIsTypeOnly);
  }
  return decisions;
};

const summarizeSyntactic = (
  graph: DependencyGraph,
  packageName: string,
): SyntacticImportSummary => {
  const summary: SyntacticImportSummary = {
    totalImports: 0,
    typeOnlyImports: 0,
    valueImports: 0,
    importerPaths: new Set(),
  };
  for (const module of graph.modules) {
    const decisions = syntacticUsage(module, packageName);
    if (decisions.length === 0) continue;
    summary.importerPaths.add(module.fileId.path);
    for (const isTypeOnly of decisions) {
      summary.totalImports += 1;
      if (isTypeOnly) summary.typeOnlyImports += 1;
      else summary.valueImports += 1;
    }
  }
  return summary;
};

export const detectMisclassifiedDependencies = (
  graph: DependencyGraph,
  config: DeslopConfig,
  context: SemanticContext | undefined,
): MisclassifiedDependency[] => {
  if (!config.semantic.enabled) return [];
  if (!config.semantic.reportMisclassifiedDependencies) return [];

  const packageJsonPath = resolve(config.rootDir, "package.json");
  let packageJson: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    packageJson = JSON.parse(content);
  } catch {
    return [];
  }

  const declaredProdDependencies = Object.keys(packageJson.dependencies ?? {});
  if (declaredProdDependencies.length === 0) return [];

  const symbolIndex = context ? buildImportedSymbolIndex(graph, context) : undefined;
  const findings: MisclassifiedDependency[] = [];

  for (const dependencyName of declaredProdDependencies) {
    if (dependencyName.startsWith("@types/")) continue;
    const syntactic = summarizeSyntactic(graph, dependencyName);
    if (syntactic.totalImports === 0) continue;

    const hasSyntacticValueImport = syntactic.valueImports > 0;
    const hasCheckerValueImport = symbolIndex?.hasAnyValueImport(dependencyName) ?? false;
    if (hasSyntacticValueImport && hasCheckerValueImport) continue;
    if (hasSyntacticValueImport && !symbolIndex) continue;

    const usages = symbolIndex?.byPackage.get(dependencyName) ?? [];
    const checkerValueCount = usages.filter((usage) => !usage.isResolvedTypeOnly).length;
    const checkerTotal = usages.length;

    const isCheckerCertain = checkerTotal > 0;
    const usingCheckerEvidence = isCheckerCertain && !hasCheckerValueImport;

    if (!usingCheckerEvidence && hasSyntacticValueImport) continue;
    if (!usingCheckerEvidence && syntactic.valueImports > 0) continue;

    const confidence: MisclassifiedDependency["confidence"] = usingCheckerEvidence
      ? "high"
      : syntactic.typeOnlyImports >= 2
        ? "high"
        : "medium";

    const reasonParts: string[] = [
      `\`${dependencyName}\` is declared in dependencies but only imported as types`,
    ];
    if (usingCheckerEvidence) {
      reasonParts.push(`checker confirms ${checkerValueCount}/${checkerTotal} value imports`);
    } else {
      reasonParts.push(
        `${syntactic.typeOnlyImports} type-only import${syntactic.typeOnlyImports === 1 ? "" : "s"} (syntactic)`,
      );
    }

    const trace = [
      `${syntactic.totalImports} total import sites`,
      `syntactic: ${syntactic.typeOnlyImports} type-only / ${syntactic.valueImports} value`,
      symbolIndex
        ? `checker: ${checkerValueCount} value / ${checkerTotal - checkerValueCount} type-only`
        : "no TS checker available (semantic context absent)",
      `importers: ${[...syntactic.importerPaths].slice(0, 3).join(" | ")}`,
    ];

    findings.push({
      name: dependencyName,
      declaredAs: "dependency",
      recommended: "devDependency",
      confidence,
      reason: reasonParts.join(" — "),
      trace: trace.slice(0, SEMANTIC_TRACE_MAX_ENTRIES),
    });
  }

  return findings;
};
