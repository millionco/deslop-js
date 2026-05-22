import type {
  DependencyGraph,
  DuplicateImport,
  DuplicateImportOccurrence,
  DuplicateTypeDefinition,
  DuplicateTypeDefinitionInstance,
  IdentityWrapper,
  RedundantTypePattern,
} from "../types.js";

export const detectDuplicateImports = (graph: DependencyGraph): DuplicateImport[] => {
  const findings: DuplicateImport[] = [];

  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;

    const specifierToOccurrences = new Map<string, DuplicateImportOccurrence[]>();
    for (const importInfo of module.imports) {
      if (importInfo.isSideEffect) continue;
      if (importInfo.isDynamic) continue;
      if (importInfo.isGlob) continue;
      const occurrence: DuplicateImportOccurrence = {
        line: importInfo.line,
        column: importInfo.column,
        importedNames: importInfo.importedNames.map((binding) =>
          binding.isNamespace ? `* as ${binding.alias ?? ""}` : (binding.alias ?? binding.name),
        ),
        isTypeOnly: importInfo.isTypeOnly,
      };
      const existing = specifierToOccurrences.get(importInfo.specifier);
      if (existing) {
        existing.push(occurrence);
      } else {
        specifierToOccurrences.set(importInfo.specifier, [occurrence]);
      }
    }

    for (const [specifier, occurrences] of specifierToOccurrences) {
      if (occurrences.length < 2) continue;
      findings.push({
        path: module.fileId.path,
        specifier,
        occurrences,
        confidence: "high",
        reason: `"${specifier}" is imported ${occurrences.length} times in this file — merge into a single statement`,
      });
    }
  }

  return findings;
};

export const detectRedundantTypePatterns = (graph: DependencyGraph): RedundantTypePattern[] => {
  const findings: RedundantTypePattern[] = [];

  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;
    for (const parsedPattern of module.redundantTypePatterns) {
      findings.push({
        path: module.fileId.path,
        typeName: parsedPattern.typeName,
        kind: parsedPattern.kind,
        line: parsedPattern.line,
        column: parsedPattern.column,
        confidence: "high",
        reason: parsedPattern.reason,
        suggestion: parsedPattern.suggestion,
      });
    }
  }

  return findings;
};

export const detectIdentityWrappers = (graph: DependencyGraph): IdentityWrapper[] => {
  const findings: IdentityWrapper[] = [];

  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;
    for (const parsedWrapper of module.identityWrappers) {
      findings.push({
        path: module.fileId.path,
        wrapperName: parsedWrapper.wrapperName,
        wrappedExpression: parsedWrapper.wrappedExpression,
        line: parsedWrapper.line,
        column: parsedWrapper.column,
        confidence: "high",
        reason: `\`${parsedWrapper.wrapperName}\` is a thin wrapper that forwards every argument to \`${parsedWrapper.wrappedExpression}\` unchanged`,
      });
    }
  }

  return findings;
};

export const detectDuplicateTypeDefinitions = (
  graph: DependencyGraph,
): DuplicateTypeDefinition[] => {
  const hashToInstances = new Map<string, DuplicateTypeDefinitionInstance[]>();

  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;
    for (const typeHash of module.typeDefinitionHashes) {
      const instance: DuplicateTypeDefinitionInstance = {
        path: module.fileId.path,
        typeName: typeHash.typeName,
        line: typeHash.line,
        column: typeHash.column,
      };
      const existing = hashToInstances.get(typeHash.structuralHash);
      if (existing) {
        existing.push(instance);
      } else {
        hashToInstances.set(typeHash.structuralHash, [instance]);
      }
    }
  }

  const findings: DuplicateTypeDefinition[] = [];
  for (const [structuralHash, instances] of hashToInstances) {
    if (instances.length < 2) continue;
    const uniquePaths = new Set(instances.map((instance) => instance.path));
    if (uniquePaths.size < 2) continue;
    const uniqueNames = new Set(instances.map((instance) => instance.typeName));
    const isAllSameName = uniqueNames.size === 1;
    findings.push({
      structuralHash,
      instances,
      confidence: isAllSameName ? "high" : "medium",
      reason: isAllSameName
        ? `${instances.length} identically-named type definitions of the same shape across ${uniquePaths.size} files — extract a shared definition`
        : `${instances.length} structurally-identical type definitions detected across ${uniquePaths.size} files under different names (${[...uniqueNames].join(", ")}) — confirm whether the rename is intentional`,
    });
  }

  return findings;
};
