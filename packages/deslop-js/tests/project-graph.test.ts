import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve, relative } from "node:path";
import {
  condenseProjectGraph,
  defineConfig,
  getProjectGraph,
  projectGraphToDot,
  projectGraphToJson,
} from "../src/index.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "fixtures");

describe("getProjectGraph", () => {
  it("returns nodes and edges with orphan classification for unused files", async () => {
    const fixtureDir = resolve(FIXTURES_DIR, "simple-app");
    const config = defineConfig({ rootDir: fixtureDir });
    const { graph } = await getProjectGraph(config);

    assert.ok(graph.nodes.length > 0, "graph should contain nodes");
    assert.ok(graph.edges.length > 0, "graph should contain edges");
    assert.ok(graph.entryNodeIds.length > 0, "graph should have at least one entry");

    const orphanNode = graph.nodes.find(
      (node) => relative(fixtureDir, node.path) === "src/orphan.ts",
    );
    assert.ok(orphanNode, "orphan.ts should appear as a node");
    assert.equal(orphanNode!.classification, "orphan");
    assert.equal(orphanNode!.isReachable, false);

    const indexNode = graph.nodes.find(
      (node) => relative(fixtureDir, node.path) === "src/index.ts",
    );
    assert.ok(indexNode, "index.ts should be a node");
    assert.equal(indexNode!.classification, "entry");
    assert.equal(indexNode!.isEntry, true);
  });

  it("computes consistent in/out degrees from the edge list", async () => {
    const fixtureDir = resolve(FIXTURES_DIR, "simple-app");
    const { graph } = await getProjectGraph(defineConfig({ rootDir: fixtureDir }));

    const computedInDegree = new Map<number, number>();
    const computedOutDegree = new Map<number, number>();
    for (const edge of graph.edges) {
      computedInDegree.set(edge.target, (computedInDegree.get(edge.target) ?? 0) + 1);
      computedOutDegree.set(edge.source, (computedOutDegree.get(edge.source) ?? 0) + 1);
    }
    for (const node of graph.nodes) {
      assert.equal(
        node.inDegree,
        computedInDegree.get(node.id) ?? 0,
        `inDegree mismatch for ${node.path}`,
      );
      assert.equal(
        node.outDegree,
        computedOutDegree.get(node.id) ?? 0,
        `outDegree mismatch for ${node.path}`,
      );
    }
  });

  it("serializes to JSON and DOT without throwing", async () => {
    const fixtureDir = resolve(FIXTURES_DIR, "simple-app");
    const { graph } = await getProjectGraph(defineConfig({ rootDir: fixtureDir }));

    const jsonOutput = projectGraphToJson(graph);
    const parsedJson = JSON.parse(jsonOutput);
    assert.ok(Array.isArray(parsedJson.nodes));
    assert.ok(Array.isArray(parsedJson.edges));

    const dotOutput = projectGraphToDot(graph);
    assert.match(dotOutput, /^digraph deslop_project_graph/);
    assert.match(dotOutput, /->/);
  });

  it("condenses to a DAG with no self-edges and unique super-nodes", async () => {
    const fixtureDir = resolve(FIXTURES_DIR, "simple-app");
    const { graph } = await getProjectGraph(defineConfig({ rootDir: fixtureDir }));

    const condensed = condenseProjectGraph(graph);

    const memberToComponentCount = new Map<number, number>();
    for (const condensedNode of condensed.nodes) {
      for (const memberNodeId of condensedNode.memberNodeIds) {
        memberToComponentCount.set(
          memberNodeId,
          (memberToComponentCount.get(memberNodeId) ?? 0) + 1,
        );
      }
    }
    for (const occurrenceCount of memberToComponentCount.values()) {
      assert.equal(occurrenceCount, 1, "each node should belong to exactly one component");
    }
    for (const condensedEdge of condensed.edges) {
      assert.notEqual(
        condensedEdge.source,
        condensedEdge.target,
        "condensed graph has no self-edges",
      );
    }
  });

  it("returns an empty graph (no throw) for a non-existent root directory", async () => {
    const { graph, errors } = await getProjectGraph(
      defineConfig({ rootDir: resolve(FIXTURES_DIR, "does-not-exist") }),
    );
    assert.equal(graph.nodes.length, 0);
    assert.equal(graph.edges.length, 0);
    assert.ok(errors.length > 0);
  });
});
