import { resolve, relative, join } from "node:path";
import { existsSync } from "node:fs";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"];

export const resolveSourcePath = (distPath: string, directory: string): string | undefined => {
  if (existsSync(distPath)) return distPath;

  const relativeToDist = relative(directory, distPath);
  const sourceVariants = [
    relativeToDist.replace(/^dist\//, "src/"),
    relativeToDist.replace(/^build\//, "src/"),
    relativeToDist.replace(/^lib\//, "src/"),
    relativeToDist.replace(/^lib-dist\//, "src/"),
    relativeToDist.replace(/^out\//, "src/"),
  ];

  for (const variant of sourceVariants) {
    if (variant === relativeToDist) continue;

    const withoutExtension = variant.replace(/\.[^.]+$/, "");
    for (const sourceExtension of SOURCE_EXTENSIONS) {
      const sourceCandidate = resolve(directory, withoutExtension + sourceExtension);
      if (existsSync(sourceCandidate)) {
        return sourceCandidate;
      }
    }

    const asDirectory = resolve(directory, withoutExtension);
    for (const indexExtension of SOURCE_EXTENSIONS) {
      const indexCandidate = join(asDirectory, `index${indexExtension}`);
      if (existsSync(indexCandidate)) {
        return indexCandidate;
      }
    }
  }

  return undefined;
};
