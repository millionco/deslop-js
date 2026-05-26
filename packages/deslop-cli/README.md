# deslop-cli

Deslop JavaScript code.

CLI for [deslop-js](https://github.com/aidenybai/deslop-js). Finds unused files, dead exports, dead dependencies, circular imports, redundant aliases, duplicate types, and other DRY violations.

## Install

```bash
npm install -g deslop-cli
```

Requires Node.js 22 or later.

## Usage

Pass an explicit project root when possible (especially in monorepos):

```bash
deslop ./my-app
deslop analyze ./my-app
```

Analyze the current directory:

```bash
deslop
```

Output JSON for programmatic consumption:

```bash
deslop ./my-app --json
```

Fail CI when unused code is found (files, exports, or dependencies, not circular imports):

```bash
deslop ./my-app --fail-on-issues
```

Fail CI when circular imports are found:

```bash
deslop ./my-app --fail-on-cycles
```

## Graph view (`deslop graph`)

View the codebase as a dependency DAG. Nodes are files; edges are imports / re-exports / side-effect imports. Each node carries a classification (`entry`, `leaf`, `barrel`, `hub`, `orphan`, `isolated`):

```bash
deslop graph ./my-app                  # summary with node counts and top orphans
deslop graph ./my-app --format json    # full node + edge list (pipe into jq, your own viewer, etc.)
deslop graph ./my-app --format dot     # Graphviz DOT (pipe into `dot -Tsvg`)
```

The condensation (strongly connected components collapsed into super-nodes) is reported as the cycle count in the summary view.

## Prune (`deslop prune`)

Iteratively delete orphan nodes from the DAG. `deslop prune` is dry-run by default; pass `--apply` to actually remove files. Each pass re-analyzes the smaller graph so cascade orphans — files only kept alive by re-exports inside files we just removed — get cleaned up too.

```bash
deslop prune ./my-app                  # preview the cascade
deslop prune ./my-app --apply          # actually delete unreachable files
deslop prune ./my-app --apply --max-iterations 4
```

## What `deslop` reports

The default scan emits the following finding categories (each grouped in human output, fully detailed in `--json`):

| Category                  | What it catches                                                                  |
| ------------------------- | -------------------------------------------------------------------------------- |
| `unusedFiles`             | Files unreachable from any entry point                                           |
| `unusedExports`           | Exported symbols never imported anywhere                                         |
| `unusedDependencies`      | `package.json` deps not imported                                                 |
| `circularDependencies`    | Import cycles                                                                    |
| `redundantAliases`        | `import { x as x }`, useless re-export renames                                   |
| `duplicateExports`        | Same name exported twice from one module                                         |
| `duplicateImports`        | Same specifier imported on multiple lines (merge them)                           |
| `redundantTypePatterns`   | `T & {}`, `Partial<Partial<T>>`, `Pick<T, keyof T>`, empty `extends`             |
| `identityWrappers`        | `const wrap = (x) => fn(x)`, calls without transforming                          |
| `duplicateTypeDefinitions`| Same structural type declared in multiple files                                  |
| `duplicateInlineTypes`    | Anonymous `{ a, b, c }` shapes repeated across modules                           |
| `simplifiableFunctions`   | `(x) => { return f(x) }`, `await x; return x;`, useless `async`                  |
| `simplifiableExpressions` | `!!x`, `x ? x : y`, `cond ? true : false`, `x !== null && x !== undefined`       |
| `duplicateConstants`      | Same literal value used in N files under different names                         |
| `analysisErrors`          | Structured info / warning / error notes (parse failures, skipped files, etc.)    |

Type-aware findings (`unusedTypes`, `unusedClassMembers`, `misclassifiedDependencies`, etc.) require enabling the semantic layer programmatically. See the [`deslop-js` README](https://github.com/aidenybai/deslop-js#semantic-type-aware-analysis). They are not exposed via CLI flags yet.

### Options

| Option                    | Description                                                       |
| ------------------------- | ----------------------------------------------------------------- |
| `[root]`                  | Project root directory (default: `.`; must exist)                 |
| `-e, --entry <pattern>`   | Entry point glob patterns                                         |
| `-i, --ignore <pattern>`  | Glob patterns to exclude                                          |
| `--extensions <ext>`      | File extensions to scan (e.g. `.ts` `.vue`)                       |
| `--tsconfig <path>`       | Path to tsconfig.json for alias resolution                        |
| `--report-types`          | Include type-only exports in results                              |
| `--include-entry-exports` | Report unused exports from entry files                            |
| `--json`                  | Output results as JSON                                            |
| `--fail-on-issues`        | Exit 1 when unused files, exports, or dependencies are found      |
| `--fail-on-cycles`        | Exit 1 when circular imports are found                            |

### Exit codes

| Code | Meaning                                                 |
| ---- | ------------------------------------------------------- |
| `0`  | Success (no failure flags triggered)                    |
| `1`  | Issues found (per `--fail-on-*` flags) or runtime error |
| `2`  | Invalid project root                                    |

### Confidence tiers

Every redundancy finding carries a confidence tier (`high` / `medium` / `low`) visible in human and JSON output. Use `high` for CI gates; `medium` and `low` are best as code-review prompts. Some patterns flagged at `medium` (`x ?? null`, single-name `duplicateConstants` across packages) have legitimate intent ripgrep alone can't disambiguate.

### Skipped files

Files identified as empty, binary, or minified bundles are skipped with an `info`-severity `analysisErrors` note. This isn't an error. It means the file looked machine-generated or non-source and was excluded from analysis to avoid producing irrelevant findings.
