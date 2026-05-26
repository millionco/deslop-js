import type { DependencyGraph, DeslopConfig, DeslopError, SourceModule } from "../types.js";
import { runReachabilityPipeline } from "../pipeline.js";

export type ProjectGraphEdgeKind = "import" | "re-export" | "side-effect";

export type ProjectGraphNodeClassification =
  | "entry"
  | "leaf"
  | "barrel"
  | "hub"
  | "orphan"
  | "isolated";

export interface ProjectGraphNode {
  id: number;
  path: string;
  isEntry: boolean;
  isTestEntry: boolean;
  isReachable: boolean;
  isDeclarationFile: boolean;
  isConfigFile: boolean;
  inDegree: number;
  outDegree: number;
  exportCount: number;
  importCount: number;
  classification: ProjectGraphNodeClassification;
}

export interface ProjectGraphEdge {
  source: number;
  target: number;
  kind: ProjectGraphEdgeKind;
  importedSymbols: string[];
}

export interface ProjectGraphResult {
  graph: ProjectGraph;
  errors: DeslopError[];
}

export interface ProjectGraph {
  rootDir: string;
  nodes: ProjectGraphNode[];
  edges: ProjectGraphEdge[];
  entryNodeIds: number[];
  reachableNodeIds: number[];
  unreachableNodeIds: number[];
}

export interface CondensedNode {
  id: number;
  memberNodeIds: number[];
  isCycle: boolean;
}

export interface CondensedEdge {
  source: number;
  target: number;
}

export interface CondensedProjectGraph {
  nodes: CondensedNode[];
  edges: CondensedEdge[];
}

const HUB_OUT_DEGREE_THRESHOLD = 10;
const BARREL_REEXPORT_RATIO = 0.8;

const classifyNode = (
  module: SourceModule,
  inDegree: number,
  outDegree: number,
  reExportRatio: number,
): ProjectGraphNodeClassification => {
  if (module.isEntryPoint) return "entry";
  if (!module.isReachable) return "orphan";
  if (inDegree === 0 && outDegree === 0) return "isolated";
  if (outDegree === 0) return "leaf";
  if (
    outDegree >= 2 &&
    module.exports.length > 0 &&
    reExportRatio >= BARREL_REEXPORT_RATIO &&
    module.imports.length === 0
  ) {
    return "barrel";
  }
  if (outDegree >= HUB_OUT_DEGREE_THRESHOLD) return "hub";
  return "leaf";
};

const buildEdgeFromGraph = (edge: DependencyGraph["edges"][number]): ProjectGraphEdge => {
  if (edge.isReExportEdge) {
    return {
      source: edge.source,
      target: edge.target,
      kind: "re-export",
      importedSymbols: edge.reExportedNames,
    };
  }
  if (edge.importedSymbols.length === 0) {
    return {
      source: edge.source,
      target: edge.target,
      kind: "side-effect",
      importedSymbols: [],
    };
  }
  return {
    source: edge.source,
    target: edge.target,
    kind: "import",
    importedSymbols: edge.importedSymbols.map((symbol) => symbol.importedName),
  };
};

const toProjectGraph = (rootDir: string, moduleGraph: DependencyGraph): ProjectGraph => {
  const edges = moduleGraph.edges.map(buildEdgeFromGraph);

  const inDegreeByNode = new Map<number, number>();
  const outDegreeByNode = new Map<number, number>();

  for (const edge of edges) {
    inDegreeByNode.set(edge.target, (inDegreeByNode.get(edge.target) ?? 0) + 1);
    outDegreeByNode.set(edge.source, (outDegreeByNode.get(edge.source) ?? 0) + 1);
  }

  const nodes: ProjectGraphNode[] = moduleGraph.modules.map((module) => {
    const inDegree = inDegreeByNode.get(module.fileId.index) ?? 0;
    const outDegree = outDegreeByNode.get(module.fileId.index) ?? 0;
    const reExportCount = module.exports.filter((exportInfo) => exportInfo.isReExport).length;
    const reExportRatio = module.exports.length === 0 ? 0 : reExportCount / module.exports.length;
    return {
      id: module.fileId.index,
      path: module.fileId.path,
      isEntry: module.isEntryPoint,
      isTestEntry: module.isTestEntry,
      isReachable: module.isReachable,
      isDeclarationFile: module.isDeclarationFile,
      isConfigFile: module.isConfigFile,
      inDegree,
      outDegree,
      exportCount: module.exports.length,
      importCount: module.imports.length,
      classification: classifyNode(module, inDegree, outDegree, reExportRatio),
    };
  });

  const entryNodeIds: number[] = [];
  const reachableNodeIds: number[] = [];
  const unreachableNodeIds: number[] = [];

  for (const node of nodes) {
    if (node.isEntry) entryNodeIds.push(node.id);
    if (node.isReachable) {
      reachableNodeIds.push(node.id);
    } else {
      unreachableNodeIds.push(node.id);
    }
  }

  return {
    rootDir,
    nodes,
    edges,
    entryNodeIds,
    reachableNodeIds,
    unreachableNodeIds,
  };
};

export const getProjectGraph = async (config: DeslopConfig): Promise<ProjectGraphResult> => {
  const pipelineOutcome = await runReachabilityPipeline(config);
  if (pipelineOutcome.isFatal || !pipelineOutcome.moduleGraph) {
    return {
      graph: {
        rootDir: config.rootDir,
        nodes: [],
        edges: [],
        entryNodeIds: [],
        reachableNodeIds: [],
        unreachableNodeIds: [],
      },
      errors: pipelineOutcome.setupErrors,
    };
  }

  return {
    graph: toProjectGraph(config.rootDir, pipelineOutcome.moduleGraph),
    errors: pipelineOutcome.setupErrors,
  };
};
