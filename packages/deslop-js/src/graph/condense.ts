import type {
  CondensedEdge,
  CondensedNode,
  CondensedProjectGraph,
  ProjectGraph,
} from "./project-graph.js";

interface TarjanFrame {
  nodeId: number;
  outgoingIndex: number;
}

/**
 * Cycles between modules are common (mutually recursive imports), so the
 * raw `ProjectGraph` is a directed graph — not strictly a DAG. The
 * condensation collapses every strongly connected component into a single
 * super-node, yielding the canonical DAG view that the user reasoned about
 * in "represent the codebase as a DAG".
 */
export const condenseProjectGraph = (projectGraph: ProjectGraph): CondensedProjectGraph => {
  const totalNodes = projectGraph.nodes.length;
  const outgoingByNode = new Map<number, number[]>();
  for (const edge of projectGraph.edges) {
    const existing = outgoingByNode.get(edge.source);
    if (existing) {
      existing.push(edge.target);
    } else {
      outgoingByNode.set(edge.source, [edge.target]);
    }
  }

  const nodeIndexToOrder = new Int32Array(totalNodes).fill(-1);
  const nodeIndexToLowLink = new Int32Array(totalNodes);
  const onStackByNode = new Uint8Array(totalNodes);
  const componentIdByNode = new Int32Array(totalNodes).fill(-1);
  const stack: number[] = [];
  const components: number[][] = [];

  let visitOrderCounter = 0;

  for (const seedNode of projectGraph.nodes) {
    if (nodeIndexToOrder[seedNode.id] !== -1) continue;

    const frameStack: TarjanFrame[] = [{ nodeId: seedNode.id, outgoingIndex: 0 }];
    nodeIndexToOrder[seedNode.id] = visitOrderCounter;
    nodeIndexToLowLink[seedNode.id] = visitOrderCounter;
    visitOrderCounter++;
    stack.push(seedNode.id);
    onStackByNode[seedNode.id] = 1;

    while (frameStack.length > 0) {
      const currentFrame = frameStack[frameStack.length - 1];
      const outgoingTargets = outgoingByNode.get(currentFrame.nodeId) ?? [];

      if (currentFrame.outgoingIndex < outgoingTargets.length) {
        const targetNodeId = outgoingTargets[currentFrame.outgoingIndex];
        currentFrame.outgoingIndex++;

        if (nodeIndexToOrder[targetNodeId] === -1) {
          nodeIndexToOrder[targetNodeId] = visitOrderCounter;
          nodeIndexToLowLink[targetNodeId] = visitOrderCounter;
          visitOrderCounter++;
          stack.push(targetNodeId);
          onStackByNode[targetNodeId] = 1;
          frameStack.push({ nodeId: targetNodeId, outgoingIndex: 0 });
        } else if (onStackByNode[targetNodeId]) {
          nodeIndexToLowLink[currentFrame.nodeId] = Math.min(
            nodeIndexToLowLink[currentFrame.nodeId],
            nodeIndexToOrder[targetNodeId],
          );
        }
      } else {
        if (nodeIndexToLowLink[currentFrame.nodeId] === nodeIndexToOrder[currentFrame.nodeId]) {
          const componentMembers: number[] = [];
          const componentId = components.length;
          for (;;) {
            const poppedNodeId = stack.pop();
            if (poppedNodeId === undefined) break;
            onStackByNode[poppedNodeId] = 0;
            componentIdByNode[poppedNodeId] = componentId;
            componentMembers.push(poppedNodeId);
            if (poppedNodeId === currentFrame.nodeId) break;
          }
          components.push(componentMembers);
        }

        frameStack.pop();
        if (frameStack.length > 0) {
          const parentFrame = frameStack[frameStack.length - 1];
          nodeIndexToLowLink[parentFrame.nodeId] = Math.min(
            nodeIndexToLowLink[parentFrame.nodeId],
            nodeIndexToLowLink[currentFrame.nodeId],
          );
        }
      }
    }
  }

  const condensedNodes: CondensedNode[] = components.map((memberNodeIds, componentIndex) => ({
    id: componentIndex,
    memberNodeIds: [...memberNodeIds].sort((leftId, rightId) => leftId - rightId),
    isCycle: memberNodeIds.length > 1,
  }));

  const seenCondensedEdges = new Set<string>();
  const condensedEdges: CondensedEdge[] = [];
  for (const edge of projectGraph.edges) {
    const sourceComponent = componentIdByNode[edge.source];
    const targetComponent = componentIdByNode[edge.target];
    if (sourceComponent === -1 || targetComponent === -1) continue;
    if (sourceComponent === targetComponent) continue;
    const edgeKey = `${sourceComponent}->${targetComponent}`;
    if (seenCondensedEdges.has(edgeKey)) continue;
    seenCondensedEdges.add(edgeKey);
    condensedEdges.push({ source: sourceComponent, target: targetComponent });
  }

  return { nodes: condensedNodes, edges: condensedEdges };
};
