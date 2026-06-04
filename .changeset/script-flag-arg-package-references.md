---
"deslop-js": patch
---

`detectStalePackages` no longer reports a devDependency as unused when it's referenced in a `package.json` script as a flag argument rather than the leading command — e.g. `jest --testResultsProcessor jest-sonar-reporter` or `--reporters=jest-junit`. The script scan previously matched a package only as the command/binary token; it now also treats any declared package named as a standalone token anywhere in the command (including `@scope/pkg` and `pkg/subpath`) as referenced, while still ignoring tokens that merely contain the name as a substring.
