import { relative } from "node:path";
import type { Writable } from "node:stream";
import {
  condenseProjectGraph,
  defineConfig,
  getProjectGraph,
  projectGraphToDot,
  projectGraphToJson,
} from "deslop-js";
import type { ProjectGraphNode } from "deslop-js";
import {
  EXIT_CODE_INVALID_ROOT,
  EXIT_CODE_SUCCESS,
  MISSING_PACKAGE_JSON_WARNING,
} from "./constants.js";
import type { GraphOptions } from "./types.js";
import { validateRootDirectory } from "./utils/validate-root-directory.js";

interface GraphOutput {
  stdout: Writable;
  stderr: Writable;
}

const defaultGraphOutput = (): GraphOutput => ({
  stdout: process.stdout,
  stderr: process.stderr,
});

const formatHumanReadableGraph = (
  rootDir: string,
  nodes: ProjectGraphNode[],
  edgeCount: number,
  condensedCycleCount: number,
): string => {
  const lines: string[] = [];
  const counts: Record<string, number> = {};
  for (const node of nodes) {
    counts[node.classification] = (counts[node.classification] ?? 0) + 1;
  }
  lines.push(
    `Project graph: ${nodes.length} nodes, ${edgeCount} edges, ${condensedCycleCount} cycles`,
  );
  lines.push("");
  for (const classification of ["entry", "hub", "barrel", "leaf", "isolated", "orphan"] as const) {
    const count = counts[classification] ?? 0;
    lines.push(`  ${classification.padEnd(10)} ${count}`);
  }
  lines.push("");
  const orphans = nodes
    .filter((node) => node.classification === "orphan")
    .slice(0, 20)
    .map((node) => `  ${relative(rootDir, node.path)}`);
  if (orphans.length > 0) {
    lines.push(`Top orphans (${orphans.length} of ${counts.orphan ?? 0} shown):`);
    lines.push(...orphans);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

export const runGraph = async (
  options: GraphOptions,
  output: GraphOutput = defaultGraphOutput(),
): Promise<number> => {
  const rootValidation = validateRootDirectory(options.root);

  if (!rootValidation.isValid) {
    output.stderr.write(`deslop: ${rootValidation.errorMessage}\n`);
    return EXIT_CODE_INVALID_ROOT;
  }

  if (rootValidation.missingPackageJson) {
    output.stderr.write(`deslop: ${MISSING_PACKAGE_JSON_WARNING}\n`);
  }

  const config = defineConfig({
    rootDir: rootValidation.resolvedPath,
    entryPatterns: options.entry,
    ignorePatterns: options.ignore ?? [],
    includeExtensions: options.extensions,
    tsConfigPath: options.tsconfig,
  });

  const { graph } = await getProjectGraph(config);

  if (options.format === "dot") {
    output.stdout.write(`${projectGraphToDot(graph)}\n`);
    return EXIT_CODE_SUCCESS;
  }

  if (options.format === "json") {
    output.stdout.write(`${projectGraphToJson(graph)}\n`);
    return EXIT_CODE_SUCCESS;
  }

  const condensed = condenseProjectGraph(graph);
  const cycleCount = condensed.nodes.filter((condensedNode) => condensedNode.isCycle).length;
  output.stdout.write(
    formatHumanReadableGraph(
      rootValidation.resolvedPath,
      graph.nodes,
      graph.edges.length,
      cycleCount,
    ),
  );
  return EXIT_CODE_SUCCESS;
};
