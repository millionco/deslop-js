---
"deslop-js": patch
"deslop-cli": patch
---

Improve path-alias resolution accuracy. When multiple `paths` patterns match an import, the most specific one now wins (e.g. `@/components/*` is preferred over `@/*`), matching TypeScript's own resolution. Import specifiers are also sanitized before resolution — webpack inline-loader prefixes (`raw-loader!./x`), `?query` strings, and `#fragment` hashes are stripped (while Node.js `#subpath` imports are preserved) so their targets are no longer mis-reported as unused.
