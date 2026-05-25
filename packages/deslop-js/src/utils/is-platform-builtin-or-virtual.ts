import { BUILTIN_MODULES } from "../constants.js";

const BUILTIN_SUBPATH_NODE_MODULES = new Set<string>([
  "fs",
  "dns",
  "stream",
  "readline",
  "timers",
  "util",
  "test",
  "assert",
  "inspector",
  "path",
]);

/**
 * Module specifiers that don't correspond to a real package on disk and must
 * therefore not be flagged as `unused-dependency` or `unresolved-import`.
 *
 * Recognizes the following module specifier families:
 *
 * - Node.js builtins (`fs`, `node:fs`, `fs/promises`, `path/posix`, …)
 * - Bun built-ins (`bun`, `bun:sqlite`, `bun:test`, `bun:ffi`)
 * - Cloudflare Workers (`cloudflare:workers`, `cloudflare:sockets`)
 * - Sass built-ins (`sass:math`, `sass:string`, …) provided by the Sass compiler
 * - Deno standard library imported as `std` or `std/<path>`
 * - Vite-style virtual modules with the `virtual:` prefix
 *   (`virtual:pwa-register`, `virtual:uno.css`, …)
 */
export const isPlatformBuiltinOrVirtualSpecifier = (specifier: string): boolean => {
  if (specifier.startsWith("virtual:")) return true;
  if (specifier === "bun" || specifier.startsWith("bun:")) return true;
  if (specifier.startsWith("cloudflare:")) return true;
  if (specifier.startsWith("sass:")) return true;
  if (specifier === "std" || specifier.startsWith("std/")) return true;

  const stripped = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  const slashIndex = stripped.indexOf("/");
  if (slashIndex === -1) return BUILTIN_MODULES.has(stripped);
  const baseName = stripped.slice(0, slashIndex);
  if (!BUILTIN_MODULES.has(baseName)) return false;
  return BUILTIN_SUBPATH_NODE_MODULES.has(baseName);
};
