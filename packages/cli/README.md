# cli

CLI for [deslop-js](https://github.com/aidenybai/deslop-js) — find unused files, exports, dependencies, and circular imports.

## Install

```bash
npm install -g cli
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

Output JSON:

```bash
deslop ./my-app --json
```

Fail CI when unused code is found (files, exports, or dependencies — not circular imports):

```bash
deslop ./my-app --fail-on-issues
```

Fail CI when circular imports are found:

```bash
deslop ./my-app --fail-on-cycles
```

### Options

| Option                    | Description                                                       |
| ------------------------- | ----------------------------------------------------------------- |
| `[root]`                  | Project root directory (default: `.`; must exist)                 |
| `-e, --entry <pattern>`   | Entry point glob patterns                                         |
| `-i, --ignore <pattern>`  | Glob patterns to exclude                                          |
| `--extensions <ext>`      | File extensions to scan (e.g. `.ts` `.vue`)                        |
| `--tsconfig <path>`       | Path to tsconfig.json for alias resolution                        |
| `--report-types`          | Include type-only exports in results                              |
| `--include-entry-exports` | Report unused exports from entry files                            |
| `--json`                  | Output results as JSON                                            |
| `--fail-on-issues`        | Exit 1 when unused files, exports, or dependencies are found      |
| `--fail-on-cycles`        | Exit 1 when circular imports are found                            |

### Exit codes

| Code | Meaning                                      |
| ---- | -------------------------------------------- |
| `0`  | Success (no failure flags triggered)         |
| `1`  | Issues found (per `--fail-on-*` flags) or runtime error |
| `2`  | Invalid project root                         |
