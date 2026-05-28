---
name: rule-validate
description: Validate implemented deslop-js detectors before PR or merge. Use after focused tests pass to review correctness, inspect false positives, update docs/changesets, write PR descriptions, and triage review comments.
---

# Rule Validate

Use this as stage 3 of the deslop-js detector pipeline.

Pipeline:

1. `rule-research` defines the finding contract.
2. `rule-writing` turns the contract into fixtures, tests, implementation, and public result types.
3. `rule-validate` verifies signal, noise, compatibility, docs, and release notes.

Validation is not just running tests. It checks whether the detector still matches the finding contract on fixture and project-shaped code.

## Interactive Coaching

Before broad or expensive validation, tell the user what will run and what evidence it will produce.

Pause for the user only when:

- A review comment is ambiguous and could broaden v1 scope.
- A false-positive fix would change the finding contract.
- A check fails for unrelated repo state and the next step is not obvious.

Otherwise, fix real findings and add regression fixtures or assertions.

## Local Validation

Build before tests after source edits.

Run the tightest useful checks first:

- `nr build` from the repo root after source changes.
- Focused `nr test` or `nr typecheck` from `packages/deslop-js/` while iterating.
- Root `nr test`, `nr typecheck`, `nr lint`, and `nr format` when risk or user request justifies them.

Record every command as passed, failed, or not run. If a broad command fails because of unrelated repo state, record the failure location and the focused command that passed.

## Implementation Review

Review the diff like a detector reviewer. Lead with bugs:

- False positives for valid or intentional code.
- False negatives for claimed behavior.
- Incorrect reachability, entrypoint, or public API handling.
- Import/export, re-export, namespace, default, side-effect, or type-only mistakes.
- Workspace, package.json script, dependency, peer dependency, override, or bin resolution mistakes.
- Path alias, extension, generated output, config file, declaration file, or test fixture mistakes.
- Semantic analysis that runs without `semantic.enabled` or fails to degrade through `analysisErrors`.
- Confidence tiers or diagnostic reasons that overclaim.
- Missing fixture coverage for valid and invalid edge cases.
- Public result types, README docs, or changesets missing for user-facing behavior.

Fix every real implementation bug with a targeted regression fixture or assertion.

## PR Description

Write PR copy after validation, not before. Use this structure:

````md
## Why

Catches <specific dead-code/dependency/DRY issue>.

<Project behavior reason in 1-3 sentences.>

Before:

```ts
<bad or noisy example>
```

After:

```ts
<clean or intentionally quiet example>
```

## What changed

- Added or updated `<detector/result field>`.
- Detects <main detection surface>.
- Reports <exact condition and confidence>.
- Allows <important valid patterns>.
- Adds fixtures/tests for <edge cases>.

## Validation

| Check                 | Result                         |
| --------------------- | ------------------------------ |
| Focused tests         | `<command/result>`             |
| Typecheck             | `<command/result>`             |
| Lint/format           | `<command/result or Not run>`  |
| Fixture review        | `<summary>`                    |
| False positives found | `<count after review>`         |

## Test plan

- `<focused test command>`
- `<typecheck command>`
- `<lint/format command or Not run>`
````

## Review Comment Triage

Classify each bot or human review comment:

- Fix now: real false positive, false negative for claimed behavior, graph/AST mistake, package resolution bug, semantic fallback bug, or public API mismatch.
- Usually fix: duplicated helper, misleading name, unnecessary abstraction, unclear confidence, or confusing reason text.
- Document or defer: false-negative coverage outside v1, expensive dynamic behavior, framework-specific conventions, or cross-package semantic modeling.
- Reject: broadens the detector beyond its result contract, increases false positives, or conflicts with repo conventions.

Resolve review threads only after the fix or explanation has landed.

## Validation Output

Return:

```md
Validation summary:

- <commands and results>
- <implementation review findings>
- <false positives found and fixed>
- <regression fixtures/tests added>

PR-ready notes:

- <Why/What/Test plan highlights>

Residual risk:

- <known v1 non-goals or unchecked areas>
```
