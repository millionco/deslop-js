---
name: rule-writing
description: Implement deslop-js detectors from a validated finding contract. Use when adding or changing dead-code, dependency, import/export graph, redundancy, DRY, or TypeScript semantic findings, fixtures, public types, or report wiring.
---

# Rule Writing

Use this as stage 2 of the deslop-js detector pipeline.

Pipeline:

1. `rule-research` defines the finding contract.
2. `rule-writing` turns the contract into fixtures, tests, implementation, and public result types.
3. `rule-validate` verifies signal, noise, compatibility, docs, and release notes.

If no finding contract exists, create a compact one first or use the research skill before editing.

## Interactive Coaching

Before substantial edits, show the implementation plan:

- Exact report condition and result field.
- Detector precision: syntax-only, graph-aware, workspace/package-aware, or type-semantic.
- Source facts, graph facts, package metadata, or TS checker data required.
- Unsupported v1 cases and confidence tier.
- Fixture and assertion matrix.

If the user asked for direct implementation, keep the plan short and proceed.

## Implementation Workflow

1. Read the finding contract, `README.md`, `AGENTS.md`, and nearby detector code.
2. Pick the narrowest implementation layer:
   - Parse-time source facts in `packages/deslop-js/src/collect/parse.ts` or a focused `utils/` collector.
   - Graph/report detectors in `packages/deslop-js/src/report/`.
   - Workspace, package, entrypoint, or resolver changes in `collect/`, `resolver/`, or `linker/`.
   - Type-aware detectors in `packages/deslop-js/src/semantic/`, behind `semantic.enabled`.
3. Update public interfaces in `packages/deslop-js/src/types.ts` and exports/default result initialization in `packages/deslop-js/src/index.ts` when adding a result field.
4. Wire report-stage detectors through `packages/deslop-js/src/report/generate.ts`, using `runSafeDetector` for isolated failure handling.
5. Add or update fixtures under `packages/deslop-js/tests/fixtures/`.
6. Add assertions in the tightest relevant test file:
   - `analyze.test.ts` for main scan behavior and fixtures.
   - `semantic.test.ts` or `type-analysis.test.ts` for TypeScript semantic behavior.
   - `dependency-utils.test.ts` for focused package/dependency helpers.
   - `errors.test.ts` for error contracts.
7. Update `README.md` if the user-facing result surface, option, CLI behavior, or documented finding list changes.
8. Add a changeset when published package behavior or API shape changes.
9. Build before testing after source edits.

Use `@antfu/ni` commands in this repo:

```sh
ni
nr build
nr test
nr typecheck
nr lint
nr format
```

For focused package iteration, run commands from `packages/deslop-js/` with `nr test` or `nr typecheck`, then finish with the root checks that match the risk.

## Detector Planning

Plan against real project behavior:

- Use parsed AST and structured module graph data, not source-text string matching, unless the file type requires limited extraction such as CSS, MDX, Astro, Vue, or Svelte.
- Respect reachability, entrypoints, config files, declaration files, test entries, workspaces, package boundaries, path aliases, and re-export chains.
- Treat dynamic imports, computed property names, glob imports, framework conventions, generated output, and unresolved modules as unknown unless the detector explicitly supports them.
- Keep type-aware analysis opt-in under `semantic.enabled`, and preserve graceful fallback through `analysisErrors`.
- Do not report public API exports from entry files unless `includeEntryExports` or the finding contract explicitly supports that.
- Match confidence tiers to ambiguity; high confidence should survive adversarial fixtures.

Pseudocode shape:

```ts
for each scan:
  collect source/package/workspace facts
  build or reuse graph/semantic context
  find candidate patterns
  skip unsupported, unreachable, generated, ambiguous, or public API cases
  compute confidence, reason, and location
  report only when the exact finding condition is proven
```

## Fixture Matrix

Design varied invalid and valid cases:

- Direct positive cases.
- Alias, re-export, namespace, default export, side-effect import, and type-only cases.
- Workspace and package.json script/dependency cases.
- Entry files, config files, declaration files, tests, generated output, and ignored files.
- Path aliases, extension resolution, output-directory resolution, and monorepo packages.
- Dynamic imports, glob imports, computed properties, or unresolved references that should stay quiet.
- Framework or package manager escape hatches already modeled by this repo.
- Regression cases from review or issue reports.

Keep fixtures small and purpose-built. Prefer adding a new fixture only when existing fixtures would become confusing or too broad.

## Code Quality Rules

- Match the detector to the one-sentence finding definition.
- Match `reason`, `suggestion`, and `confidence` to the exact reported condition.
- Use TypeScript interfaces over new type aliases unless the repo already requires a union/literal type.
- Keep interfaces in global scope where this repo expects them.
- Use arrow functions, kebab-case filenames, descriptive variable names, and `Boolean(...)` over `!!`.
- Put magic numbers in `constants.ts` with unit suffixes.
- Put one small focused utility per file in `utils/` when reuse or clarity justifies it.
- Default to no comments; add comments only for non-obvious why, brittle platform behavior, or intentional modeling limits.

## Writing Output

When the writing stage is done, report:

```md
Implemented:

- <detector, fixtures, tests, public types, docs, changeset>

Detector behavior:

- <what reports>
- <what intentionally stays quiet>
- <confidence behavior>

Validation run:

- <focused build/test/typecheck/lint commands>

Known v1 non-goals:

- <unsupported cases preserved from the finding contract>

Next stage:

- Run `rule-validate`.
```
