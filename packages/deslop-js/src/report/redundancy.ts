import type {
  DependencyGraph,
  DuplicateExport,
  DuplicateExportOccurrence,
  RedundantAlias,
} from "../types.js";

export const detectRedundantAliases = (graph: DependencyGraph): RedundantAlias[] => {
  const findings: RedundantAlias[] = [];

  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;
    if (!module.isReachable) continue;

    for (const importInfo of module.imports) {
      for (const binding of importInfo.importedNames) {
        if (!binding.isRedundantAlias) continue;
        findings.push({
          path: module.fileId.path,
          kind: "import-self-alias",
          name: binding.name,
          aliasedFrom: binding.name,
          line: importInfo.line,
          column: importInfo.column,
          confidence: "high",
          reason: `\`import { ${binding.name} as ${binding.name} }\` aliases an identifier to its own name`,
        });
      }
    }

    for (const exportInfo of module.exports) {
      if (exportInfo.isSynthetic) continue;
      if (!exportInfo.isRedundantAlias) continue;
      const kind = exportInfo.isReExport ? "reexport-self-alias" : "export-self-alias";
      const sourceSuffix = exportInfo.reExportSource ? ` from "${exportInfo.reExportSource}"` : "";
      findings.push({
        path: module.fileId.path,
        kind,
        name: exportInfo.name,
        aliasedFrom: exportInfo.name,
        line: exportInfo.line,
        column: exportInfo.column,
        confidence: "high",
        reason: `\`export { ${exportInfo.name} as ${exportInfo.name} }${sourceSuffix}\` aliases an identifier to its own name`,
      });
    }
  }

  return findings;
};

export const detectDuplicateExports = (graph: DependencyGraph): DuplicateExport[] => {
  const findings: DuplicateExport[] = [];

  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;

    const nameToOccurrences = new Map<string, DuplicateExportOccurrence[]>();
    const nameHasReExport = new Map<string, boolean>();

    for (const exportInfo of module.exports) {
      if (exportInfo.isSynthetic) continue;
      if (exportInfo.name === "*" && exportInfo.isNamespaceReExport) continue;

      const occurrence: DuplicateExportOccurrence = {
        line: exportInfo.line,
        column: exportInfo.column,
        reExportSource: exportInfo.reExportSource,
        isReExport: exportInfo.isReExport,
      };
      const existing = nameToOccurrences.get(exportInfo.name);
      if (existing) {
        existing.push(occurrence);
      } else {
        nameToOccurrences.set(exportInfo.name, [occurrence]);
      }
      if (exportInfo.isReExport) {
        nameHasReExport.set(exportInfo.name, true);
      }
    }

    for (const [name, occurrences] of nameToOccurrences) {
      if (occurrences.length < 2) continue;
      if (!nameHasReExport.get(name)) continue;

      findings.push({
        path: module.fileId.path,
        name,
        occurrences,
        confidence: "high",
        reason: `"${name}" is exported ${occurrences.length} times from the same module`,
      });
    }
  }

  return findings;
};
