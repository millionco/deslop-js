import { relative } from "node:path";
import type { ProjectGraph, ProjectGraphNodeClassification } from "./project-graph.js";

const CLASSIFICATION_COLORS: Record<ProjectGraphNodeClassification, string> = {
  entry: "#2e7d32",
  leaf: "#1565c0",
  barrel: "#7b1fa2",
  hub: "#ef6c00",
  orphan: "#c62828",
  isolated: "#616161",
};

export const projectGraphToJson = (projectGraph: ProjectGraph, indent: number = 2): string =>
  JSON.stringify(
    {
      rootDir: projectGraph.rootDir,
      nodes: projectGraph.nodes.map((node) => ({
        ...node,
        path: relative(projectGraph.rootDir, node.path),
      })),
      edges: projectGraph.edges,
      entryNodeIds: projectGraph.entryNodeIds,
      reachableNodeIds: projectGraph.reachableNodeIds,
      unreachableNodeIds: projectGraph.unreachableNodeIds,
    },
    null,
    indent,
  );

const escapeForDotLabel = (rawText: string): string =>
  rawText.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export const projectGraphToDot = (projectGraph: ProjectGraph): string => {
  const dotLines: string[] = ["digraph deslop_project_graph {"];
  dotLines.push("  rankdir=LR;");
  dotLines.push("  node [shape=box, style=rounded];");

  for (const node of projectGraph.nodes) {
    const relativePath = relative(projectGraph.rootDir, node.path) || node.path;
    const color = CLASSIFICATION_COLORS[node.classification];
    const tooltip = `${node.classification} (in=${node.inDegree} out=${node.outDegree})`;
    dotLines.push(
      `  n${node.id} [label="${escapeForDotLabel(relativePath)}", color="${color}", tooltip="${escapeForDotLabel(tooltip)}"];`,
    );
  }

  for (const edge of projectGraph.edges) {
    const style =
      edge.kind === "re-export" ? "dashed" : edge.kind === "side-effect" ? "dotted" : "solid";
    dotLines.push(`  n${edge.source} -> n${edge.target} [style=${style}];`);
  }

  dotLines.push("}");
  return dotLines.join("\n");
};
