---
"deslop-js": patch
"deslop-cli": patch
---

Normalize collected source paths, analyzer path sets, and graph module paths to POSIX separators so Windows resolver and glob paths remain in the same import graph key space. This prevents reachable files and re-exported symbols from being dropped during dead-code analysis on Windows.
