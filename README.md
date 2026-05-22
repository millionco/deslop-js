# deslop-js

[![version](https://img.shields.io/npm/v/deslop-js?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/deslop-js)
[![downloads](https://img.shields.io/npm/dt/deslop-js.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/deslop-js)

Deslop JavaScript code.

Finds unused files, dead exports, dead dependencies, circular imports, redundant aliases, duplicate types, and other DRY violations. Each finding carries a confidence tier so you can gate CI on the high-signal ones and treat the rest as code-review prompts.

## Install

```bash
npm install deslop-js
```

## Usage

```ts
import { analyze, defineConfig } from "deslop-js";

const config = defineConfig({ rootDir: "./my-project" });
const result = await analyze(config);

// unused-code findings (syntactic)
result.unusedFiles; // files unreachable from any entry point
result.unusedExports; // exported symbols never imported
result.unusedDependencies; // package.json deps not imported anywhere
result.circularDependencies; // import cycles

// redundancy / DRY findings (syntactic, on by default)
result.redundantAliases; // `import { x as x }`, useless re-export renames
result.duplicateExports; // same name exported twice from one module
result.duplicateImports; // same specifier imported multiple times
result.redundantTypePatterns; // `T & {}`, `Partial<Partial<T>>`, etc.
result.identityWrappers; // `const wrap = (x) => fn(x)`
result.duplicateTypeDefinitions; // same-shape type declared in N files
result.duplicateInlineTypes; // anonymous `{ a, b, c }` repeated across modules
result.simplifiableFunctions; // `() => { return x }`, `await x; return x`
result.simplifiableExpressions; // `!!x`, `x ? x : y`, `cond ? true : false`
result.duplicateConstants; // same literal value across files

// semantic findings (type-aware, opt-in via `semantic.enabled: true`)
result.unusedTypes; // type aliases / interfaces never referenced
result.unusedEnumMembers; // enum members no reference site uses
result.unusedClassMembers; // class members no caller invokes
result.misclassifiedDependencies; // `dependencies` entries used only as types

// diagnostics
result.analysisErrors; // structured errors from any pipeline stage
result.totalFiles;
result.totalExports;
result.analysisTimeMs;
```

## Options

`defineConfig` accepts a required `rootDir` and optional overrides:

```ts
const config = defineConfig({
  rootDir: "./my-project",
  entryPatterns: ["src/main.ts"],
  ignorePatterns: ["**/*.test.ts"],
  tsConfigPath: "./tsconfig.json",
  reportTypes: true,
  includeEntryExports: true,
  reportRedundancy: true,
  semantic: { enabled: true },
});
```

| Option                | Type                  | Default                                                          | Description                                              |
| --------------------- | --------------------- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| `rootDir`             | `string`              | required                                                         | Project root directory                                   |
| `entryPatterns`       | `string[]`            | auto-detected                                                    | Entry point glob patterns                                |
| `ignorePatterns`      | `string[]`            | `[]`                                                             | Glob patterns to exclude from analysis                   |
| `includeExtensions`   | `string[]`            | `[".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cjs", ".cts"]` | File extensions to scan                                  |
| `tsConfigPath`        | `string \| undefined` | `undefined`                                                      | Path to tsconfig.json for path alias resolution          |
| `reportTypes`         | `boolean`             | `false`                                                          | Include type-only exports in `unusedExports`             |
| `includeEntryExports` | `boolean`             | `false`                                                          | Report unused exports from entry files                   |
| `reportRedundancy`    | `boolean`             | `true`                                                           | Emit the redundancy / DRY findings listed above          |
| `semantic`            | `SemanticConfig`      | `undefined`                                                      | Opt-in TypeScript type-aware analysis (see below)        |

### Semantic (type-aware) analysis

Off by default. Enable when you have `typescript` installed and a valid `tsconfig.json`:

```ts
const config = defineConfig({
  rootDir: "./my-project",
  semantic: {
    enabled: true,
    reportUnusedTypes: true,
    reportUnusedEnumMembers: true,
    reportUnusedClassMembers: false, // off by default, noisy on framework code
    reportMisclassifiedDependencies: true,
    reportRedundantVariableAliases: true,
    reportRoundTripAliases: true,
  },
});
```

| Option                            | Default      | Notes                                                                                                                                                          |
| --------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`                         | `false`      | Master switch; semantic analysis loads the TS program and adds ~1–3s per scan                                                                                  |
| `reportUnusedTypes`               | `true`       | Type aliases / interfaces / type-only exports never referenced                                                                                                 |
| `reportUnusedEnumMembers`         | `true`       | Enum members no reference site reads or writes                                                                                                                 |
| `reportUnusedClassMembers`        | **`false`**  | Subclass overrides, framework method-by-name invocation (`@HttpGet`, lifecycle hooks) produce too many stylistic FPs to enable by default. Opt in selectively. |
| `reportMisclassifiedDependencies` | `true`       | `dependencies` packages used only via `import type`                                                                                                            |
| `reportRedundantVariableAliases`  | `true`       | Local aliases like `const X = Y; export { X }`                                                                                                                 |
| `reportRoundTripAliases`          | `true`       | `import { X as Y } from "./a"; export { Y as X }`                                                                                                              |

## Findings have confidence tiers

Every redundancy / semantic finding carries `confidence: "high" | "medium" | "low"`. Use `"high"` for CI gates; `"medium"` and `"low"` are best treated as code-review prompts since intent is sometimes unknowable from syntax alone (e.g. `?? null` may be required by a typed callback signature).

## Error handling

`analyze()` never throws on a corrupted file, unparseable `tsconfig`, or missing dependency. Failures surface as `analysisErrors: DeslopError[]` with structured `code`, `module`, `severity`, and `path` fields. See `errors.ts` for the full taxonomy. Errors at `severity: "info"` (empty files, binary files, minified bundles skipped from redundancy analysis) are informational and do not indicate problems.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm format
```

## License

MIT
