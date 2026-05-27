---
"deslop-js": minor
"deslop-cli": minor
---

Improve Astro support: extract imports from `<script>` blocks (including `src` references) in addition to frontmatter, and continue analysis with the partial AST when oxc-parser reports recoverable errors in extracted pre-processed sources (`.astro`, `.vue`, `.svelte`, `.mdx`). Previously, an Astro page whose frontmatter used a top-level `return` (legal in Astro, which treats frontmatter as an implicit async function body) would bail out of analysis entirely, leaving every transitively-imported file flagged as `unused-file`.
