export interface FileId {
  index: number;
  path: string;
}

export interface ImportInfo {
  specifier: string;
  importedNames: ImportedName[];
  isTypeOnly: boolean;
  isDynamic: boolean;
  isSideEffect: boolean;
  isGlob?: boolean;
  line: number;
  column: number;
}

export interface ImportedName {
  name: string;
  alias: string | undefined;
  isNamespace: boolean;
  isDefault: boolean;
  isTypeOnly: boolean;
}

export interface ExportInfo {
  name: string;
  isDefault: boolean;
  isTypeOnly: boolean;
  isReExport: boolean;
  isSynthetic: boolean;
  reExportSource: string | undefined;
  reExportOriginalName: string | undefined;
  isNamespaceReExport: boolean;
  line: number;
  column: number;
}

export interface MemberAccess {
  objectName: string;
  memberName: string;
}

export interface ModuleNode {
  fileId: FileId;
  imports: ImportInfo[];
  exports: ExportInfo[];
  memberAccesses: MemberAccess[];
  wholeObjectUses: string[];
  isEntryPoint: boolean;
  isTestEntry: boolean;
  isReachable: boolean;
  isDeclarationFile: boolean;
  isConfigFile: boolean;
}

export interface ReExportMapping {
  exportedName: string;
  originalName: string;
}

export interface Edge {
  source: number;
  target: number;
  importedSymbols: ImportedSymbol[];
  isReExportEdge: boolean;
  reExportedNames: string[];
  reExportMappings: ReExportMapping[];
}

export interface ImportedSymbol {
  importedName: string;
  localName: string;
  isTypeOnly: boolean;
  isNamespace: boolean;
  isDefault: boolean;
}

export interface ModuleGraph {
  modules: ModuleNode[];
  edges: Edge[];
  reverseEdges: Map<number, number[]>;
  fileIdMap: Map<string, number>;
}

export interface UnusedFile {
  path: string;
}

export interface UnusedExport {
  path: string;
  name: string;
  line: number;
  column: number;
  isTypeOnly: boolean;
}

export interface UnusedDependency {
  name: string;
  isDevDependency: boolean;
}

export interface AnalysisResult {
  unusedFiles: UnusedFile[];
  unusedExports: UnusedExport[];
  unusedDependencies: UnusedDependency[];
  totalFiles: number;
  totalExports: number;
  analysisTimeMs: number;
}

export interface DiscoveredEntryPoints {
  productionEntries: string[];
  testEntries: string[];
  alwaysUsedFiles: string[];
}

export interface DeslopConfig {
  rootDir: string;
  entryPatterns: string[];
  ignorePatterns: string[];
  includeExtensions: string[];
  tsConfigPath: string | undefined;
  reportTypes: boolean;
  includeEntryExports: boolean;
}
