---
"deslop-js": patch
---

Fix false-positive `unused-file` reports for Expo Router projects that use the `src/app/` routes directory. Expo Router discovers routes from the filesystem and officially supports both `app/` and `src/app/` as the routes root, so `EXPO_ROUTER_ENTRY_PATTERNS` now seeds `src/app/**` route files (root `_layout`, route groups, screens, etc.) as entry points alongside `app/**`.
