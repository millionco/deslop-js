export interface SourceFile {
  index: number;
  path: string;
}

export interface ImportReference {
  specifier: string;
  importedNames: ImportBinding[];
  isTypeOnly: boolean;
  isDynamic: boolean;
  isSideEffect: boolean;
  isGlob?: boolean;
  line: number;
  column: number;
}

export interface ImportBinding {
  name: string;
  alias: string | undefined;
  isNamespace: boolean;
  isDefault: boolean;
  isTypeOnly: boolean;
}

export interface ExportReference {
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
  defaultExportLocalName?: string;
}

export interface MemberAccess {
  objectName: string;
  memberName: string;
}

export interface SourceModule {
  fileId: SourceFile;
  imports: ImportReference[];
  exports: ExportReference[];
  memberAccesses: MemberAccess[];
  wholeObjectUses: string[];
  localIdentifierReferences: string[];
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
  importedSymbols: LinkedSymbol[];
  isReExportEdge: boolean;
  reExportedNames: string[];
  reExportMappings: ReExportMapping[];
}

export interface LinkedSymbol {
  importedName: string;
  localName: string;
  isTypeOnly: boolean;
  isNamespace: boolean;
  isDefault: boolean;
}

export interface DependencyGraph {
  modules: SourceModule[];
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

export interface CircularDependency {
  files: string[];
}

export interface ScanResult {
  unusedFiles: UnusedFile[];
  unusedExports: UnusedExport[];
  unusedDependencies: UnusedDependency[];
  circularDependencies: CircularDependency[];
  totalFiles: number;
  totalExports: number;
  analysisTimeMs: number;
}

export interface ResolvedEntries {
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
