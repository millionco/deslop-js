# deslop-js

[![version](https://img.shields.io/npm/v/deslop-js?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/deslop-js)
[![downloads](https://img.shields.io/npm/dt/deslop-js.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/deslop-js)

Deslop JavaScript code.

Finds unused files, dead exports, dead dependencies, circular imports, redundant aliases, duplicate types, and other DRY violations. Each finding carries a confidence tier so you can gate CI on the high-signal ones and treat the rest as code-review prompts.

## Install

```bash
npm install deslop-js
```

## CLI

The `deslop-cli` package provides a command-line interface:

```bash
npm install -g deslop-cli
```

### Quick start

```bash
# scan the current directory
deslop

# scan a specific project
deslop ./my-project

# use the explicit analyze sub-command (equivalent to the above)
deslop analyze ./my-project
```

### Options

```bash
deslop [root] [options]

# custom entry points
deslop --entry src/main.ts --entry src/worker.ts

# ignore test files
deslop --ignore "**/*.test.ts" --ignore "**/__mocks__/**"

# only scan specific extensions
deslop --extensions .ts .tsx

# resolve path aliases via tsconfig
deslop --tsconfig ./tsconfig.json

# include type-only exports in results
deslop --report-types

# report unused exports from entry files too
deslop --include-entry-exports

# output results as JSON (useful for CI or piping to other tools)
deslop --json

# exit with code 1 when unused code is found (for CI gates)
deslop --fail-on-issues

# exit with code 1 when circular imports are found
deslop --fail-on-cycles
```

### CI example

```bash
# fail the build if there are unused exports or circular imports
deslop ./src --fail-on-issues --fail-on-cycles --ignore "**/*.test.ts"
```

## Programmatic Usage

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
result.crossFileDuplicateExports; // same export name shipped by 2+ files that share an importer
result.reExportCycles; // `export * from "./a"` cycles (self-loop or multi-node)
result.privateTypeLeaks; // exported signature references a non-exported local type

// code clones (token-based copy-paste, opt-in via `codeClones.enabled: true`)
result.codeClones; // suffix-array + LCP detected duplicate code blocks
result.codeCloneFamilies; // clones grouped by file set + refactoring suggestions
result.mirroredDirectories; // directory pairs with many identical files

// feature flags (opt-in via `featureFlags.enabled: true`)
result.featureFlags; // LaunchDarkly/Statsig/Unleash/PostHog/Vercel Flags/process.env.* uses

// function complexity hotspots (opt-in via `complexity.enabled: true`)
result.complexFunctions; // McCabe cyclomatic + SonarSource cognitive per function

// TypeScript-specific smells (on by default)
result.unnecessaryAssertions; // `x as unknown as T`, `x as any`, `x!!`, `<T>x`, `"foo"!`
result.lazyImportsAtTopLevel; // top-level `await import(...)` / `.then(...)` that should be static
result.commonjsInEsm; // `require()`, `module.exports`, `exports.x` inside ESM modules
result.typeScriptEscapeHatches; // `// @ts-ignore`, `// @ts-nocheck`, undocumented `@ts-expect-error`

// semantic findings (type-aware, opt-in via `semantic.enabled: true`)
result.unusedTypes; // type aliases / interfaces never referenced
result.unusedEnumMembers; // enum members no reference site uses
result.unusedClassMembers; // class members no caller invokes (skips React/Angular lifecycle methods)
result.misclassifiedDependencies; // `dependencies` entries used only as types

// diagnostics
result.analysisErrors; // structured errors from any pipeline stage
result.totalFiles;
result.totalExports;
result.analysisTimeMs;
```

## Programmatic Options

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


### Code clones (token-based copy-paste detection)

Off by default. Enable to detect maximal duplicated token sequences across files (suffix-array + LCP, ported from [fallow](https://github.com/fallow-rs/fallow)):

```ts
const config = defineConfig({
  rootDir: "./my-project",
  codeClones: {
    enabled: true,
    mode: "semantic", // "strict" preserves identifiers/literals; "semantic" blinds them
    minTokens: 50,
    minLines: 5,
    minOccurrences: 2,
    skipLocal: false, // true => only report cross-directory duplicates
  },
});
```

### Feature flags (LaunchDarkly / Statsig / Unleash / PostHog / Vercel Flags / process.env)

Off by default. When enabled, `result.featureFlags` carries every detected flag use with `kind: "env-var" | "sdk-call" | "config-object"`, optional `sdkProvider`, and a `guardsDeadCode` boolean correlated with `unusedExports`:

```ts
const config = defineConfig({
  rootDir: "./my-project",
  featureFlags: {
    enabled: true,
    extraEnvPrefixes: ["MYAPP_FF_"],
    extraSdkFunctionNames: ["myCustomFlag"],
    detectConfigObjects: false, // heuristic config.features.x — opt in if you use that pattern
  },
});
```

### Function complexity (cyclomatic + cognitive)

Off by default. When enabled, `result.complexFunctions` reports per-function McCabe cyclomatic and SonarSource cognitive complexity, function size, and parameter count for every function that breaches at least one threshold:

```ts
const config = defineConfig({
  rootDir: "./my-project",
  complexity: {
    enabled: true,
    cyclomaticThreshold: 10,
    cognitiveThreshold: 15,
    paramCountThreshold: 5,
    functionLineThreshold: 80,
  },
});
```


### TypeScript code smells

On by default. Four families of TypeScript-specific patterns surfaced at high or medium confidence — no extra config required.

```ts
result.unnecessaryAssertions; // type assertions that drop type-safety or do nothing
result.lazyImportsAtTopLevel; // dynamic imports at the module top level
result.commonjsInEsm; // CommonJS forms inside ESM modules
result.typeScriptEscapeHatches; // @ts-ignore / @ts-nocheck / undocumented @ts-expect-error
```

| Finding                              | Kinds                                                                                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `result.unnecessaryAssertions`       | `redundant-double-assertion` (`x as unknown as T`), `assertion-to-any`, `redundant-non-null-on-literal` (`"foo"!`), `double-non-null` (`x!!`), `angle-bracket-assertion` (`<T>x`) |
| `result.lazyImportsAtTopLevel`       | `top-level-await-import`, `top-level-then-import`                                                                                                                      |
| `result.commonjsInEsm`               | `require`, `module-exports`, `exports-assignment`                                                                                                                      |
| `result.typeScriptEscapeHatches`     | `ts-ignore`, `ts-nocheck`, `ts-expect-error-without-explanation`                                                                                                       |

ESM detection follows the runtime rules: `.mts`/`.mjs` extensions are always ESM, `.cts`/`.cjs` are always CommonJS, and other files inherit from the nearest `package.json`'s `"type"` field.

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
