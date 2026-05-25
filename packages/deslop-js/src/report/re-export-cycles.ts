import type { DependencyGraph, ReExportCycle } from "../types.js";

/**
 * Re-export-only cycle detector. Walks the subgraph induced by edges where
 * `isReExportEdge === true` (i.e. only `export { ... } from "..."` and
 * `export * from "..."` re-exports) and finds the cycles.
 *
 * Re-export cycles are a strict subset of general dependency cycles (already
 * surfaced as `circularDependencies`), but they are particularly worth
 * separating because:
 *
 * - they are the canonical "barrel imports its own root" anti-pattern that
 *   tanks bundler tree-shaking and triggers the TDZ "Cannot access X before
 *   initialization" runtime errors,
 * - they are mechanically refactorable: reach inside the barrel and import
 *   from the leaf, no behavior change,
 * - high-confidence: there is no idiomatic reason to re-export from a module
 *   that re-exports back to you. Every general cycle includes legitimate
 *   bidirectional collaboration; every re-export cycle does not.
 *
 * Distinguishes self-loops (`export * from "./a"` inside `a.ts`) from
 * multi-node cycles, mirroring fallow's `ReExportCycleKind`.
 */
export const detectReExportCycles = (graph: DependencyGraph): ReExportCycle[] => {
  const adjacency: number[][] = Array.from({ length: graph.modules.length }, () => []);
  const reExportTargetSets: Set<number>[] = Array.from(
    { length: graph.modules.length },
    () => new Set(),
  );

  for (const edge of graph.edges) {
    if (!edge.isReExportEdge) continue;
    if (edge.target >= graph.modules.length) continue;
    if (reExportTargetSets[edge.source].has(edge.target)) continue;
    reExportTargetSets[edge.source].add(edge.target);
    adjacency[edge.source].push(edge.target);
  }

  const sccComponents = computeStronglyConnectedComponents(adjacency);
  const findings: ReExportCycle[] = [];

  for (const component of sccComponents) {
    if (component.length === 1) {
      const onlyNode = component[0];
      const hasSelfLoop = adjacency[onlyNode].includes(onlyNode);
      if (!hasSelfLoop) continue;
      const filePath = graph.modules[onlyNode].fileId.path;
      findings.push({
        files: [filePath],
        kind: "self-loop",
        confidence: "high",
        reason: `${filePath} re-exports from itself — the barrel imports its own root, which breaks bundler tree-shaking and risks TDZ runtime errors`,
      });
      continue;
    }

    const sortedFiles = component
      .map((moduleIndex) => graph.modules[moduleIndex].fileId.path)
      .sort();
    findings.push({
      files: sortedFiles,
      kind: "multi-node",
      confidence: "high",
      reason: `${sortedFiles.length} modules form a re-export cycle — refactor consumers to import from the leaf module instead of the barrel`,
    });
  }

  findings.sort((firstFinding, secondFinding) =>
    firstFinding.files[0].localeCompare(secondFinding.files[0]),
  );
  return findings;
};

/**
 * Iterative Tarjan's SCC. Returns each strongly-connected component
 * (component-of-size-1 entries are included so the caller can decide whether
 * the lone node is a self-loop).
 */
const computeStronglyConnectedComponents = (adjacency: number[][]): number[][] => {
  const nodeCount = adjacency.length;
  if (nodeCount === 0) return [];

  const indices: number[] = new Array(nodeCount).fill(-1);
  const lowLinks: number[] = new Array(nodeCount).fill(0);
  const onStack: boolean[] = new Array(nodeCount).fill(false);
  const tarjanStack: number[] = [];
  const components: number[][] = [];
  let nextIndex = 0;

  for (let startNode = 0; startNode < nodeCount; startNode++) {
    if (indices[startNode] !== -1) continue;

    const dfsStack: { node: number; successorPosition: number }[] = [
      { node: startNode, successorPosition: 0 },
    ];
    indices[startNode] = nextIndex;
    lowLinks[startNode] = nextIndex;
    nextIndex++;
    onStack[startNode] = true;
    tarjanStack.push(startNode);

    while (dfsStack.length > 0) {
      const frame = dfsStack[dfsStack.length - 1];
      const successors = adjacency[frame.node];

      if (frame.successorPosition < successors.length) {
        const successorNode = successors[frame.successorPosition];
        frame.successorPosition++;
        if (indices[successorNode] === -1) {
          indices[successorNode] = nextIndex;
          lowLinks[successorNode] = nextIndex;
          nextIndex++;
          onStack[successorNode] = true;
          tarjanStack.push(successorNode);
          dfsStack.push({ node: successorNode, successorPosition: 0 });
        } else if (onStack[successorNode]) {
          if (indices[successorNode] < lowLinks[frame.node]) {
            lowLinks[frame.node] = indices[successorNode];
          }
        }
      } else {
        if (lowLinks[frame.node] === indices[frame.node]) {
          const component: number[] = [];
          let popped: number;
          do {
            popped = tarjanStack.pop()!;
            onStack[popped] = false;
            component.push(popped);
          } while (popped !== frame.node);
          components.push(component);
        }
        dfsStack.pop();
        if (dfsStack.length > 0) {
          const parent = dfsStack[dfsStack.length - 1];
          if (lowLinks[frame.node] < lowLinks[parent.node]) {
            lowLinks[parent.node] = lowLinks[frame.node];
          }
        }
      }
    }
  }

  return components;
};
