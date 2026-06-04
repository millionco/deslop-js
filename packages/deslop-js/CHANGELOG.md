# deslop-js

## 0.0.18

### Patch Changes

- [#26](https://github.com/millionco/deslop-js/pull/26) [`18dbfa8`](https://github.com/millionco/deslop-js/commit/18dbfa8ff174858a4f85c82397126ec24b05cf0f) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Parallelize file parsing with worker threads for projects with 50+ files, using greedy load-balanced concurrency (auto-detected CPU cores, clamped to [1, 16]). Falls back to sequential parsing on small projects or worker failure.

## 0.0.17

### Patch Changes

- [#23](https://github.com/millionco/deslop-js/pull/23) [`d83dc37`](https://github.com/millionco/deslop-js/commit/d83dc373a8ef2f8d22ffbb430ff9234cfef23e2a) Thanks [@aidenybai](https://github.com/aidenybai)! - `detectStalePackages` no longer reports a devDependency as unused when it's referenced in a `package.json` script as a flag argument rather than the leading command — e.g. `jest --testResultsProcessor jest-sonar-reporter` or `--reporters=jest-junit`. The script scan previously matched a package only as the command/binary token; it now also treats any declared package named as a standalone token anywhere in the command (including `@scope/pkg` and `pkg/subpath`) as referenced, while still ignoring tokens that merely contain the name as a substring.

## 0.0.16

### Patch Changes

- [#21](https://github.com/millionco/deslop-js/pull/21) [`696b690`](https://github.com/millionco/deslop-js/commit/696b690408a392cdbf3f76daf50949710e4c2ed6) Thanks [@aidenybai](https://github.com/aidenybai)! - Normalize collected source paths, analyzer path sets, and graph module paths to POSIX separators so Windows resolver and glob paths remain in the same import graph key space. This prevents reachable files and re-exported symbols from being dropped during dead-code analysis on Windows.

## 0.0.15

### Patch Changes

- [#18](https://github.com/millionco/deslop-js/pull/18) [`ae0f67a`](https://github.com/millionco/deslop-js/commit/ae0f67ac43907ca9538db9580f25bb418c8ee684) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Add duplicate-block, cyclomatic complexity, feature-flag, TypeScript code-smell, and private-type-leak detectors, collect imports from Astro `<script>` blocks with recovery from partial parses, treat Expo Router `src/app` routes as entry points, normalize path separators on Windows, and reduce false positives across detectors.

- [#20](https://github.com/millionco/deslop-js/pull/20) [`24a9c69`](https://github.com/millionco/deslop-js/commit/24a9c6915d0e295c65c1bf437b9ac5aef5d72dfe) Thanks [@aidenybai](https://github.com/aidenybai)! - Treat Inertia, Redwood, Waku, Vike, Rakkas, and module federation page/config conventions as dependency-gated entry points to reduce orphan-file false positives.

## 0.0.14

### Patch Changes

- fix

## 0.0.13

### Patch Changes

- fix

## 0.0.12

### Patch Changes

- fix

## 0.0.11

### Patch Changes

- fix

## 0.0.10

### Patch Changes

- Add deslop-cli Commander package and improve dependency detection for pnpm/npm overrides and CLI binaries in package scripts.

## 0.0.9

### Patch Changes

- fix

## 0.0.8

### Patch Changes

- fix

## 0.0.7

### Patch Changes

- fix

## 0.0.6

### Patch Changes

- fix

## 0.0.5

### Patch Changes

- fix

## 0.0.3

### Patch Changes

- fix

## 0.0.2

### Patch Changes

- fix
