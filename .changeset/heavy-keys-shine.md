---
"deslop-js": patch
---

Stop flagging dependencies referenced in prettier config files (`.prettierrc`, `.prettierrc.*`, `prettier.config.*`) as unused, e.g. scoped plugins like `@trivago/prettier-plugin-sort-imports`
