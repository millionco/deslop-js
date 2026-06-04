---
"deslop-js": patch
---

Parallelize file parsing with worker threads for projects with 50+ files, using greedy load-balanced concurrency (auto-detected CPU cores, clamped to [1, 16]). Falls back to sequential parsing on small projects or worker failure.
