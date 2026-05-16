import { resolve, relative } from "node:path";
import { existsSync } from "node:fs";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"];

const OUTPUT_DIR_PREFIXES = [
  "dist/esm/", "dist/cjs/", "dist/es/", "dist/lib/",
  "dist/", "build/", "lib/", "lib-dist/", "esm/", "cjs/", "out/",
];
const SOURCE_INDEX_FALLBACK_STEMS = ["src/index", "src/main", "index", "main"];

export const resolveSourcePath = (distPath: string, directory: string): string | undefined => {
  if (existsSync(distPath)) return distPath;

  const relativeToDist = relative(directory, distPath);
  const sourceReplacements = ["src/", ""];
  const sourceVariants = OUTPUT_DIR_PREFIXES
    .flatMap((prefix) =>
      sourceReplacements.map((replacement) =>
        relativeToDist.replace(new RegExp(`^${prefix}`), replacement),
      ),
    )
    .filter((variant) => variant !== relativeToDist);

  for (const variant of sourceVariants) {
    const withoutExtension = variant.replace(/\.[^.]+$/, "");
    for (const sourceExtension of SOURCE_EXTENSIONS) {
      const sourceCandidate = resolve(directory, withoutExtension + sourceExtension);
      if (existsSync(sourceCandidate)) {
        return sourceCandidate;
      }
    }
  }

  const isOutputDirEntry = OUTPUT_DIR_PREFIXES.some((prefix) => relativeToDist.startsWith(prefix));
  if (isOutputDirEntry) {
    for (const stem of SOURCE_INDEX_FALLBACK_STEMS) {
      for (const sourceExtension of SOURCE_EXTENSIONS) {
        const fallbackCandidate = resolve(directory, stem + sourceExtension);
        if (existsSync(fallbackCandidate)) {
          return fallbackCandidate;
        }
      }
    }
  }

  const withoutExtension = relativeToDist.replace(/\.[cm]?js$/, "");
  if (withoutExtension !== relativeToDist) {
    for (const sourceExtension of SOURCE_EXTENSIONS) {
      const directSourceCandidate = resolve(directory, withoutExtension + sourceExtension);
      if (existsSync(directSourceCandidate)) {
        return directSourceCandidate;
      }
    }
    const indexCandidate = resolve(directory, withoutExtension, "index.ts");
    if (existsSync(indexCandidate)) return indexCandidate;
  }

  return undefined;
};
