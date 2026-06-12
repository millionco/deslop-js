---
"deslop-js": patch
---

Stop flagging workspace package files imported by sibling workspaces via package subpaths (e.g. `@project/ui/button`) as unused when analyzing a single workspace package — including subpaths resolved through wildcard `exports` patterns (`"./*": "./src/*.tsx"`) and nested export conditions — and treat `vercel.ts`-style deploy-time config files as config files
