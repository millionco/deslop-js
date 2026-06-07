---
"deslop-js": patch
"deslop-cli": patch
---

Auto-resolve path aliases by default and add a `paths` config option.

`deslop` now infers cross-workspace `@scope/<dir>` imports from the monorepo layout (so files imported via an alias whose package name or tsconfig didn't cover it are no longer reported as unused), and reads alias mappings from Vite (`resolve.alias`), Jest (`moduleNameMapper`), and Babel (`module-resolver`) configs in addition to the existing tsconfig `paths` and webpack aliases. For anything not auto-detected, the new `paths` option (`--paths "@app/*=src/*"` on the CLI) declares explicit mappings.
