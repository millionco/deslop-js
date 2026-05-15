import type {
  FileId,
  ModuleGraph,
  ModuleNode,
  Edge,
  ImportedSymbol,
  ImportInfo,
  ReExportMapping,
} from "../types.js";
import type { ParsedModule } from "../scanner/parse.js";
import type { ResolvedImport } from "../resolver/resolve.js";
import { isConfigFile } from "../utils/is-config-file.js";

export interface GraphBuildInput {
  fileId: FileId;
  parsed: ParsedModule;
  resolvedImports: Map<string, ResolvedImport>;
  isEntryPoint: boolean;
  isTestEntry: boolean;
  isAlwaysUsed: boolean;
}

export const buildModuleGraph = (inputs: GraphBuildInput[]): ModuleGraph => {
  const fileIdMap = new Map<string, number>();
  for (const input of inputs) {
    fileIdMap.set(input.fileId.path, input.fileId.index);
  }

  const modules: ModuleNode[] = inputs.map((input) => ({
    fileId: input.fileId,
    imports: input.parsed.imports,
    exports: input.parsed.exports,
    isEntryPoint: input.isEntryPoint,
    isTestEntry: input.isTestEntry,
    isReachable: false,
    isDeclarationFile:
      input.fileId.path.endsWith(".d.ts") ||
      input.fileId.path.endsWith(".d.mts") ||
      input.fileId.path.endsWith(".d.cts"),
    isConfigFile: isConfigFile(input.fileId.path) || input.isAlwaysUsed,
  }));

  const edges: Edge[] = [];
  const reverseEdges = new Map<number, number[]>();

  const addEdge = (
    sourceIndex: number,
    targetIndex: number,
    symbols: ImportedSymbol[],
    isReExportEdge: boolean = false,
    reExportedNames: string[] = [],
    reExportMappings: ReExportMapping[] = [],
  ): void => {
    edges.push({ source: sourceIndex, target: targetIndex, importedSymbols: symbols, isReExportEdge, reExportedNames, reExportMappings });

    const existingReverseEdges = reverseEdges.get(targetIndex);
    if (existingReverseEdges) {
      if (!existingReverseEdges.includes(sourceIndex)) {
        existingReverseEdges.push(sourceIndex);
      }
    } else {
      reverseEdges.set(targetIndex, [sourceIndex]);
    }
  };

  for (const input of inputs) {
    const sourceIndex = input.fileId.index;

    for (const importInfo of input.parsed.imports) {
      if (importInfo.isGlob) {
        for (const [resolvedPath, resolvedImport] of input.resolvedImports) {
          if (!resolvedImport.resolvedPath) continue;
          const targetIndex = fileIdMap.get(resolvedImport.resolvedPath);
          if (targetIndex === undefined) continue;
          addEdge(sourceIndex, targetIndex, []);
        }
        continue;
      }

      const resolved = input.resolvedImports.get(importInfo.specifier);
      if (!resolved?.resolvedPath) continue;

      const targetIndex = fileIdMap.get(resolved.resolvedPath);
      if (targetIndex === undefined) continue;

      const importedSymbols: ImportedSymbol[] = importInfo.importedNames.map(
        (importedName) => ({
          importedName: importedName.name,
          localName: importedName.alias ?? importedName.name,
          isTypeOnly: importedName.isTypeOnly,
          isNamespace: importedName.isNamespace,
          isDefault: importedName.isDefault,
        }),
      );

      addEdge(sourceIndex, targetIndex, importedSymbols);
    }

    const reExportsByTarget = new Map<number, { names: string[]; mappings: ReExportMapping[] }>();
    for (const exportInfo of input.parsed.exports) {
      if (!exportInfo.isReExport || !exportInfo.reExportSource) continue;

      const resolved = input.resolvedImports.get(exportInfo.reExportSource);
      if (!resolved?.resolvedPath) continue;

      const targetIndex = fileIdMap.get(resolved.resolvedPath);
      if (targetIndex === undefined) continue;

      const exportedName = exportInfo.isNamespaceReExport ? "*" : exportInfo.name;
      const originalName = exportInfo.isNamespaceReExport
        ? "*"
        : (exportInfo.reExportOriginalName ?? exportInfo.name);

      const existing = reExportsByTarget.get(targetIndex);
      if (existing) {
        existing.names.push(exportedName);
        existing.mappings.push({ exportedName, originalName });
      } else {
        reExportsByTarget.set(targetIndex, {
          names: [exportedName],
          mappings: [{ exportedName, originalName }],
        });
      }
    }

    for (const [targetIndex, { names: reExportedNames, mappings: reExportMappings }] of reExportsByTarget) {
      addEdge(sourceIndex, targetIndex, [], true, reExportedNames, reExportMappings);
    }
  }

  return { modules, edges, reverseEdges, fileIdMap };
};
