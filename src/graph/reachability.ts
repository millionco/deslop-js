import type { ModuleGraph } from "../types.js";

export const markReachable = (graph: ModuleGraph): void => {
  const totalModules = graph.modules.length;
  const visited = new Uint8Array(totalModules);
  const queue: number[] = [];

  for (const module of graph.modules) {
    if (module.isEntryPoint) {
      const moduleIndex = module.fileId.index;
      if (moduleIndex < totalModules) {
        visited[moduleIndex] = 1;
        queue.push(moduleIndex);
      }
    }
  }

  const adjacencyList = new Map<number, Set<number>>();
  for (const edge of graph.edges) {
    const existingTargets = adjacencyList.get(edge.source);
    if (existingTargets) {
      existingTargets.add(edge.target);
    } else {
      adjacencyList.set(edge.source, new Set([edge.target]));
    }
  }

  let headPointer = 0;
  while (headPointer < queue.length) {
    const currentIndex = queue[headPointer++];
    const neighborTargets = adjacencyList.get(currentIndex);
    if (!neighborTargets) continue;

    for (const targetIndex of neighborTargets) {
      if (targetIndex < totalModules && !visited[targetIndex]) {
        visited[targetIndex] = 1;
        queue.push(targetIndex);
      }
    }
  }

  for (let moduleIndex = 0; moduleIndex < totalModules; moduleIndex++) {
    graph.modules[moduleIndex].isReachable = Boolean(visited[moduleIndex]);
  }
};
