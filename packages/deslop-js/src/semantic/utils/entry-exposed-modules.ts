import type { DependencyGraph } from "../../types.js";

export interface EntryExposureIndex {
  wildcardModuleIndices: Set<number>;
  namedReExports: Set<string>;
  isModuleWildcardExposed: (moduleIndex: number) => boolean;
  isNamedReExportedFromEntry: (modulePath: string, exportName: string) => boolean;
}

export const buildEntryExposureIndex = (graph: DependencyGraph): EntryExposureIndex => {
  const wildcardModuleIndices = new Set<number>();
  const namedReExports = new Set<string>();

  const visit = (moduleIndex: number, visited: Set<number>): void => {
    if (visited.has(moduleIndex)) return;
    visited.add(moduleIndex);
    const sourceModule = graph.modules[moduleIndex];
    if (!sourceModule) return;
    for (const edge of graph.edges) {
      if (edge.source !== moduleIndex) continue;
      if (!edge.isReExportEdge) continue;
      const targetModule = graph.modules[edge.target];
      if (!targetModule) continue;
      if (edge.reExportedNames.includes("*")) {
        wildcardModuleIndices.add(edge.target);
      }
      for (const mapping of edge.reExportMappings) {
        if (mapping.originalName === "*") continue;
        namedReExports.add(`${targetModule.fileId.path}::${mapping.originalName}`);
      }
      visit(edge.target, visited);
    }
  };

  for (const module of graph.modules) {
    if (!module.isEntryPoint) continue;
    visit(module.fileId.index, new Set());
  }

  return {
    wildcardModuleIndices,
    namedReExports,
    isModuleWildcardExposed: (moduleIndex) => wildcardModuleIndices.has(moduleIndex),
    isNamedReExportedFromEntry: (modulePath, exportName) =>
      namedReExports.has(`${modulePath}::${exportName}`),
  };
};
