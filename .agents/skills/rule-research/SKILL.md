---
name: rule-research
description: Research and scope deslop-js detector ideas before implementation. Use when validating a proposed finding, grounding it in JavaScript/TypeScript/module-system behavior, fixture evidence, false-positive traps, detector precision, or v1 non-goals.
---

# Rule Research

Use this as stage 1 of the deslop-js detector pipeline.

Pipeline:

1. `rule-research` defines the finding contract.
2. `rule-writing` turns the contract into fixtures, tests, implementation, and public result types.
3. `rule-validate` verifies signal, noise, compatibility, docs, and release notes.

Do not start implementation until the finding contract is clear. If the user already asked for implementation, make the contract concise and continue.

## Interactive Coaching

Ask only for information that blocks a useful contract:

- What code, package, export, dependency, or graph pattern should be reported?
- What makes it actionable dead code, dependency waste, or DRY noise?
- What similar-looking code should stay quiet?
- Is the detector syntax-only, graph-aware, workspace-aware, package-json-aware, or TypeScript-semantic?
- Should v1 skip generated files, config files, dynamic imports, path aliases, type-driven cases, framework conventions, or interprocedural behavior?

When enough is known, present a short finding contract and either ask for confirmation or continue if the user already requested implementation.

## Research Workflow

1. Define the finding in one sentence:
   `This detector reports <code/project pattern> because <specific waste, risk, or maintenance problem>.`
2. Classify the detector surface:
   - Source collection and parsing: `packages/deslop-js/src/collect/parse.ts`.
   - Entry/workspace discovery: `packages/deslop-js/src/collect/entries.ts` and `packages/deslop-js/src/collect/workspaces.ts`.
   - Import resolution and graph building: `packages/deslop-js/src/resolver/` and `packages/deslop-js/src/linker/`.
   - Report-stage findings: `packages/deslop-js/src/report/`.
   - Optional type-aware findings: `packages/deslop-js/src/semantic/`.
   - Shared AST/project helpers: `packages/deslop-js/src/utils/`.
3. Inspect existing result shapes in `packages/deslop-js/src/types.ts` and exports in `packages/deslop-js/src/index.ts`.
4. Collect evidence:
   - JavaScript, TypeScript, Node, package manager, or framework behavior.
   - Existing fixtures under `packages/deslop-js/tests/fixtures/`.
   - Current tests in `packages/deslop-js/tests/analyze.test.ts`, `semantic.test.ts`, `type-analysis.test.ts`, `dependency-utils.test.ts`, and `errors.test.ts`.
5. Classify examples:
   - Strong positive: exact reportable case.
   - Pattern-adjacent: useful but belongs to a different detector.
   - False-positive trap: valid or intentional code that must stay quiet.
   - Out of scope: too dynamic, framework-specific, type-driven, or expensive for v1.
6. Decide detector precision:
   - Syntax-only: local AST/source facts are enough.
   - Graph-aware: reachability, imports/exports, re-exports, or cycles matter.
   - Workspace/package-aware: package.json scripts, workspaces, overrides, dependencies, or entrypoints matter.
   - Type-semantic: a TypeScript program/checker is required and the feature belongs behind `semantic.enabled`.
7. Decide confidence behavior:
   - Use `high` only when the detector has low ambiguity and a safe suggestion.
   - Use `medium` or `low` when intent, API boundaries, framework conventions, or semantic uncertainty remain.

## Finding Contract Output

Return this contract at the end of research:

```md
Finding definition:
This detector reports <pattern> because <specific reason>.

Runtime/project reason:
<1-3 sentences>

Detector precision:
Syntax-only | graph-aware | workspace/package-aware | type-semantic

Output shape:
<new or existing ScanResult field, confidence tier, reason/suggestion fields>

Evidence:

- <docs, fixture, issue, or similar-tool evidence>

Strong positives:

- <exact reportable examples>

False-positive traps:

- <valid examples that must stay quiet>

In scope for v1:

- <supported cases>

Out of scope for v1:

- <explicit non-goals>

Test seeds:

- <fixture and assertion ideas>

Open questions:

- <only questions that affect correctness or scope>
```

## Research Rules

- Treat false positives as correctness bugs, especially for `high` confidence findings.
- Do not broaden a finding beyond its `reason` text or result field contract.
- Prefer explicit non-goals over pretending dynamic project behavior is modeled.
- Keep source-compatible public APIs stable unless the user is intentionally changing them.
- Add a changeset for published package behavior changes when appropriate.
