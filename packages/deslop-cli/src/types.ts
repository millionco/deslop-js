export interface AnalyzeOptions {
  root: string;
  entry?: string[];
  ignore?: string[];
  extensions?: string[];
  tsconfig?: string;
  reportTypes: boolean;
  includeEntryExports: boolean;
  json: boolean;
  failOnIssues: boolean;
  failOnCycles: boolean;
}

export interface GraphOptions {
  root: string;
  entry?: string[];
  ignore?: string[];
  extensions?: string[];
  tsconfig?: string;
  format: "summary" | "json" | "dot";
}

export interface PruneOptions {
  root: string;
  entry?: string[];
  ignore?: string[];
  extensions?: string[];
  tsconfig?: string;
  dryRun: boolean;
  maxIterations?: number;
}

export interface RootValidationResult {
  isValid: boolean;
  resolvedPath: string;
  errorMessage?: string;
  missingPackageJson: boolean;
}
