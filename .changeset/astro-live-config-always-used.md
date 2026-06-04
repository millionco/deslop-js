---
"deslop-js": patch
---

Astro's live content collections config (`src/live.config.ts`) is now recognized as an always-used entry point, matching the existing `src/content.config.ts` handling. Previously the file — and every module reachable only through it (live collection loaders, schemas, CMS clients) — was reported as `unused-file`, since Astro loads it by filename convention with no import statement anywhere in the project.
