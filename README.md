# deslop-js

[![version](https://img.shields.io/npm/v/deslop-js?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/deslop-js)
[![downloads](https://img.shields.io/npm/dt/deslop-js.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/deslop-js)

Deslop JavaScript code.

## Install

```bash
npm install deslop-js
```

## Usage

```ts
import { analyze, defineConfig } from "deslop-js";

const config = defineConfig({ rootDir: "./my-project" });
const result = await analyze(config);

result.unusedFiles; // files not reachable from any entry point
result.unusedExports; // exported symbols never imported
result.unusedDependencies; // package.json deps not imported anywhere
result.circularDependencies; // import cycles
```

### Options

`defineConfig` accepts a required `rootDir` and optional overrides:

```ts
const config = defineConfig({
  rootDir: "./my-project",
  entryPatterns: ["src/main.ts"],
  ignorePatterns: ["**/*.test.ts"],
  tsConfigPath: "./tsconfig.json",
  reportTypes: true,
  includeEntryExports: true,
});
```

| Option                | Type                  | Default                                                          | Description                                     |
| --------------------- | --------------------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| `rootDir`             | `string`              | required                                                         | Project root directory                          |
| `entryPatterns`       | `string[]`            | auto-detected                                                    | Entry point glob patterns                       |
| `ignorePatterns`      | `string[]`            | `[]`                                                             | Glob patterns to exclude from analysis          |
| `includeExtensions`   | `string[]`            | `[".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cjs", ".cts"]` | File extensions to scan                         |
| `tsConfigPath`        | `string \| undefined` | `undefined`                                                      | Path to tsconfig.json for path alias resolution |
| `reportTypes`         | `boolean`             | `false`                                                          | Include type-only exports in results            |
| `includeEntryExports` | `boolean`             | `false`                                                          | Report unused exports from entry files          |

### Result

```ts
interface ScanResult {
  unusedFiles: { path: string }[];
  unusedExports: {
    path: string;
    name: string;
    line: number;
    column: number;
    isTypeOnly: boolean;
  }[];
  unusedDependencies: {
    name: string;
    isDevDependency: boolean;
  }[];
  circularDependencies: {
    files: string[];
  }[];
  totalFiles: number;
  totalExports: number;
  analysisTimeMs: number;
}
```

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
