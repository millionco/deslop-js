---
"deslop-js": minor
"deslop-cli": minor
---

Expose the codebase as a DAG and add a prune-by-deletion workflow.

- `deslop-js`: new `getProjectGraph(config)` returns a serializable `ProjectGraph` (nodes with classification: `entry`/`leaf`/`barrel`/`hub`/`orphan`/`isolated`, plus typed edges). `condenseProjectGraph(graph)` collapses strongly connected components into a true DAG view. `projectGraphToJson(graph)` and `projectGraphToDot(graph)` produce serializable output for tooling/visualizers.
- `deslop-js`: new `pruneUnusedFiles(config, options)` iteratively deletes orphan nodes from disk, re-running analysis after each pass so cascade orphans (files only kept alive by re-exports inside files we just removed) get cleaned up too. Supports `dryRun` (default behaviour from the CLI) and `maxIterations`.
- `deslop-cli`: new `deslop graph` subcommand prints a summary, JSON, or Graphviz DOT representation of the DAG. New `deslop prune` subcommand previews the prune cascade (dry-run by default) or applies it with `--apply`.

The analysis pipeline was extracted into `pipeline.ts` so `analyze()` and the new graph/prune APIs share the same module-graph construction.
