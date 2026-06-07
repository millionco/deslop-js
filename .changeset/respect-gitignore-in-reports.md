---
"deslop-js": patch
---

Respect `.gitignore` when reporting unused code. Files matching a gitignore rule (e.g. generated/build output) are excluded from `unused-file` and `unused-export` results, but stay in the dependency graph so the real source they import is still counted as used — files imported only by a gitignored module are no longer falsely reported as unused. Personal/global gitignore rules are ignored so results are deterministic across machines, and analysis degrades gracefully (with an info-level note) when `git` is unavailable.
