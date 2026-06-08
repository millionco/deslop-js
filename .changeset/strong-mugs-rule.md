---
"deslop-js": patch
---

Add a `reason` field to each `unusedDependencies` finding that names the package and its declaring section (`dependencies` / `devDependencies`), so consumers can surface the specific unused dependency name instead of a generic grouped warning.
