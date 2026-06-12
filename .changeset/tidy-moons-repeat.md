---
"deslop-js": patch
---

Stop flagging workspace package files imported by sibling workspaces via package subpaths (e.g. `@project/ui/button`) as unused when analyzing a single workspace package — including subpaths resolved through wildcard `exports` patterns (`"./*": "./src/*.tsx"`), nested export conditions, and exports targeting built `dist/` artifacts that exist on disk (entries map back to their `src/` sources) — and treat `vercel.ts`-style deploy-time config files as config files
