---
"deslop-js": patch
---

Fix Windows false-positive `unused-file` reports caused by a path separator mismatch. `fast-glob` yields forward slashes while `oxc-resolver` and `node:path` yield backslashes on Windows, so import edges silently failed to resolve and every file looked unreachable. Resolved import paths, discovered entry points, and dependency-graph keys are now normalized to a single POSIX form.
