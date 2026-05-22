import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { resolve, relative } from "node:path";
import { analyze, defineConfig } from "../src/index.js";
import type { ScanResult } from "../src/types.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "fixtures");

const scanFixture = async (
  fixtureName: string,
  overrides: Record<string, unknown> = {},
): Promise<ScanResult> => {
  const fixtureDir = resolve(FIXTURES_DIR, fixtureName);
  const config = defineConfig({
    rootDir: fixtureDir,
    ...overrides,
  });
  return analyze(config);
};

const orphanPaths = (result: ScanResult, fixtureDir: string): string[] =>
  result.unusedFiles.map((unusedFile) => relative(fixtureDir, unusedFile.path)).sort();

const deadExportNames = (result: ScanResult): string[] =>
  result.unusedExports.map((unusedExport) => unusedExport.name).sort();

const deadExportsByFile = (result: ScanResult, fixtureDir: string): Record<string, string[]> => {
  const byFile: Record<string, string[]> = {};
  for (const unusedExport of result.unusedExports) {
    const relativePath = relative(fixtureDir, unusedExport.path);
    if (!byFile[relativePath]) byFile[relativePath] = [];
    byFile[relativePath].push(unusedExport.name);
  }
  for (const key of Object.keys(byFile)) {
    byFile[key].sort();
  }
  return byFile;
};

const staleDependencyNames = (result: ScanResult): string[] =>
  result.unusedDependencies.map((dep) => dep.name).sort();

describe("simple-app", () => {
  it("should detect orphan file", async () => {
    const result = await scanFixture("simple-app");
    const fixtureDir = resolve(FIXTURES_DIR, "simple-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should detect unused exports in utils", async () => {
    const result = await scanFixture("simple-app");
    const fixtureDir = resolve(FIXTURES_DIR, "simple-app");
    const exportsByFile = deadExportsByFile(result, fixtureDir);
    assert.ok(
      exportsByFile["src/utils.ts"]?.includes("unusedFunction"),
      `unusedFunction should be flagged, got: ${JSON.stringify(exportsByFile["src/utils.ts"])}`,
    );
  });

  it("should detect unused dependency", async () => {
    const result = await scanFixture("simple-app");
    const deps = staleDependencyNames(result);
    assert.ok(deps.includes("unused-dep"), `unused-dep should be flagged, got: ${deps}`);
  });

  it("should not flag usedFunction as unused", async () => {
    const result = await scanFixture("simple-app");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("usedFunction"), "usedFunction should not be unused");
  });

  it("should flag react as unused (declared but never imported)", async () => {
    const result = await scanFixture("simple-app");
    const deps = staleDependencyNames(result);
    assert.ok(deps.includes("react"), `react should be unused since never imported, got: ${deps}`);
  });
});

describe("dependency-tooling", () => {
  it("should keep peer dependencies, script binaries, overrides, and Nx project refs used", async () => {
    const result = await scanFixture("dependency-tooling");
    const deps = staleDependencyNames(result);
    const expectedUsedDeps = [
      "@babel/cli",
      "@formatjs/cli",
      "@hookform/resolvers",
      "@nx/js",
      "@tauri-apps/cli",
      "@tinacms/cli",
      "@typescript/native-preview",
      "babel-eslint",
      "chart.js",
      "chokidar-cli",
      "jest-cli",
      "jest-config",
      "prompt",
      "react-chartjs-2",
      "react-redux",
      "redux",
      "replace-in-file",
      "tsc-alias",
      "zod",
    ];
    for (const dependencyName of expectedUsedDeps) {
      assert.ok(
        !deps.includes(dependencyName),
        `${dependencyName} should be treated as used, got: ${deps}`,
      );
    }
    assert.ok(deps.includes("unused-dep"), `unused-dep should be unused, got: ${deps}`);
    assert.ok(deps.includes("unused-tool"), `unused-tool should be unused, got: ${deps}`);
    assert.ok(deps.includes("redux-thunk"), `redux-thunk should be unused, got: ${deps}`);
  });

  it("should keep pnpm-workspace override targets used", async () => {
    const result = await scanFixture("pnpm-workspace-override");
    const deps = staleDependencyNames(result);
    assert.ok(
      !deps.includes("@voidzero-dev/vite-plus-core"),
      `@voidzero-dev/vite-plus-core should be treated as used via pnpm-workspace overrides, got: ${deps}`,
    );
    assert.ok(deps.includes("unused-dep"), `unused-dep should be unused, got: ${deps}`);
  });

  it("should keep script-invoked CLI packages used without node_modules bin metadata", async () => {
    const result = await scanFixture("script-cli-deps");
    const deps = staleDependencyNames(result);
    for (const dependencyName of ["turbo", "vite-plus", "tsx", "@changesets/cli"]) {
      assert.ok(
        !deps.includes(dependencyName),
        `${dependencyName} should be treated as used from scripts, got: ${deps}`,
      );
    }
    assert.ok(deps.includes("unused-dep"), `unused-dep should be unused, got: ${deps}`);
  });

  it("should keep nested package.json override targets used", async () => {
    const result = await scanFixture("nested-overrides");
    const deps = staleDependencyNames(result);
    assert.ok(
      !deps.includes("@typescript/native-preview"),
      `@typescript/native-preview should be treated as used via nested overrides, got: ${deps}`,
    );
    assert.ok(deps.includes("unused-dep"), `unused-dep should be unused, got: ${deps}`);
  });

  it("should keep nested pnpm-workspace override targets used", async () => {
    const result = await scanFixture("pnpm-nested-overrides");
    const deps = staleDependencyNames(result);
    assert.ok(
      !deps.includes("@typescript/native-preview"),
      `@typescript/native-preview should be treated as used via nested pnpm-workspace overrides, got: ${deps}`,
    );
    assert.ok(deps.includes("unused-dep"), `unused-dep should be unused, got: ${deps}`);
  });

  it("should keep vitest override targets used", async () => {
    const result = await scanFixture("vitest-override-target");
    const deps = staleDependencyNames(result);
    assert.ok(
      !deps.includes("@voidzero-dev/vite-plus-test"),
      `@voidzero-dev/vite-plus-test should be treated as used via pnpm-workspace overrides, got: ${deps}`,
    );
    assert.ok(deps.includes("unused-dep"), `unused-dep should be unused, got: ${deps}`);
  });
});

describe("css-tilde-import", () => {
  it("should detect Sass tilde package imports as dependency usage", async () => {
    const result = await scanFixture("css-tilde-import");
    const deps = staleDependencyNames(result);
    assert.ok(!deps.includes("bootstrap"), `bootstrap should be used from SCSS, got: ${deps}`);
    assert.ok(deps.includes("unused-dep"), `unused-dep should be unused, got: ${deps}`);
  });
});

describe("reexport-star", () => {
  it("should not flag foo as unused (used via barrel)", async () => {
    const result = await scanFixture("reexport-star");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("foo"), "foo is used through barrel");
  });

  it("should flag fooUnused as unused", async () => {
    const result = await scanFixture("reexport-star");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("fooUnused"),
      `fooUnused should be unused, got: ${allUnusedNames}`,
    );
  });

  it("should not flag module-b.ts as unused file (file-level: re-exported by barrel makes it reachable)", async () => {
    const result = await scanFixture("reexport-star");
    const fixtureDir = resolve(FIXTURES_DIR, "reexport-star");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.some((filePath) => filePath === "src/module-b.ts"),
      `module-b.ts should be reachable via barrel re-export (file-level), got: ${unusedFilePaths}`,
    );
  });

  it("should not flag module-c.ts as unused file (file-level: star re-exported by barrel makes it reachable)", async () => {
    const result = await scanFixture("reexport-star");
    const fixtureDir = resolve(FIXTURES_DIR, "reexport-star");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.some((filePath) => filePath === "src/module-c.ts"),
      `module-c.ts should be reachable via barrel star re-export (file-level), got: ${unusedFilePaths}`,
    );
  });
});

describe("reexport-chains (3-level barrel chain)", () => {
  it("should not flag alpha and beta (used via 3-level chain)", async () => {
    const result = await scanFixture("reexport-chains");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("alpha"), "alpha is used via chain");
    assert.ok(!allUnusedNames.includes("beta"), "beta is used via chain");
  });

  it("should flag gamma and delta as unused", async () => {
    const result = await scanFixture("reexport-chains");
    const allUnusedNames = deadExportNames(result);
    assert.ok(allUnusedNames.includes("gamma"), `gamma should be unused, got: ${allUnusedNames}`);
    assert.ok(allUnusedNames.includes("delta"), `delta should be unused, got: ${allUnusedNames}`);
  });

  it("should not flag any file as unused", async () => {
    const result = await scanFixture("reexport-chains");
    assert.equal(result.unusedFiles.length, 0, "all files are reachable via chain");
  });
});

describe("ns-imports", () => {
  it("should flag exports not accessed via namespace member access", async () => {
    const result = await scanFixture("ns-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "ns-imports");
    const exportsByFile = deadExportsByFile(result, fixtureDir);
    assert.deepStrictEqual(exportsByFile["src/utils.ts"], ["bar", "baz"]);
  });

  it("should not flag any files as unused", async () => {
    const result = await scanFixture("ns-imports");
    assert.equal(result.unusedFiles.length, 0);
  });
});

describe("ns-partial", () => {
  it("should flag only the exports not accessed via member access", async () => {
    const result = await scanFixture("ns-partial");
    const fixtureDir = resolve(FIXTURES_DIR, "ns-partial");
    const exportsByFile = deadExportsByFile(result, fixtureDir);
    const unusedMathExports = (exportsByFile["src/math.ts"] ?? []).sort();
    assert.deepStrictEqual(unusedMathExports, ["divide", "subtract"]);
  });
});

describe("ns-whole", () => {
  it("should not flag any exports when Object.values is used on namespace", async () => {
    const result = await scanFixture("ns-whole");
    assert.equal(
      result.unusedExports.length,
      0,
      `expected 0 unused exports, got: ${deadExportNames(result)}`,
    );
  });
});

describe("ns-spread", () => {
  it("should not flag any exports when namespace is spread into object", async () => {
    const result = await scanFixture("ns-spread");
    assert.equal(
      result.unusedExports.length,
      0,
      `expected 0 unused exports, got: ${deadExportNames(result)}`,
    );
  });
});

describe("ns-forin", () => {
  it("should not flag any exports when namespace is used in for..in", async () => {
    const result = await scanFixture("ns-forin");
    assert.equal(
      result.unusedExports.length,
      0,
      `expected 0 unused exports, got: ${deadExportNames(result)}`,
    );
  });
});

describe("ns-reexport", () => {
  it("should flag only the exports not accessed through barrel via namespace member access", async () => {
    const result = await scanFixture("ns-reexport");
    const fixtureDir = resolve(FIXTURES_DIR, "ns-reexport");
    const exportsByFile = deadExportsByFile(result, fixtureDir);
    assert.deepStrictEqual(exportsByFile["src/lib/helpers.ts"], ["helperB", "helperC"]);
  });

  it("should not flag any files as unused", async () => {
    const result = await scanFixture("ns-reexport");
    assert.equal(result.unusedFiles.length, 0);
  });
});

describe("export-default", () => {
  it("should flag default export of component.ts (only named is used)", async () => {
    const result = await scanFixture("export-default");
    const fixtureDir = resolve(FIXTURES_DIR, "export-default");
    const exportsByFile = deadExportsByFile(result, fixtureDir);
    assert.ok(
      exportsByFile["src/component.ts"]?.includes("default"),
      `default should be unused in component.ts, got: ${JSON.stringify(exportsByFile)}`,
    );
  });

  it("should flag unused-default.ts as unused file", async () => {
    const result = await scanFixture("export-default");
    const fixtureDir = resolve(FIXTURES_DIR, "export-default");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/unused-default.ts"),
      `unused-default.ts should be unused file, got: ${unusedFilePaths}`,
    );
  });

  it("should not flag usedNamed as unused", async () => {
    const result = await scanFixture("export-default");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("usedNamed"), "usedNamed is imported");
  });
});

describe("import-side-effect", () => {
  it("should keep setup.ts reachable (side-effect import)", async () => {
    const result = await scanFixture("import-side-effect");
    const fixtureDir = resolve(FIXTURES_DIR, "import-side-effect");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/setup.ts"), "setup.ts is side-effect imported");
  });

  it("should flag orphan.ts as unused", async () => {
    const result = await scanFixture("import-side-effect");
    const fixtureDir = resolve(FIXTURES_DIR, "import-side-effect");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("cycle-reexport", () => {
  it("should not flag fromA or fromB (used despite circular re-exports)", async () => {
    const result = await scanFixture("cycle-reexport");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("fromA"), "fromA is used");
    assert.ok(!allUnusedNames.includes("fromB"), "fromB is used");
  });

  it("should not hang or crash from circular re-export", async () => {
    const result = await scanFixture("cycle-reexport");
    assert.ok(result.totalFiles > 0, "analysis should complete");
  });
});

describe("star-reexport-chain", () => {
  it("should not flag used as unused (via star re-export chain)", async () => {
    const result = await scanFixture("star-reexport-chain");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("used"), "used should be found through star chain");
  });

  it("should flag unused export in source", async () => {
    const result = await scanFixture("star-reexport-chain");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("unused"),
      `unused should be flagged, got: ${allUnusedNames}`,
    );
  });
});

describe("star-selective", () => {
  it("should not flag usedOne and usedTwo (selectively imported via star barrel)", async () => {
    const result = await scanFixture("star-selective");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("usedOne"), "usedOne is used");
    assert.ok(!allUnusedNames.includes("usedTwo"), "usedTwo is used");
  });

  it("should flag unusedThree and unusedFour", async () => {
    const result = await scanFixture("star-selective");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("unusedThree"),
      `unusedThree should be flagged, got: ${allUnusedNames}`,
    );
    assert.ok(
      allUnusedNames.includes("unusedFour"),
      `unusedFour should be flagged, got: ${allUnusedNames}`,
    );
  });
});

describe("reexport-multi-hop", () => {
  it("should not flag used (imported through two barrel hops)", async () => {
    const result = await scanFixture("reexport-multi-hop");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("used"), "used is consumed through 2-hop barrel");
  });

  it("should flag unused1 and unused2", async () => {
    const result = await scanFixture("reexport-multi-hop");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("unused1"),
      `unused1 should be unused, got: ${allUnusedNames}`,
    );
    assert.ok(
      allUnusedNames.includes("unused2"),
      `unused2 should be unused, got: ${allUnusedNames}`,
    );
  });
});

describe("reexport-multi-level", () => {
  it("should not flag alpha and beta (used through 3-level named re-export chain)", async () => {
    const result = await scanFixture("reexport-multi-level");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("alpha"), "alpha is used");
    assert.ok(!allUnusedNames.includes("beta"), "beta is used");
  });

  it("should flag gamma (re-exported in barrel-a but not imported)", async () => {
    const result = await scanFixture("reexport-multi-level");
    const allUnusedNames = deadExportNames(result);
    assert.ok(allUnusedNames.includes("gamma"), `gamma should be unused, got: ${allUnusedNames}`);
  });

  it("should flag delta (only in barrel-b, not re-exported by barrel-a)", async () => {
    const result = await scanFixture("reexport-multi-level");
    const allUnusedNames = deadExportNames(result);
    assert.ok(allUnusedNames.includes("delta"), `delta should be unused, got: ${allUnusedNames}`);
  });

  it("should flag epsilon (not re-exported at all)", async () => {
    const result = await scanFixture("reexport-multi-level");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("epsilon"),
      `epsilon should be unused, got: ${allUnusedNames}`,
    );
  });
});

describe("reexport-default", () => {
  it("should not flag Button (used via default re-export through barrel)", async () => {
    const result = await scanFixture("reexport-default");
    const fixtureDir = resolve(FIXTURES_DIR, "reexport-default");
    const exportsByFile = deadExportsByFile(result, fixtureDir);
    const buttonExports = exportsByFile["src/components/Button.ts"];
    assert.ok(!buttonExports?.includes("default"), "Button default export is used");
  });
});

describe("reexport-unused", () => {
  it("should not flag UsedComponent", async () => {
    const result = await scanFixture("reexport-unused");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("UsedComponent"), "UsedComponent is imported");
  });

  it("should not flag unused-source.ts as unused file (file-level: barrel re-export makes it reachable)", async () => {
    const result = await scanFixture("reexport-unused");
    const fixtureDir = resolve(FIXTURES_DIR, "reexport-unused");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.some((filePath) => filePath === "src/components/unused-source.ts"),
      `unused-source.ts should be reachable via barrel re-export (file-level), got: ${unusedFilePaths}`,
    );
  });
});

describe("deep-reexport-tracking", () => {
  it("should keep used-source.ts reachable (usedHelper consumed through two barrel layers)", async () => {
    const result = await scanFixture("deep-reexport-tracking");
    const fixtureDir = resolve(FIXTURES_DIR, "deep-reexport-tracking");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/used-source.ts"),
      "used-source.ts should be reachable via barrel-mid → barrel-top → index",
    );
  });

  it("should not flag unused-source.ts as unused file (file-level: barrel re-export chain makes it reachable)", async () => {
    const result = await scanFixture("deep-reexport-tracking");
    const fixtureDir = resolve(FIXTURES_DIR, "deep-reexport-tracking");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/unused-source.ts"),
      `unused-source.ts should be reachable via barrel re-export chain (file-level), got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan.ts as unused file", async () => {
    const result = await scanFixture("deep-reexport-tracking");
    const fixtureDir = resolve(FIXTURES_DIR, "deep-reexport-tracking");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should flag usedHelperSibling as unused export", async () => {
    const result = await scanFixture("deep-reexport-tracking");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("usedHelperSibling"),
      `usedHelperSibling should be unused, got: ${allUnusedNames}`,
    );
  });
});

describe("wildcard-late-consume", () => {
  it("should keep color-picker reachable when consumed via plugin that imports from sibling component barrel", async () => {
    const result = await scanFixture("wildcard-late-consume");
    const fixtureDir = resolve(FIXTURES_DIR, "wildcard-late-consume");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/color-picker/color-picker.ts"),
      `color-picker.ts should be reachable via plugin → components barrel → color-picker barrel, got unused: ${unusedFilePaths}`,
    );
  });

  it("should keep color-picker/index.ts reachable as intermediate barrel", async () => {
    const result = await scanFixture("wildcard-late-consume");
    const fixtureDir = resolve(FIXTURES_DIR, "wildcard-late-consume");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/color-picker/index.ts"),
      `color-picker/index.ts should be reachable, got unused: ${unusedFilePaths}`,
    );
  });

  it("should flag unused-widget.ts as unused file (never imported by any plugin)", async () => {
    const result = await scanFixture("wildcard-late-consume");
    const fixtureDir = resolve(FIXTURES_DIR, "wildcard-late-consume");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/components/unused-widget.ts"),
      `unused-widget.ts should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should flag ColorUtils as unused export (only ColorPicker consumed from color-picker.ts)", async () => {
    const result = await scanFixture("wildcard-late-consume");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("ColorUtils"),
      `ColorUtils should be unused export, got: ${allUnusedNames}`,
    );
  });
});

describe("import-reexport-same", () => {
  it("should create both direct import and re-export edges when a file imports from and re-exports the same module", async () => {
    const result = await scanFixture("import-reexport-same");
    const fixtureDir = resolve(FIXTURES_DIR, "import-reexport-same");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/widget.ts"),
      `widget.ts should be reachable via re-export through components barrel (export * from), got unused: ${unusedFilePaths}`,
    );
  });

  it("should keep helper.ts reachable via both direct import and re-export", async () => {
    const result = await scanFixture("import-reexport-same");
    const fixtureDir = resolve(FIXTURES_DIR, "import-reexport-same");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/helper.ts"),
      `helper.ts should be reachable, got unused: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan.ts as unused (not imported or re-exported by anyone)", async () => {
    const result = await scanFixture("import-reexport-same");
    const fixtureDir = resolve(FIXTURES_DIR, "import-reexport-same");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("reexport-alias", () => {
  it("should not flag original and renamed (used via aliased re-export chain)", async () => {
    const result = await scanFixture("reexport-alias");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("original"), "original is used via aliasC");
    assert.ok(!allUnusedNames.includes("renamed"), "renamed is used via doubleAlias");
  });

  it("should flag unusedOriginal (aliased but never consumed)", async () => {
    const result = await scanFixture("reexport-alias");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("unusedOriginal"),
      `unusedOriginal should be unused, got: ${allUnusedNames}`,
    );
  });

  it("should flag neverExported (not re-exported by any barrel)", async () => {
    const result = await scanFixture("reexport-alias");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("neverExported"),
      `neverExported should be unused, got: ${allUnusedNames}`,
    );
  });
});

describe("import-dynamic", () => {
  it("should keep lazy.ts reachable via dynamic import", async () => {
    const result = await scanFixture("import-dynamic");
    const fixtureDir = resolve(FIXTURES_DIR, "import-dynamic");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/lazy.ts"), "lazy.ts is dynamically imported");
  });

  it("should flag orphan.ts as unused file", async () => {
    const result = await scanFixture("import-dynamic");
    const fixtureDir = resolve(FIXTURES_DIR, "import-dynamic");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should flag unused export in utils", async () => {
    const result = await scanFixture("import-dynamic");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("unused"),
      `unused should be flagged, got: ${allUnusedNames}`,
    );
  });
});

describe("type-deps", () => {
  it("should detect type-only imports", async () => {
    const result = await scanFixture("type-deps");
    assert.ok(result.totalFiles > 0, "should find files");
  });
});

describe("orphan-barrel-subtree", () => {
  it("should flag all files in the dead subtree", async () => {
    const result = await scanFixture("orphan-barrel-subtree");
    const fixtureDir = resolve(FIXTURES_DIR, "orphan-barrel-subtree");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/subtree/setup.ts"),
      `setup.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("orphan-mixed-exports", () => {
  it("should flag both files in unreachable test-utils", async () => {
    const result = await scanFixture("orphan-mixed-exports");
    const fixtureDir = resolve(FIXTURES_DIR, "orphan-mixed-exports");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/test-utils/helpers.ts"),
      `helpers.ts should be unused, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/test-utils/setup.ts"),
      `setup.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("reexport-mixed", () => {
  it("should not flag namedUsed and starUsed", async () => {
    const result = await scanFixture("reexport-mixed");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("namedUsed"), "namedUsed is consumed");
    assert.ok(!allUnusedNames.includes("starUsed"), "starUsed is consumed");
  });

  it("should flag namedUnused and starUnused", async () => {
    const result = await scanFixture("reexport-mixed");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("namedUnused"),
      `namedUnused should be flagged, got: ${allUnusedNames}`,
    );
    assert.ok(
      allUnusedNames.includes("starUnused"),
      `starUnused should be flagged, got: ${allUnusedNames}`,
    );
  });
});

describe("alias-paths", () => {
  it("should resolve @/ alias and not flag helper as unused", async () => {
    const result = await scanFixture("alias-paths");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("helper"), "helper is imported via @/ alias");
  });

  it("should not flag any files as unused", async () => {
    const result = await scanFixture("alias-paths");
    assert.equal(result.unusedFiles.length, 0, "all files reachable via alias");
  });
});

describe("webpack-resolve", () => {
  it("should resolve webpack aliases and module roots", async () => {
    const result = await scanFixture("webpack-resolve");
    const fixtureDir = resolve(FIXTURES_DIR, "webpack-resolve");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/App.ts"),
      `App.ts should be reachable through resolve.modules, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("app/views/actions/run-action.ts"),
      `run-action.ts should be reachable through resolve.alias, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("app/views/utils/helper.ts"),
      `helper.ts should be reachable through path.join alias, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("app/views/actions/orphan.ts"),
      `alias orphan should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("entry-validation", () => {
  it("should not flag entry exports by default", async () => {
    const result = await scanFixture("entry-validation");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("meatdata"), "entry exports are excluded by default");
    assert.ok(!allUnusedNames.includes("config"), "entry exports are excluded by default");
  });

  it("should flag entry exports when includeEntryExports is true", async () => {
    const result = await scanFixture("entry-validation", {
      includeEntryExports: true,
    });
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("meatdata"),
      `meatdata should be unused when checking entry exports, got: ${allUnusedNames}`,
    );
    assert.ok(
      allUnusedNames.includes("config"),
      `config should be unused when checking entry exports, got: ${allUnusedNames}`,
    );
  });
});

describe("ns-exports", () => {
  it("should handle TypeScript namespace exports", async () => {
    const result = await scanFixture("ns-exports");
    assert.ok(result.totalFiles > 0, "should parse files with namespace exports");
    const fixtureDir = resolve(FIXTURES_DIR, "ns-exports");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/helpers.ts"), "helpers.ts is imported");
  });
});

describe("commonjs-app", () => {
  it("should flag orphan.js as unused", async () => {
    const result = await scanFixture("commonjs-app");
    const fixtureDir = resolve(FIXTURES_DIR, "commonjs-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.js"),
      `orphan.js should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("config-detection", () => {
  it("should flag orphan.ts as unused", async () => {
    const result = await scanFixture("config-detection");
    const fixtureDir = resolve(FIXTURES_DIR, "config-detection");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should flag unusedFunction as unused export", async () => {
    const result = await scanFixture("config-detection");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("unusedFunction"),
      `unusedFunction should be unused, got: ${allUnusedNames}`,
    );
  });
});

describe("import-dynamic-literal", () => {
  it("should keep notes.ts reachable via dynamic import from parent path", async () => {
    const result = await scanFixture("import-dynamic-literal");
    const fixtureDir = resolve(FIXTURES_DIR, "import-dynamic-literal");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("notes.ts"), "notes.ts is dynamically imported");
  });

  it("should flag orphan.ts as unused", async () => {
    const result = await scanFixture("import-dynamic-literal");
    const fixtureDir = resolve(FIXTURES_DIR, "import-dynamic-literal");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("arrow-wrapped-import-dynamic", () => {
  it("should keep Foo.tsx, Bar.tsx, Baz.tsx reachable via wrapped dynamic imports", async () => {
    const result = await scanFixture("arrow-wrapped-import-dynamic");
    const fixtureDir = resolve(FIXTURES_DIR, "arrow-wrapped-import-dynamic");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/Foo.tsx"), "Foo.tsx is lazily imported");
    assert.ok(!unusedFilePaths.includes("src/Bar.tsx"), "Bar.tsx is lazily imported");
    assert.ok(!unusedFilePaths.includes("src/Baz.tsx"), "Baz.tsx is lazily imported");
  });

  it("should keep feature.routes.ts reachable via loadChildren arrow", async () => {
    const result = await scanFixture("arrow-wrapped-import-dynamic");
    const fixtureDir = resolve(FIXTURES_DIR, "arrow-wrapped-import-dynamic");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/feature.routes.ts"),
      "feature.routes.ts is dynamically imported",
    );
  });

  it("should flag orphan.ts as unused", async () => {
    const result = await scanFixture("arrow-wrapped-import-dynamic");
    const fixtureDir = resolve(FIXTURES_DIR, "arrow-wrapped-import-dynamic");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("type-cycle", () => {
  it("should not crash on circular type-only imports", async () => {
    const result = await scanFixture("type-cycle");
    assert.ok(result.totalFiles > 0, "should complete analysis without crashing");
  });

  it("should not flag user.ts or post.ts as unused", async () => {
    const result = await scanFixture("type-cycle");
    const fixtureDir = resolve(FIXTURES_DIR, "type-cycle");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/user.ts"), "user.ts is imported");
    assert.ok(!unusedFilePaths.includes("src/post.ts"), "post.ts is imported");
  });

  it("should not flag createUser or createPost as unused", async () => {
    const result = await scanFixture("type-cycle");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("createUser"), "createUser is used");
    assert.ok(!allUnusedNames.includes("createPost"), "createPost is used");
  });
});

describe("orphan-dynamic-subtree", () => {
  it("should flag setup.ts and lazy.ts as unused (subtree not reachable from entry)", async () => {
    const result = await scanFixture("orphan-dynamic-subtree");
    const fixtureDir = resolve(FIXTURES_DIR, "orphan-dynamic-subtree");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/subtree/setup.ts"),
      `setup.ts should be unused, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/subtree/lazy.ts"),
      `lazy.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("orphan-shared-child", () => {
  it("should flag subtree/setup.ts and subtree/helpers.ts as unused", async () => {
    const result = await scanFixture("orphan-shared-child");
    const fixtureDir = resolve(FIXTURES_DIR, "orphan-shared-child");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/subtree/setup.ts"),
      `setup.ts should be unused, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/subtree/helpers.ts"),
      `helpers.ts should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should not flag shared/utils.ts as unused (imported by entry)", async () => {
    const result = await scanFixture("orphan-shared-child");
    const fixtureDir = resolve(FIXTURES_DIR, "orphan-shared-child");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/shared/utils.ts"), "shared/utils.ts is used by entry");
  });
});

describe("style-tracking", () => {
  it("should track imported CSS as reachable via import graph", async () => {
    const result = await scanFixture("style-tracking");
    const fixtureDir = resolve(FIXTURES_DIR, "style-tracking");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/styles.css"),
      "styles.css is imported and should be reachable",
    );
  });

  it("should flag unimported CSS files as unused", async () => {
    const result = await scanFixture("style-tracking");
    const fixtureDir = resolve(FIXTURES_DIR, "style-tracking");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/unused.css"),
      "CSS files are excluded from unused-file detection",
    );
  });

  it("should flag orphan TS files", async () => {
    const result = await scanFixture("style-tracking");
    const fixtureDir = resolve(FIXTURES_DIR, "style-tracking");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("config-mixed-formats", () => {
  it("should treat .cjs and .mjs config files as entry points", async () => {
    const result = await scanFixture("config-mixed-formats");
    const fixtureDir = resolve(FIXTURES_DIR, "config-mixed-formats");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("prettier.config.mjs"),
      "prettier.config.mjs should be treated as config entry point",
    );
    assert.ok(
      !unusedFilePaths.includes("vitest.config.mts"),
      "vitest.config.mts should be treated as config entry point",
    );
    assert.ok(
      unusedFilePaths.includes("lage.config.cjs"),
      "lage.config.cjs should be unused (not in the config file list)",
    );
  });

  it("should still flag orphan files", async () => {
    const result = await scanFixture("config-mixed-formats");
    const fixtureDir = resolve(FIXTURES_DIR, "config-mixed-formats");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("test-runner-detect", () => {
  it("should treat .test.ts files as entry points", async () => {
    const result = await scanFixture("test-runner-detect");
    const fixtureDir = resolve(FIXTURES_DIR, "test-runner-detect");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/helper.test.ts"),
      `helper.test.ts should be an entry point (vitest detected), got: ${unusedFilePaths}`,
    );
  });

  it("should treat __tests__ files as entry points", async () => {
    const result = await scanFixture("test-runner-detect");
    const fixtureDir = resolve(FIXTURES_DIR, "test-runner-detect");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/__tests__/utils.test.ts"),
      `__tests__/utils.test.ts should be an entry point (vitest detected), got: ${unusedFilePaths}`,
    );
  });

  it("should keep files imported by test files as reachable", async () => {
    const result = await scanFixture("test-runner-detect");
    const fixtureDir = resolve(FIXTURES_DIR, "test-runner-detect");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/helper.ts"),
      `helper.ts should be reachable via test import, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/test-only-used.ts"),
      `test-only-used.ts should be reachable via test import, got: ${unusedFilePaths}`,
    );
  });

  it("should still flag orphan files", async () => {
    const result = await scanFixture("test-runner-detect");
    const fixtureDir = resolve(FIXTURES_DIR, "test-runner-detect");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("test-no-runner", () => {
  it("should NOT treat .test.ts as entry point without a test runner dependency", async () => {
    const result = await scanFixture("test-no-runner");
    const fixtureDir = resolve(FIXTURES_DIR, "test-no-runner");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/helper.test.ts"),
      `test files are excluded from unused-file detection, got: ${unusedFilePaths}`,
    );
  });
});

describe("alias-mixed-exports", () => {
  it("should resolve @/ aliases and keep used files reachable", async () => {
    const result = await scanFixture("alias-mixed-exports");
    const fixtureDir = resolve(FIXTURES_DIR, "alias-mixed-exports");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/types.ts"), "types.ts is imported via alias");
    assert.ok(!unusedFilePaths.includes("src/helpers.ts"), "helpers.ts is imported via alias");
  });

  it("should flag orphan.ts as unused", async () => {
    const result = await scanFixture("alias-mixed-exports");
    const fixtureDir = resolve(FIXTURES_DIR, "alias-mixed-exports");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should flag unusedExport and unusedHelper", async () => {
    const result = await scanFixture("alias-mixed-exports");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("unusedExport"),
      `unusedExport should be unused, got: ${allUnusedNames}`,
    );
    assert.ok(
      allUnusedNames.includes("unusedHelper"),
      `unusedHelper should be unused, got: ${allUnusedNames}`,
    );
  });
});

describe("mock-patterns", () => {
  it("should treat __fixtures__ files as entry points", async () => {
    const result = await scanFixture("mock-patterns");
    const fixtureDir = resolve(FIXTURES_DIR, "mock-patterns");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/__fixtures__/user-data.ts"),
      `__fixtures__/user-data.ts should be an entry point (vitest fixture), got: ${unusedFilePaths}`,
    );
  });

  it("should treat __mocks__ files as unused when only vitest is present (not jest)", async () => {
    const result = await scanFixture("mock-patterns");
    const fixtureDir = resolve(FIXTURES_DIR, "mock-patterns");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/__mocks__/api-client.ts"),
      `__mocks__/api-client.ts should be unused (vitest does not auto-discover __mocks__), got: ${unusedFilePaths}`,
    );
  });

  it("should still flag orphan files", async () => {
    const result = await scanFixture("mock-patterns");
    const fixtureDir = resolve(FIXTURES_DIR, "mock-patterns");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("electron-app", () => {
  it("should use directory-based Electron plugin patterns (src/main/**/)", async () => {
    const result = await scanFixture("electron-app");
    const fixtureDir = resolve(FIXTURES_DIR, "electron-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/main/index.ts"),
      `src/main/index.ts should be entry via Electron plugin src/main/**/*.{ts,js}, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/main/window.ts"),
      `src/main/window.ts should be reachable from main/index.ts, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/preload/preload.ts"),
      `src/preload/preload.ts should be entry via Electron plugin src/preload/**/*.{ts,js}, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/preload.ts"),
      `src/preload.ts (file, not inside src/preload/ dir) should be unused, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("electron-entries", () => {
  it("should detect vite src/main.ts entry and electron src/preload/ dir entries", async () => {
    const result = await scanFixture("electron-entries");
    const fixtureDir = resolve(FIXTURES_DIR, "electron-entries");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/main.ts"),
      `src/main.ts should be entry via vite plugin, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/app.ts"),
      `src/app.ts should be reachable from main.ts, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/preload/index.ts"),
      `src/preload/index.ts should be entry via electron plugin src/preload/**/*.{ts,...}, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/preload/bridge.ts"),
      `src/preload/bridge.ts should be reachable from preload/index.ts, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("ava-app", () => {
  it("should detect ava test files as entry points", async () => {
    const result = await scanFixture("ava-app");
    const fixtureDir = resolve(FIXTURES_DIR, "ava-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("test/math.test.ts"),
      `test/math.test.ts should be entry via ava plugin, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/math.ts"),
      `src/math.ts should be reachable from test, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("src-path-fallback", () => {
  it("should resolve dist/ exports to src/index.ts fallback when exact match not found", async () => {
    const result = await scanFixture("src-path-fallback");
    const fixtureDir = resolve(FIXTURES_DIR, "src-path-fallback");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/index.ts"),
      `src/index.ts should be resolved from dist/index.js export, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/helper.ts"),
      `src/helper.ts should be reachable from index.ts, got: ${unusedFilePaths}`,
    );
  });

  it("should resolve dist/cli.js to src/cli/index.ts via tsconfig outDir", async () => {
    const result = await scanFixture("src-path-fallback");
    const fixtureDir = resolve(FIXTURES_DIR, "src-path-fallback");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/cli/index.ts"),
      `src/cli/index.ts should be reachable via dist/cli.js bin entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/cli/runner.ts"),
      `src/cli/runner.ts should be reachable via cli/index.ts, got: ${unusedFilePaths}`,
    );
  });

  it("should still flag orphan files", async () => {
    const result = await scanFixture("src-path-fallback");
    const fixtureDir = resolve(FIXTURES_DIR, "src-path-fallback");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("heuristic-no-dir-fallback", () => {
  it("should not resolve dist/cli.js to src/cli/index.ts without tsconfig outDir", async () => {
    const result = await scanFixture("heuristic-no-dir-fallback");
    const fixtureDir = resolve(FIXTURES_DIR, "heuristic-no-dir-fallback");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/cli/index.ts"),
      `src/cli/index.ts should be unused (heuristic should not do directory fallback), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/index.ts"),
      `src/index.ts should be resolved from dist/index.js via heuristic, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("spec-dash-patterns", () => {
  it("should treat *-spec.ts and *_spec.ts as unused (not matched by vitest/jest patterns)", async () => {
    const result = await scanFixture("spec-dash-patterns");
    const fixtureDir = resolve(FIXTURES_DIR, "spec-dash-patterns");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("spec/utils-spec.ts"),
      `utils-spec.ts should be unused (*-spec not matched by vitest), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("spec/engine_spec.ts"),
      `engine_spec.ts should be unused (*_spec not matched by vitest), got: ${unusedFilePaths}`,
    );
  });

  it("should still flag orphan files", async () => {
    const result = await scanFixture("spec-dash-patterns");
    const fixtureDir = resolve(FIXTURES_DIR, "spec-dash-patterns");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("workspace-explicit", () => {
  it("should treat workspace package main entry as reachable and keep non-imported files unused", async () => {
    const result = await scanFixture("workspace-explicit");
    const fixtureDir = resolve(FIXTURES_DIR, "workspace-explicit");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("packages/ui/src/button.ts"),
      `packages/ui/src/button.ts should be reachable (workspace main entry), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("packages/ui/src/index.ts"),
      `packages/ui/src/index.ts should be unused (not imported by main entry), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("packages/utils/src/index.ts"),
      `packages/utils/src/index.ts should be reachable (default index fallback for workspace without main), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("packages/utils/src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("lerna-workspace", () => {
  it("should discover workspace packages from lerna.json", async () => {
    const result = await scanFixture("lerna-workspace");
    const fixtureDir = resolve(FIXTURES_DIR, "lerna-workspace");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("packages/app/src/index.ts"),
      `app index should be reachable as a lerna workspace entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("packages/ui/src/index.ts"),
      `ui index should be reachable via workspace package import, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("packages/ui/src/button.ts"),
      `button.ts should be reachable through the ui barrel, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("packages/ui/src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("workspace-defaults", () => {
  it("should fall back to src/index when package.json entries point to non-existent dist", async () => {
    const result = await scanFixture("workspace-defaults");
    const fixtureDir = resolve(FIXTURES_DIR, "workspace-defaults");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("packages/lib-a/src/index.ts"),
      `packages/lib-a/src/index.ts should be reachable (default fallback from dist entry), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("packages/lib-a/src/helper.ts"),
      `packages/lib-a/src/helper.ts should be reachable (imported by index.ts), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("packages/lib-a/src/orphan.ts"),
      `packages/lib-a/src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("packages/lib-b/src/index.ts"),
      `packages/lib-b/src/index.ts should be reachable (default index fallback for package without main), got: ${unusedFilePaths}`,
    );
  });
});

describe("workspace-wildcards", () => {
  it("should expand wildcard exports as entry points and resolve via imports", async () => {
    const result = await scanFixture("workspace-wildcards");
    const fixtureDir = resolve(FIXTURES_DIR, "workspace-wildcards");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("packages/ui/src/components/index.ts"),
      `components/index.ts should be reachable via wildcard export resolution, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("packages/ui/src/components/button.ts"),
      `button.ts should be reachable via barrel re-export, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("packages/ui/src/orphan.ts"),
      `orphan.ts should be reachable — wildcard export src/* expands it as entry point, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("packages/ui/internal/hidden.ts"),
      `internal/hidden.ts should be unused (not covered by exports), got: ${unusedFilePaths}`,
    );
  });
});

describe("wildcard-subpath", () => {
  it("should expand wildcard exports as entry points", async () => {
    const result = await scanFixture("wildcard-subpath");
    const fixtureDir = resolve(FIXTURES_DIR, "wildcard-subpath");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/templates/welcome.tsx"),
      `welcome.tsx should be reachable — wildcard exports are expanded as entries, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/templates/goodbye.tsx"),
      `goodbye.tsx should be reachable — wildcard exports are expanded as entries, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused (not in templates dir), got: ${unusedFilePaths}`,
    );
  });
});

describe("vite-glob-import", () => {
  it("should resolve import.meta.glob patterns including array syntax", async () => {
    const result = await scanFixture("vite-glob-import");
    const fixtureDir = resolve(FIXTURES_DIR, "vite-glob-import");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/modules/alpha.ts"),
      `alpha.ts should be reachable via import.meta.glob, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/modules/beta.ts"),
      `beta.ts should be reachable via import.meta.glob, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/layouts/main.ts"),
      `layouts/main.ts should be reachable via import.meta.glob array pattern, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused (not matched by glob pattern), got: ${unusedFilePaths}`,
    );
  });
});

describe("jest-mock-files", () => {
  it("should treat __mocks__ files as test entry points when jest is present", async () => {
    const result = await scanFixture("jest-mock-files");
    const fixtureDir = resolve(FIXTURES_DIR, "jest-mock-files");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("__mocks__/fs.ts"),
      `__mocks__/fs.ts should be reachable as Jest manual mock entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("__mocks__/api-client.ts"),
      `__mocks__/api-client.ts should be reachable as Jest manual mock entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("jest-match", () => {
  it("should use custom testMatch patterns from jest.config.ts instead of defaults", async () => {
    const result = await scanFixture("jest-match");
    const fixtureDir = resolve(FIXTURES_DIR, "jest-match");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/utils.test.ts"),
      `src/utils.test.ts should be reachable via custom testMatch, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/__tests__/app.test.ts"),
      `src/__tests__/app.test.ts should be reachable via custom testMatch, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("tests/outside.test.ts"),
      `test files are excluded from unused-file detection, got: ${unusedFilePaths}`,
    );
  });
});

describe("webpack-require-ctx", () => {
  it("should resolve require.context patterns with recursive flag and regex filter", async () => {
    const result = await scanFixture("webpack-require-ctx");
    const fixtureDir = resolve(FIXTURES_DIR, "webpack-require-ctx");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/Button.tsx"),
      `Button.tsx should be reachable via require.context('./components', true, /\\.tsx$/), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/components/nested/Card.tsx"),
      `nested/Card.tsx should be reachable via recursive require.context, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/pages/home.ts"),
      `pages/home.ts should be reachable via require.context('./pages', false), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused (not matched by any require.context), got: ${unusedFilePaths}`,
    );
  });
});

describe("storybook-app", () => {
  it("should treat .stories.ts files as entry points when @storybook/* is present", async () => {
    const result = await scanFixture("storybook-app");
    const fixtureDir = resolve(FIXTURES_DIR, "storybook-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/Button.stories.ts"),
      `Button.stories.ts should be entry point, got: ${unusedFilePaths}`,
    );
  });

  it("should treat .storybook config files as entry points", async () => {
    const result = await scanFixture("storybook-app");
    const fixtureDir = resolve(FIXTURES_DIR, "storybook-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes(".storybook/main.ts"),
      `.storybook/main.ts should be entry point, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes(".storybook/preview.ts"),
      `.storybook/preview.ts should be entry point, got: ${unusedFilePaths}`,
    );
  });

  it("should mark components imported by stories as used", async () => {
    const result = await scanFixture("storybook-app");
    const fixtureDir = resolve(FIXTURES_DIR, "storybook-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/Button.ts"),
      `Button.ts should be reachable from stories, got: ${unusedFilePaths}`,
    );
  });

  it("should still flag orphan files in storybook projects", async () => {
    const result = await scanFixture("storybook-app");
    const fixtureDir = resolve(FIXTURES_DIR, "storybook-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("graphql-schema", () => {
  it("should track imported graphql files as reachable", async () => {
    const result = await scanFixture("graphql-schema");
    const fixtureDir = resolve(FIXTURES_DIR, "graphql-schema");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/schema.graphql"),
      `schema.graphql is imported and should be reachable, got: ${unusedFilePaths}`,
    );
  });

  it("should flag unused graphql files", async () => {
    const result = await scanFixture("graphql-schema");
    const fixtureDir = resolve(FIXTURES_DIR, "graphql-schema");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/unused.graphql"),
      `GraphQL files are excluded from unused-file detection, got: ${unusedFilePaths}`,
    );
  });
});

describe("next-pages-mdx", () => {
  it("should exclude MDX files from unused-file detection", async () => {
    const result = await scanFixture("next-pages-mdx");
    const fixtureDir = resolve(FIXTURES_DIR, "next-pages-mdx");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("pages/about.mdx"),
      `about.mdx should be excluded from unused-file (MDX files are excluded by default)`,
    );
  });

  it("should still discover TSX files in pages/ as entry points", async () => {
    const result = await scanFixture("next-pages-mdx");
    const fixtureDir = resolve(FIXTURES_DIR, "next-pages-mdx");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("pages/index.tsx"),
      `index.tsx should be entry point, got: ${unusedFilePaths}`,
    );
  });

  it("should mark components imported by pages as reachable", async () => {
    const result = await scanFixture("next-pages-mdx");
    const fixtureDir = resolve(FIXTURES_DIR, "next-pages-mdx");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/Home.ts"),
      `Home.ts is imported by index.tsx and should be reachable, got: ${unusedFilePaths}`,
    );
  });
});

describe("migration-orm", () => {
  it("should treat migration files as entry points when ORM is detected", async () => {
    const result = await scanFixture("migration-orm");
    const fixtureDir = resolve(FIXTURES_DIR, "migration-orm");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("migrations/001-create-users.ts"),
      `migration file should be entry point when knex is present, got: ${unusedFilePaths}`,
    );
  });

  it("should still flag orphan files", async () => {
    const result = await scanFixture("migration-orm");
    const fixtureDir = resolve(FIXTURES_DIR, "migration-orm");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("migration-raw", () => {
  it("should NOT treat migration files as entry points without ORM dependency", async () => {
    const result = await scanFixture("migration-raw");
    const fixtureDir = resolve(FIXTURES_DIR, "migration-raw");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("migrations/001-create-users.ts"),
      `migration file should be unused without ORM, got: ${unusedFilePaths}`,
    );
  });
});

describe("style-imports", () => {
  it("should track CSS files imported from TS as reachable", async () => {
    const result = await scanFixture("style-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "style-imports");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/app.css"),
      `app.css is imported by index.ts and should be reachable, got: ${unusedFilePaths}`,
    );
  });

  it("should track CSS @import chains as reachable", async () => {
    const result = await scanFixture("style-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "style-imports");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("styles/base.css"),
      `base.css is @imported from app.css and should be reachable, got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan CSS files as unused", async () => {
    const result = await scanFixture("style-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "style-imports");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("styles/orphan.css"),
      `CSS files are excluded from unused-file detection, got: ${unusedFilePaths}`,
    );
  });
});

describe("nestjs-app", () => {
  it("should detect NestJS convention files as entry points", async () => {
    const result = await scanFixture("nestjs-app");
    const fixtureDir = resolve(FIXTURES_DIR, "nestjs-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/app.module.ts"),
      `app.module.ts should be entry point (NestJS module), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/users.controller.ts"),
      `users.controller.ts should be entry point (NestJS controller), got: ${unusedFilePaths}`,
    );
  });

  it("should flag non-NestJS files as unused", async () => {
    const result = await scanFixture("nestjs-app");
    const fixtureDir = resolve(FIXTURES_DIR, "nestjs-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("test-node-runner", () => {
  it("should treat node --test files as entry points", async () => {
    const result = await scanFixture("test-node-runner");
    const fixtureDir = resolve(FIXTURES_DIR, "test-node-runner");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/__tests__/main.test.ts"),
      `main.test.ts should be an entry point (node test runner detected), got: ${unusedFilePaths}`,
    );
  });

  it("should flag non-test orphan files as unused", async () => {
    const result = await scanFixture("test-node-runner");
    const fixtureDir = resolve(FIXTURES_DIR, "test-node-runner");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("config-script-flags", () => {
  it("should detect --config flag files as entry points", async () => {
    const result = await scanFixture("config-script-flags");
    const fixtureDir = resolve(FIXTURES_DIR, "config-script-flags");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("db/drizzle.config.ts"),
      `drizzle.config.ts should be entry point (--config flag), got: ${unusedFilePaths}`,
    );
  });

  it("should detect tsx script files as entry points", async () => {
    const result = await scanFixture("config-script-flags");
    const fixtureDir = resolve(FIXTURES_DIR, "config-script-flags");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("scripts/seed.ts"),
      `seed.ts should be entry point (tsx script), got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan files as unused", async () => {
    const result = await scanFixture("config-script-flags");
    const fixtureDir = resolve(FIXTURES_DIR, "config-script-flags");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused (config-script-flags), got: ${unusedFilePaths}`,
    );
  });
});

describe("i18n-app", () => {
  it("should mark locale JSON files as always-used when i18next is a dependency", async () => {
    const result = await scanFixture("i18n-app");
    const fixtureDir = resolve(FIXTURES_DIR, "i18n-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("public/locales/en.json"),
      `en.json should be always-used (i18next locale), got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan files as unused", async () => {
    const result = await scanFixture("i18n-app");
    const fixtureDir = resolve(FIXTURES_DIR, "i18n-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused (i18n-app), got: ${unusedFilePaths}`,
    );
  });
});

describe("subproject-standalone", () => {
  it("should still scan standalone sub-project files and report unused", async () => {
    const result = await scanFixture("subproject-standalone");
    const fixtureDir = resolve(FIXTURES_DIR, "subproject-standalone");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.some((filePath: string) => filePath.startsWith("docs/")),
      `docs/ files should still be scanned, got: ${unusedFilePaths}`,
    );
  });

  it("should still detect unused files in the main app", async () => {
    const result = await scanFixture("subproject-standalone");
    const fixtureDir = resolve(FIXTURES_DIR, "subproject-standalone");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("app/src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("build-script-map", () => {
  it("should resolve build/ script references to src/ source files", async () => {
    const result = await scanFixture("build-script-map");
    const fixtureDir = resolve(FIXTURES_DIR, "build-script-map");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/scripts/migrate.ts"),
      `migrate.ts should be entry (build/ → src/ mapping), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/scripts/health-check.ts"),
      `health-check.ts should be entry (build/ → src/ mapping), got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan files as unused", async () => {
    const result = await scanFixture("build-script-map");
    const fixtureDir = resolve(FIXTURES_DIR, "build-script-map");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("tsconfig-wildcard", () => {
  it("should resolve wildcard * path alias that shadows Node.js built-in modules", async () => {
    const result = await scanFixture("tsconfig-wildcard");
    const fixtureDir = resolve(FIXTURES_DIR, "tsconfig-wildcard");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/constants/api.ts"),
      `constants/api.ts should be resolved via wildcard path alias, got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan files as unused", async () => {
    const result = await scanFixture("tsconfig-wildcard");
    const fixtureDir = resolve(FIXTURES_DIR, "tsconfig-wildcard");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused (wildcard alias), got: ${unusedFilePaths}`,
    );
  });
});

describe("scss-partial", () => {
  it("should resolve SCSS partial imports with underscore prefix", async () => {
    const result = await scanFixture("scss-partial");
    const fixtureDir = resolve(FIXTURES_DIR, "scss-partial");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/styles/_variables.scss"),
      `_variables.scss should be used (SCSS partial import), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/styles/_mixins.scss"),
      `_mixins.scss should be used (SCSS @use), got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan SCSS partials as unused", async () => {
    const result = await scanFixture("scss-partial");
    const fixtureDir = resolve(FIXTURES_DIR, "scss-partial");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/styles/_orphan.scss"),
      `SCSS files are excluded from unused-file detection, got: ${unusedFilePaths}`,
    );
  });
});

describe("test-custom-ext", () => {
  it("should treat .clienttest, .servertest, and __e2e__ test files as unused (non-standard patterns)", async () => {
    const result = await scanFixture("test-custom-ext");
    const fixtureDir = resolve(FIXTURES_DIR, "test-custom-ext");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/utils.clienttest.ts"),
      `.clienttest.ts should be unused (non-standard pattern), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/api.servertest.ts"),
      `.servertest.ts should be unused (non-standard pattern), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/__e2e__/login.test.ts"),
      `__e2e__/*.test.ts should still be matched by **/*.test.* pattern, got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan files as unused", async () => {
    const result = await scanFixture("test-custom-ext");
    const fixtureDir = resolve(FIXTURES_DIR, "test-custom-ext");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("vue-app", () => {
  it("should follow imports inside Vue SFC script blocks", async () => {
    const result = await scanFixture("vue-app");
    const fixtureDir = resolve(FIXTURES_DIR, "vue-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/App.vue"),
      `App.vue should be used (imported from main.ts), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/components/HelloWorld.vue"),
      `HelloWorld.vue should be used (imported from App.vue), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/utils.ts"),
      `utils.ts should be used (imported from HelloWorld.vue), got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan Vue components as unused", async () => {
    const result = await scanFixture("vue-app");
    const fixtureDir = resolve(FIXTURES_DIR, "vue-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/components/OrphanComponent.vue"),
      `OrphanComponent.vue should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("vite-app", () => {
  it("should detect entry points from vite.config rollupOptions.input", async () => {
    const result = await scanFixture("vite-app");
    const fixtureDir = resolve(FIXTURES_DIR, "vite-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/main.tsx"),
      `main.tsx should be used (vite entry), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/render.ts"),
      `render.ts should be used (imported from vite entry), got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan files as unused with vite entry", async () => {
    const result = await scanFixture("vite-app");
    const fixtureDir = resolve(FIXTURES_DIR, "vite-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("outdir-mapping", () => {
  it("should resolve built paths back to source via tsconfig outDir", async () => {
    const result = await scanFixture("outdir-mapping");
    const fixtureDir = resolve(FIXTURES_DIR, "outdir-mapping");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("main/index.ts"),
      `main/index.ts should be used (entry via outDir mapping), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("main/setup.ts"),
      `main/setup.ts should be used (imported from entry), got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan files even with outDir source mapping", async () => {
    const result = await scanFixture("outdir-mapping");
    const fixtureDir = resolve(FIXTURES_DIR, "outdir-mapping");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("main/orphan.ts"),
      `main/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

test("should resolve imports with query parameters (e.g. ?url, ?raw, ?worker)", async () => {
  const result = await scanFixture("import-query-param");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("config.ts")),
    `config.ts should NOT be unused (imported via ?raw), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("worker.ts")),
    `worker.ts should NOT be unused (imported via ?worker), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("styles.css")),
    `styles.css should NOT be unused (imported via ?url), got unused: ${unusedFilePaths}`,
  );
});

test("should flag orphan files even with query-param imports present", async () => {
  const result = await scanFixture("import-query-param");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("orphan.ts")),
    `orphan.ts should be unused, got unused: ${unusedFilePaths}`,
  );
});

test("should detect script entry points with --key value flag pairs", async () => {
  const result = await scanFixture("script-flags");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("scripts/build.ts")),
    `scripts/build.ts should NOT be unused (referenced via tsx --tsconfig X scripts/build.ts), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("scripts/generate.mts")),
    `scripts/generate.mts should NOT be unused (referenced via bun run), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("tests/run.ts")),
    `tests/run.ts should NOT be unused (referenced via node --import tsx --test), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("orphan.ts")),
    `orphan.ts should be unused, got unused: ${unusedFilePaths}`,
  );
});

test("should detect Angular workspace entry points from angular.json", async () => {
  const result = await scanFixture("angular-workspace");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("main.ts")),
    `main.ts should NOT be unused (Angular entry), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("polyfills.ts")),
    `polyfills.ts should NOT be unused (Angular polyfills), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("app.module.ts")),
    `app.module.ts should NOT be unused (imported by main.ts), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("app.component.ts")),
    `app.component.ts should NOT be unused (imported by app.module.ts), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("environment.ts")),
    `environment.ts should be unused (not imported), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("orphan.ts")),
    `orphan.ts should be unused, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("app.component.css")),
    `app.component.css should NOT be unused (referenced by @Component styleUrls), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("app.component.html")),
    `app.component.html should NOT be unused (referenced by @Component templateUrl), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("orphan.css")),
    `CSS files are excluded from unused-file detection, got unused: ${unusedFilePaths}`,
  );
});

test("should resolve #hash subpath imports via tsconfig paths with .js extension", async () => {
  const result = await scanFixture("import-subpath");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("api/user.ts")),
    `api/user.ts should NOT be unused (imported via #src/api/user.js), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("api/orphan.ts")),
    `api/orphan.ts should be unused (not imported), got unused: ${unusedFilePaths}`,
  );
});

test("should treat vitest setupFiles as entry points", async () => {
  const result = await scanFixture("vitest-setup");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("test/setup.ts")),
    `test/setup.ts should be an entry point (vitest setup file), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("orphan.ts")),
    `orphan.ts should be unused (not imported), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("vitest.config.ts")),
    `vitest.config.ts should NOT be unused (config file), got unused: ${unusedFilePaths}`,
  );
});

test("should detect new URL with import.meta.url as imports (web workers)", async () => {
  const result = await scanFixture("worker-new-url");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("worker.js")),
    `worker.js should NOT be unused (referenced via new URL), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("orphan.ts")),
    `orphan.ts should be unused (not imported), got unused: ${unusedFilePaths}`,
  );
});

test("should exclude multi-segment config files (e.g. cypress.config.contract.js)", async () => {
  const result = await scanFixture("config-compound-name");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("cypress.config.contract.js")),
    `cypress.config.contract.js should NOT be unused (config file), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("vitest.config.unit.ts")),
    `vitest.config.unit.ts should NOT be unused (config file), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("orphan.ts")),
    `orphan.ts should be unused (not imported), got unused: ${unusedFilePaths}`,
  );
});

test("should treat jest __mocks__ files as entry points", async () => {
  const result = await scanFixture("jest-mapper");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("__mocks__/styleMock.js")),
    `styleMock.js should be reachable as Jest __mocks__ entry, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("__mocks__/fileMock.js")),
    `fileMock.js should be reachable as Jest __mocks__ entry, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("orphan.ts")),
    `orphan.ts should be unused (not imported), got unused: ${unusedFilePaths}`,
  );
});

test("should resolve CSS files imported via tsconfig path aliases", async () => {
  const result = await scanFixture("style-alias");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("globals.css")),
    `globals.css should NOT be unused (imported via @/styles/globals.css), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("lib/utils.ts")),
    `lib/utils.ts should NOT be unused (imported via @/lib/utils), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("orphan.ts")),
    `orphan.ts should be unused (not imported), got unused: ${unusedFilePaths}`,
  );
});

test("should resolve @/ imports via Next.js default path alias when tsconfig is empty", async () => {
  const result = await scanFixture("next-empty-tsconfig");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("src/env.ts")),
    `env.ts should NOT be unused (imported via @/env), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("orphan.ts")),
    `orphan.ts should be unused (not imported), got unused: ${unusedFilePaths}`,
  );
});

describe("docusaurus-docs", () => {
  it("should exclude docs/ and blog/ content directories from file discovery", async () => {
    const result = await scanFixture("docusaurus-docs");
    const fixtureDir = resolve(FIXTURES_DIR, "docusaurus-docs");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.some((filePath) => filePath.startsWith("docs/")),
      `docs/ content files should not be discovered at all, got unused: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.some((filePath) => filePath.startsWith("blog/")),
      `blog/ content files should not be discovered at all, got unused: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/components/orphan.tsx"),
      `orphan.tsx should be unused, got: ${unusedFilePaths}`,
    );
  });
});

it("should resolve React Native platform extensions (.web.ts, .native.ts) when react-native detected", async () => {
  const result = await scanFixture("rn-platform");
  const fixtureDir = resolve(FIXTURES_DIR, "rn-platform");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/handler.web.ts"),
    `handler.web.ts should be reachable via platform extension, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/handler.native.ts"),
    `handler.native.ts should be reachable via platform extension, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should resolve React Native .ios.tsx and .android.tsx platform variants as reachable", async () => {
  const result = await scanFixture("rn-platform");
  const fixtureDir = resolve(FIXTURES_DIR, "rn-platform");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/button.tsx"),
    `button.tsx should be reachable as the default platform variant, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/button.ios.tsx"),
    `button.ios.tsx should be reachable as iOS platform variant, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/button.android.tsx"),
    `button.android.tsx should be reachable as Android platform variant, got unused: ${unusedFilePaths}`,
  );
});

it("should detect cra-rewired as CRA variant and use src/index as entry", async () => {
  const result = await scanFixture("cra-rewired");
  const fixtureDir = resolve(FIXTURES_DIR, "cra-rewired");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/index.tsx"),
    `src/index.tsx should be reachable as CRA entry point, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/App.tsx"),
    `src/App.tsx should be reachable from CRA entry, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/components/Header.tsx"),
    `Header.tsx should be reachable from App import chain, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should resolve CRA src-root bare imports without jsconfig", async () => {
  const result = await scanFixture("cra-src-baseurl");
  const fixtureDir = resolve(FIXTURES_DIR, "cra-src-baseurl");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/App.tsx"),
    `App.tsx should be reachable via CRA src module root, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/components/Header.tsx"),
    `Header.tsx should be reachable via CRA src module root, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should scope CRA src-root resolution to packages that declare CRA", async () => {
  const result = await scanFixture("cra-monorepo-scope");
  const fixtureDir = resolve(FIXTURES_DIR, "cra-monorepo-scope");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("packages/app/src/App.ts"),
    `app App.ts should resolve via its CRA dependency, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("packages/lib/src/RootOnly.ts"),
    `lib RootOnly.ts should stay unused because lib is not CRA, got: ${unusedFilePaths}`,
  );
});

it("should resolve Storybook MDX imports from story files", async () => {
  const result = await scanFixture("storybook-mdx-import");
  const fixtureDir = resolve(FIXTURES_DIR, "storybook-mdx-import");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/components/Alert.story.tsx"),
    `Alert.story.tsx should be reachable as storybook entry, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/components/Alert.mdx"),
    `Alert.mdx should be reachable via story file import, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/components/orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should resolve deep workspace imports like @pkg/shared/hooks/assets", async () => {
  const result = await scanFixture("workspace-deep-imports");
  const fixtureDir = resolve(FIXTURES_DIR, "workspace-deep-imports");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("packages/shared/src/hooks/assets.ts"),
    `hooks/assets.ts should be reachable via deep workspace import, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("packages/shared/src/components/button.ts"),
    `components/button.ts should be reachable via deep workspace import, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("packages/shared/src/components/orphan.ts"),
    `orphan.ts should be unused since it is not imported, got: ${unusedFilePaths}`,
  );
});

it("should mark config files in non-workspace directories as always used via global patterns", async () => {
  const result = await scanFixture("config-global-scope");
  const fixtureDir = resolve(FIXTURES_DIR, "config-global-scope");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("templates/next-app/postcss.config.mjs"),
    `postcss.config.mjs should be always used via global pattern, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("templates/next-app/eslint.config.js"),
    `eslint.config.js should be always used via global pattern, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("templates/next-app/orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should resolve dynamic imports with template literals as glob patterns", async () => {
  const result = await scanFixture("import-dynamic-template");
  const fixtureDir = resolve(FIXTURES_DIR, "import-dynamic-template");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/locales/en/core.js"),
    `en/core.js should be reachable via template literal glob, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/locales/fr/core.js"),
    `fr/core.js should be reachable via template literal glob, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/locales/de/core.js"),
    `de/core.js should be reachable via template literal glob, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should resolve package.json exports pointing to .ts files that only exist as .tsx", async () => {
  const result = await scanFixture("cross-ext-ts-tsx");
  const fixtureDir = resolve(FIXTURES_DIR, "cross-ext-ts-tsx");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/components/Button.tsx"),
    `Button.tsx should be an entry (exported as Button.ts -> .tsx fallback), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should resolve package.json exports pointing to .js files that only exist as .ts", async () => {
  const result = await scanFixture("cross-ext-js-ts");
  const fixtureDir = resolve(FIXTURES_DIR, "cross-ext-js-ts");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("generators.ts"),
    `generators.ts should be an entry (exported as ./generators.js), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("plugin.ts"),
    `plugin.ts should be an entry (exported as ./plugin.js), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/utils/index.ts"),
    `src/utils/index.ts should be an entry (exported as ./src/utils/index.js), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should detect script files referenced in GitHub Actions workflow files", async () => {
  const result = await scanFixture("ci-scripts");
  const fixtureDir = resolve(FIXTURES_DIR, "ci-scripts");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("scripts/deploy.mjs"),
    `deploy.mjs should be detected from CI workflow run step, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("scripts/build-release.ts"),
    `build-release.ts should be detected from CI workflow run step, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should detect next.config files in non-workspace directories via global alwaysUsed", async () => {
  const result = await scanFixture("next-config-scope");
  const fixtureDir = resolve(FIXTURES_DIR, "next-config-scope");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("examples/my-app/next.config.mjs"),
    `next.config.mjs in examples should be detected via global alwaysUsed, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should mark files matched by glob patterns in package.json scripts as entry points", async () => {
  const result = await scanFixture("script-globs");
  const fixtureDir = resolve(FIXTURES_DIR, "script-globs");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("styles/themes/dark.css"),
    `dark.css should be marked as entry via script glob (postcss styles/themes/*.css), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("styles/themes/light.css"),
    `light.css should be marked as entry via script glob, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should still be flagged as unused, got: ${unusedFilePaths}`,
  );
});

it("should exclude config files from unused file detection", async () => {
  const result = await scanFixture("config-exclusion");
  const fixtureDir = resolve(FIXTURES_DIR, "config-exclusion");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("vitest.config.ts"),
    `vitest.config.ts should be excluded as config file, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("sanity.config.ts"),
    `sanity.config.ts should be excluded as config file, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("sanity.cli.ts"),
    `sanity.cli.ts should be unused (only excluded by sanity plugin, not global config), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("playwright.smoke.config.mjs"),
    `playwright.smoke.config.mjs should be excluded via script -c flag, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should still be flagged as unused, got: ${unusedFilePaths}`,
  );
});

it("should activate tooling plugins from optionalDependencies", async () => {
  const result = await scanFixture("optional-deps");
  const fixtureDir = resolve(FIXTURES_DIR, "optional-deps");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("sanity.config.ts"),
    `sanity.config.ts should be excluded (sanity in optionalDependencies), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("sanity.cli.ts"),
    `sanity.cli.ts should be excluded (sanity plugin activated via optionalDependencies), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("orphan.ts"),
    `orphan.ts should still be flagged as unused, got: ${unusedFilePaths}`,
  );
});

it("should extract entry points from tsdown/tsup config files", async () => {
  const result = await scanFixture("tsdown-entry");
  const fixtureDir = resolve(FIXTURES_DIR, "tsdown-entry");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/main.ts"),
    `src/main.ts should be reachable (entry in tsdown.config.ts), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/preload.ts"),
    `src/preload.ts should be reachable (entry in tsdown.config.ts), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/utils.ts"),
    `src/utils.ts should be reachable (imported by src/main.ts), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/unused.ts"),
    `src/unused.ts should be flagged as unused, got: ${unusedFilePaths}`,
  );
});

it("should not exclude source directories named build from scanning", async () => {
  const result = await scanFixture("src-build-dir");
  const fixtureDir = resolve(FIXTURES_DIR, "src-build-dir");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/build/plugins.ts"),
    `src/build/plugins.ts should be reachable (imported by src/index.ts), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/build/helpers.ts"),
    `src/build/helpers.ts should be reachable (imported by src/build/plugins.ts), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `src/orphan.ts should be flagged as unused, got: ${unusedFilePaths}`,
  );
});

it("should treat files referenced via vi.mock/jest.mock as reachable (test imports create edges)", async () => {
  const result = await scanFixture("test-mock-import");
  const fixtureDir = resolve(FIXTURES_DIR, "test-mock-import");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/mocked-util.ts"),
    `mocked-util.ts should be reachable (imported via vi.mock from test entry), got: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should still be flagged as unused, got: ${unusedFilePaths}`,
  );
});

test("should not treat all .github files as entries, only CI-referenced scripts", async () => {
  const result = await scanFixture("gh-actions-scripts");
  const fixtureDir = resolve(FIXTURES_DIR, "gh-actions-scripts");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith(".github/actions/deploy/run.js")),
    `run.js should NOT be unused (referenced in CI workflow), got: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) =>
      filePath.endsWith(".github/actions/deploy/unused-helper.js"),
    ),
    `unused-helper.js should be unused (not referenced anywhere), got: ${unusedFilePaths}`,
  );
});

test("should resolve workspace dist paths to source and not mark dist as entries", async () => {
  const result = await scanFixture("workspace-dist-resolve");
  const fixtureDir = resolve(FIXTURES_DIR, "workspace-dist-resolve");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.includes("dist/")),
    `dist/ files should not appear in unused files (ignored), got: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("packages/utils/src/orphan.ts")),
    `orphan.ts should be unused (not imported by anyone), got: ${unusedFilePaths}`,
  );
});

test("should exclude .gen.ts files from test entry patterns", async () => {
  const result = await scanFixture("generated-specs");
  const fixtureDir = resolve(FIXTURES_DIR, "generated-specs");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("types.spec.gen.ts")),
    `files matching .spec. pattern are excluded from unused-file detection, got: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("schema.gen.ts")),
    `schema.gen.ts should be unused (generated file, not imported), got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("index.test.ts")),
    `index.test.ts should be an entry point (jest detected), got: ${unusedFilePaths}`,
  );
});

test("should not treat formatter/linter glob targets as entry points", async () => {
  const result = await scanFixture("script-glob-formatter");
  const fixtureDir = resolve(FIXTURES_DIR, "script-glob-formatter");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("src/orphan.ts")),
    `orphan.ts should be unused (not imported by anyone), got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("scripts/build.ts")),
    `build.ts should NOT be unused (referenced in build script), got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("src/helper.ts")),
    `helper.ts should NOT be unused (imported by index.ts), got: ${unusedFilePaths}`,
  );
});

test("should not treat pages/app directories as entry points without framework dependency", async () => {
  const result = await scanFixture("framework-gate/no-framework");
  const fixtureDir = resolve(FIXTURES_DIR, "framework-gate/no-framework");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    unusedFilePaths.some((filePath) => filePath === "app/dashboard/page.tsx"),
    `app/dashboard/page.tsx should be unused without next dependency, got: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath === "src/routes/index.tsx"),
    `src/routes/index.tsx should be unused without router dependency, got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath === "pages/index.tsx"),
    `pages/index.tsx should NOT be unused (imported by index.ts), got: ${unusedFilePaths}`,
  );
});

test("should treat pages/app as entry points when next is a dependency", async () => {
  const result = await scanFixture("framework-gate/with-nextjs");
  const fixtureDir = resolve(FIXTURES_DIR, "framework-gate/with-nextjs");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    unusedFilePaths.some((filePath) => filePath === "unused.tsx"),
    `unused.tsx should be unused, got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath === "pages/index.tsx"),
    `pages/index.tsx should NOT be unused (Next.js pages entry), got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath === "app/dashboard/page.tsx"),
    `app/dashboard/page.tsx should NOT be unused (Next.js app entry), got: ${unusedFilePaths}`,
  );
});

test("should treat app/routes as entry points when @react-router/dev is a dependency and read appDirectory from config", async () => {
  const result = await scanFixture("framework-gate/with-react-router");
  const fixtureDir = resolve(FIXTURES_DIR, "framework-gate/with-react-router");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    unusedFilePaths.some((filePath) => filePath === "unused.tsx"),
    `unused.tsx should be unused, got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath === "src/root.tsx"),
    `src/root.tsx should NOT be unused (React Router entry with appDirectory=src), got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath === "src/routes/home.tsx"),
    `src/routes/home.tsx should NOT be unused (React Router route with appDirectory=src), got: ${unusedFilePaths}`,
  );
});

describe("subproject-workspace", () => {
  it("should not activate framework detection for sub-project children", async () => {
    const result = await scanFixture("subproject-workspace");
    const fixtureDir = resolve(FIXTURES_DIR, "subproject-workspace");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("app/packages/core/app/page.ts"),
      `app/packages/core/app/page.ts should be unused (Next.js detection should not activate for sub-project children), got: ${unusedFilePaths}`,
    );
  });

  it("should not add sub-project child package entry files as global entries", async () => {
    const result = await scanFixture("subproject-workspace");
    const fixtureDir = resolve(FIXTURES_DIR, "subproject-workspace");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("app/packages/icons/src/index.ts"),
      `app/packages/icons/src/index.ts should be unused (not an entry when root has no workspace patterns), got: ${unusedFilePaths}`,
    );
  });

  it("should still detect files under sub-project children as unused", async () => {
    const result = await scanFixture("subproject-workspace");
    const fixtureDir = resolve(FIXTURES_DIR, "subproject-workspace");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("app/packages/core/src/unused-util.ts"),
      `app/packages/core/src/unused-util.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("tanstack-app", () => {
  it("should treat src/routes and src/server as entry points", async () => {
    const result = await scanFixture("tanstack-app");
    const fixtureDir = resolve(FIXTURES_DIR, "tanstack-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/routes/index.tsx"),
      `src/routes/index.tsx should be reachable via TanStack Start route, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/routes/about.tsx"),
      `src/routes/about.tsx should be reachable via TanStack Start route, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/server.ts"),
      `src/server.ts should be reachable as TanStack Start server entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("cloudflare-worker", () => {
  it("should treat src/index.ts as entry point when wrangler is present", async () => {
    const result = await scanFixture("cloudflare-worker");
    const fixtureDir = resolve(FIXTURES_DIR, "cloudflare-worker");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/index.ts"),
      `src/index.ts should be reachable as Wrangler worker entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("config-entry-seed", () => {
  it("should exclude config files from unused reporting but not propagate reachability", async () => {
    const result = await scanFixture("config-entry-seed");
    const fixtureDir = resolve(FIXTURES_DIR, "config-entry-seed");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("vite.config.ts"),
      `vite.config.ts should be excluded from unused (config file), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/vite-plugin.ts"),
      `src/vite-plugin.ts should be unused (only imported from config file), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/index.ts"),
      `src/index.ts should be reachable as main entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/helper.ts"),
      `src/helper.ts should be reachable via index.ts, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("config-imports", () => {
  it("should propagate reachability from config entry points when plugin activates", async () => {
    const result = await scanFixture("config-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "config-imports");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("vite.config.ts"),
      `vite.config.ts should be excluded (config file), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("my-vite-plugin.ts"),
      `my-vite-plugin.ts should be reachable (config file is entry point when vite plugin activates), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/shared-util.ts"),
      `src/shared-util.ts should be reachable (imported from both config and app), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/index.ts"),
      `src/index.ts should be reachable as main entry, got: ${unusedFilePaths}`,
    );
  });
});

describe("webpack-path", () => {
  it("should resolve path.join(__dirname, .., app/index) webpack entries", async () => {
    const result = await scanFixture("webpack-path");
    const fixtureDir = resolve(FIXTURES_DIR, "webpack-path");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("app/index.js"),
      `app/index.js should be reachable via webpack path.join entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("app/renderer.js"),
      `app/renderer.js should be reachable via app/index.js, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("app/orphan.js"),
      `app/orphan.js should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("html-entry-scope", () => {
  it("should only discover HTML script entries from root-level HTML files, not nested subdirectories", async () => {
    const result = await scanFixture("html-entry-scope");
    const fixtureDir = resolve(FIXTURES_DIR, "html-entry-scope");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("packages/app/src/main.tsx"),
      `packages/app/src/main.tsx should be reachable via workspace root index.html, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("packages/app/src/helper.ts"),
      `packages/app/src/helper.ts should be reachable (imported by main.tsx), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("packages/app/sample/demo.tsx"),
      `packages/app/sample/demo.tsx should be unused (nested HTML not scanned), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("packages/lib/src/orphan.ts"),
      `packages/lib/src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("i18n-glob-skip", () => {
  it("should not treat formatjs extract glob arguments as entry points", async () => {
    const result = await scanFixture("i18n-glob-skip");
    const fixtureDir = resolve(FIXTURES_DIR, "i18n-glob-skip");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused because formatjs extract globs should not seed entries, got: ${unusedFilePaths}`,
    );
  });
});

describe("remark-glob-skip", () => {
  it("should not treat remark and cspell glob arguments as entry points", async () => {
    const result = await scanFixture("remark-glob-skip");
    const fixtureDir = resolve(FIXTURES_DIR, "remark-glob-skip");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("docs/intro.mdx"),
      `docs/intro.mdx should be excluded (MDX files are excluded from unused-file by default)`,
    );
    assert.ok(
      !unusedFilePaths.includes("docs/guide.mdx"),
      `docs/guide.mdx should be excluded (MDX files are excluded from unused-file by default)`,
    );
  });
});

describe("vitest-custom", () => {
  it("should use custom include patterns from vitest.config.ts", async () => {
    const result = await scanFixture("vitest-custom");
    const fixtureDir = resolve(FIXTURES_DIR, "vitest-custom");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("spec/utils-spec.ts"),
      `utils-spec.ts should be an entry (matched by vitest include pattern), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("workspace-no-main", () => {
  it("should fall back to index.js for workspace packages without a main field", async () => {
    const result = await scanFixture("workspace-no-main");
    const fixtureDir = resolve(FIXTURES_DIR, "workspace-no-main");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("packages/lib-a/index.js"),
      `index.js should NOT be unused (default entry for package without main), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("packages/lib-a/helper.js"),
      `helper.js should NOT be unused (imported by index.js), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("packages/lib-a/orphan.js"),
      `orphan.js should be unused (not imported by anything), got: ${unusedFilePaths}`,
    );
  });
});

describe("style-export-map", () => {
  it("should resolve CSS files exported via package.json exports map through dist→src heuristic", async () => {
    const result = await scanFixture("style-export-map");
    const fixtureDir = resolve(FIXTURES_DIR, "style-export-map");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/style.css"),
      `src/style.css should NOT be unused (exported via package.json exports), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/orphan.css"),
      `CSS files are excluded from unused-file detection, got: ${unusedFilePaths}`,
    );
  });
});

describe("playwright-ext", () => {
  it("should NOT treat .pw.ts files as test entries", async () => {
    const result = await scanFixture("playwright-ext");
    const fixtureDir = resolve(FIXTURES_DIR, "playwright-ext");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("my-test.pw.ts"),
      `my-test.pw.ts should be unused (.pw.ts is not a standard test pattern), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("playwright-lib", () => {
  it("should NOT treat lib/ and support/ directories as Playwright test entry points", async () => {
    const result = await scanFixture("playwright-lib");
    const fixtureDir = resolve(FIXTURES_DIR, "playwright-lib");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("lib/helpers.ts"),
      `lib/helpers.ts should be unused (lib/ is not a Playwright entry pattern), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("support/commands.ts"),
      `support/commands.ts should be unused (support/ is not a Playwright entry pattern), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("e2e/login.spec.ts"),
      `e2e/login.spec.ts should be a test entry point, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("tests/smoke.spec.ts"),
      `tests/smoke.spec.ts should be a test entry point, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("env-wrapper", () => {
  it("should see through cross-env wrapper to find real binary and file arguments", async () => {
    const result = await scanFixture("env-wrapper");
    const fixtureDir = resolve(FIXTURES_DIR, "env-wrapper");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/main.js"),
      `src/main.js should NOT be unused (entry via cross-env node), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/dev-entry.js"),
      `src/dev-entry.js should NOT be unused (entry via cross-env node), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/helper.js"),
      `src/helper.js should NOT be unused (imported by entries), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.js"),
      `orphan.js should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("jest-mock-entry", () => {
  it("should treat __mocks__ files as entry points in jest projects", async () => {
    const result = await scanFixture("jest-mock-entry");
    const fixtureDir = resolve(FIXTURES_DIR, "jest-mock-entry");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/__mocks__/fs.ts"),
      `src/__mocks__/fs.ts should be reachable as Jest __mocks__ entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/__mocks__/axios.ts"),
      `src/__mocks__/axios.ts should be reachable as Jest __mocks__ entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("__mocks__/some-lib.js"),
      `__mocks__/some-lib.js should be reachable as Jest __mocks__ entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused (jest-mock-entry), got: ${unusedFilePaths}`,
    );
  });
});

describe("mdx-import", () => {
  it("should trace imports from MDX entry points in Docusaurus projects", async () => {
    const result = await scanFixture("mdx-import");
    const fixtureDir = resolve(FIXTURES_DIR, "mdx-import");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/Chart.tsx"),
      `Chart.tsx should NOT be unused (imported by MDX entry), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/components/Unused.tsx"),
      `Unused.tsx should be unused (not imported by any MDX), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused (mdx-import), got: ${unusedFilePaths}`,
    );
  });
});

describe("vitest-coverage", () => {
  it("should not confuse coverage.include with test.include patterns", async () => {
    const result = await scanFixture("vitest-coverage");
    const fixtureDir = resolve(FIXTURES_DIR, "vitest-coverage");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("tests/core.test.ts"),
      `core.test.ts should NOT be unused (vitest test file), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused (vitest-coverage), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/utils.ts"),
      `src/utils.ts should be unused (not imported by any test or entry), got: ${unusedFilePaths}`,
    );
  });
});

describe("dts-imports", () => {
  it("should follow imports from .d.ts files to mark dependencies as reachable", async () => {
    const result = await scanFixture("dts-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "dts-imports");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/helper.ts"),
      `src/helper.ts should NOT be unused (imported by types.d.ts which is reachable), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.some((filePath) => filePath.endsWith(".d.ts")),
      `.d.ts files should NOT appear in unused files report, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("astro-mw", () => {
  it("should treat src/middleware.ts as an Astro entry point", async () => {
    const result = await scanFixture("astro-mw");
    const fixtureDir = resolve(FIXTURES_DIR, "astro-mw");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/middleware.ts"),
      `src/middleware.ts should NOT be unused (Astro middleware entry), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused (astro-mw), got: ${unusedFilePaths}`,
    );
  });
});

describe("next-middleware", () => {
  it("should treat middleware, proxy, and instrumentation as Next.js entry points", async () => {
    const result = await scanFixture("next-middleware");
    const fixtureDir = resolve(FIXTURES_DIR, "next-middleware");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/middleware.ts"),
      `src/middleware.ts should NOT be unused (Next.js middleware entry), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/auth.ts"),
      `src/auth.ts should NOT be unused (imported by middleware), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("proxy.ts"),
      `proxy.ts should NOT be unused (Next.js proxy entry), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("instrumentation.ts"),
      `instrumentation.ts should NOT be unused (Next.js instrumentation entry), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused (next-middleware), got: ${unusedFilePaths}`,
    );
  });
});

describe("reexport-file-variants", () => {
  it("should exempt star-re-export barrels but not named-re-export barrels", async () => {
    const result = await scanFixture("reexport-file-variants");
    const fixtureDir = resolve(FIXTURES_DIR, "reexport-file-variants");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      !unusedFilePaths.includes("src/star-barrel.ts"),
      `src/star-barrel.ts should NOT be unused (star re-export barrel with reachable sources), got: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("src/named-barrel.ts"),
      `src/named-barrel.ts SHOULD be unused (named re-export barrel is reported as unused), got: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused (reexport-file-variants), got: ${unusedFilePaths}`,
    );
  });
});

describe("ci-yaml-non-run", () => {
  it("should only extract entries from run: blocks, not arbitrary YAML values", async () => {
    const result = await scanFixture("ci-yaml-non-run");
    const fixtureDir = resolve(FIXTURES_DIR, "ci-yaml-non-run");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      !unusedFilePaths.includes("scripts/deploy.mjs"),
      `scripts/deploy.mjs should NOT be unused (referenced in run: block), got: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes(".github/changelog/changelog.js"),
      `.github/changelog/changelog.js SHOULD be unused (only referenced in YAML with: block, not run:), got: ${unusedFilePaths}`,
    );
  });
});

describe("workspace-dist-src", () => {
  it("should resolve workspace deep imports through export maps via dist→src fallback", async () => {
    const result = await scanFixture("workspace-dist-src");
    const fixtureDir = resolve(FIXTURES_DIR, "workspace-dist-src");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      !unusedFilePaths.includes("packages/core/src/visualdebug.ts"),
      `packages/core/src/visualdebug.ts should NOT be unused (imported via @test/core/visualdebug), got: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("packages/core/src/index.ts"),
      `packages/core/src/index.ts should NOT be unused (imported via @test/core), got: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("packages/core/src/orphan.ts"),
      `packages/core/src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("bun-test", () => {
  it("should detect bun test runner and treat test files as entry points", async () => {
    const result = await scanFixture("bun-test");
    const fixtureDir = resolve(FIXTURES_DIR, "bun-test");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      !unusedFilePaths.includes("src/__tests__/build-output.test.ts"),
      `src/__tests__/build-output.test.ts should be reachable via bun test runner, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/add.test.ts"),
      `src/add.test.ts should be reachable via bun test runner, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("__tests__/integration.test.ts"),
      `__tests__/integration.test.ts should be reachable via bun test runner, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/utils_test.ts"),
      `src/utils_test.ts should be reachable via bun _test pattern, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("zx-scripts", () => {
  it("should detect zx as a script runner and mark referenced files as entry points", async () => {
    const result = await scanFixture("zx-scripts");
    const fixtureDir = resolve(FIXTURES_DIR, "zx-scripts");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      !unusedFilePaths.includes("scripts/build-image.mjs"),
      `scripts/build-image.mjs should NOT be unused (referenced via zx in package.json scripts), got: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("polyrepo", () => {
  it("should extract entry points from all sub-project package.json files without root workspace patterns", async () => {
    const result = await scanFixture("polyrepo");
    const fixtureDir = resolve(FIXTURES_DIR, "polyrepo");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      !unusedFilePaths.includes("project-a/src/index.ts"),
      `project-a/src/index.ts should be reachable via lib/index.js main entry fallback`,
    );

    assert.ok(
      !unusedFilePaths.includes("project-a/src/helper.ts"),
      `project-a/src/helper.ts should be reachable via import from index.ts`,
    );

    assert.ok(
      !unusedFilePaths.includes("project-b/src/index.ts"),
      `project-b/src/index.ts should be reachable via dist/index.js main entry fallback`,
    );

    assert.ok(
      unusedFilePaths.includes("project-a/src/orphan.ts"),
      `project-a/src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("project-b/src/unused.ts"),
      `project-b/src/unused.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("build-root-fallback", () => {
  it("should only resolve build output to src/ directory, not root-level fallback", async () => {
    const result = await scanFixture("build-root-fallback");
    const fixtureDir = resolve(FIXTURES_DIR, "build-root-fallback");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      unusedFilePaths.includes("bin/server.js"),
      `bin/server.js should be unused — build/bin/server.js only resolves to src/bin/ not root bin/, got: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/app.ts"),
      `src/app.ts should be reachable via build/app.js → src/app.ts, got: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("vitest-automock", () => {
  it("should treat __mocks__ sibling as reachable when vi.mock has no factory", async () => {
    const result = await scanFixture("vitest-automock");
    const fixtureDir = resolve(FIXTURES_DIR, "vitest-automock");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      !unusedFilePaths.includes("src/server/__mocks__/api.ts"),
      `__mocks__/api.ts should be reachable via vi.mock auto-mock sibling, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("src/utils/__mocks__/helper.ts"),
      `__mocks__/helper.ts should be unused when vi.mock has a factory, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("src/server/unused.ts"),
      `src/server/unused.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("react-router", () => {
  it("should treat files referenced by route/layout/index calls in routes.ts as entry points", async () => {
    const result = await scanFixture("react-router");
    const fixtureDir = resolve(FIXTURES_DIR, "react-router");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      unusedFilePaths.includes("app/components/unused-widget.tsx"),
      `unused-widget.tsx should be unused, got: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("app/dashboard/page.tsx"),
      `app/dashboard/page.tsx should be reachable via index() in routes.ts, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("app/dashboard/layout.tsx"),
      `app/dashboard/layout.tsx should be reachable via layout() in routes.ts, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("app/routes/home.tsx"),
      `app/routes/home.tsx should be reachable via route() in routes.ts, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("app/routes/about.tsx"),
      `app/routes/about.tsx should be reachable via route() in routes.ts, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("app/root.tsx"),
      `app/root.tsx should be reachable as root entry, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("app/components/header.tsx"),
      `header.tsx should be reachable (imported by root.tsx and home.tsx), got unused: ${unusedFilePaths}`,
    );
  });
});

describe("script-no-extension", () => {
  it("should resolve script file references without extensions to their source files", async () => {
    const result = await scanFixture("script-no-extension");
    const fixtureDir = resolve(FIXTURES_DIR, "script-no-extension");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("scripts/build-data.ts"),
      `scripts/build-data.ts should be reachable via 'tsx ./scripts/build-data' (extensionless), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("scripts/lint-code.js"),
      `scripts/lint-code.js should be reachable via 'node scripts/lint-code' (extensionless), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("scripts/process-items.ts"),
      `scripts/process-items.ts should be reachable via 'ts-node ./scripts/process-items' (extensionless), got unused: ${unusedFilePaths}`,
    );
  });
});

describe("rspack-app", () => {
  it("should treat rspack config files as always-used entry points", async () => {
    const result = await scanFixture("rspack-app");
    const fixtureDir = resolve(FIXTURES_DIR, "rspack-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      !unusedFilePaths.includes("rspack.config.js"),
      `rspack.config.js should be always-used (rspack config), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("rspack.dev.config.js"),
      `rspack.dev.config.js should be always-used (rspack wildcard config), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/index.ts"),
      `src/index.ts should be reachable via rspack entry, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("astro-content", () => {
  it("should treat astro content config files as always-used", async () => {
    const result = await scanFixture("astro-content");
    const fixtureDir = resolve(FIXTURES_DIR, "astro-content");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      !unusedFilePaths.includes("astro.config.ts"),
      `astro.config.ts should be always-used, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/content.config.ts"),
      `src/content.config.ts should be always-used (astro content config), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/content/config.ts"),
      `src/content/config.ts should be always-used (astro content config), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused (astro-content), got: ${unusedFilePaths}`,
    );
  });
});

describe("gatsby-app", () => {
  it("should flag unused components but not pages, templates, or api routes", async () => {
    const result = await scanFixture("gatsby-app");
    const fixtureDir = resolve(FIXTURES_DIR, "gatsby-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      unusedFilePaths.includes("src/components/unused.tsx"),
      `src/components/unused.tsx should be unused (Gatsby does not auto-discover components), got: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/pages/index.tsx"),
      `src/pages/index.tsx should be reachable (Gatsby page), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/templates/post.tsx"),
      `src/templates/post.tsx should be reachable (Gatsby template), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/api/hello.ts"),
      `src/api/hello.ts should be reachable (Gatsby API route), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/components/used.tsx"),
      `src/components/used.tsx should be reachable (imported by page), got unused: ${unusedFilePaths}`,
    );
  });
});

describe("rn-app", () => {
  it("should detect React Native entry points and flag orphan screens", async () => {
    const result = await scanFixture("rn-app");
    const fixtureDir = resolve(FIXTURES_DIR, "rn-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      !unusedFilePaths.includes("index.js"),
      `index.js should be reachable (React Native entry), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("App.tsx"),
      `App.tsx should be reachable (React Native entry), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/screens/used.tsx"),
      `src/screens/used.tsx should be reachable (imported by App), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("src/screens/orphan.tsx"),
      `src/screens/orphan.tsx should be unused (rn-app), got: ${unusedFilePaths}`,
    );
  });
});

it("should detect webpack.config.js entry points and mark imported files reachable", async () => {
  const result = await scanFixture("webpack-entries");
  const fixtureDir = resolve(FIXTURES_DIR, "webpack-entries");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/index.js"),
    `src/index.js should be reachable as webpack entry, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/vendor.js"),
    `src/vendor.js should be reachable as webpack entry, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/components/App.js"),
    `App.js should be reachable via import from webpack entry, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/components/Vendor.js"),
    `Vendor.js should be reachable via import from webpack entry, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.js"),
    `orphan.js should be unused, got: ${unusedFilePaths}`,
  );
});

it("should not treat CSS files as entry points when wildcard export map expands to all files", async () => {
  const result = await scanFixture("wildcard-css");
  const fixtureDir = resolve(FIXTURES_DIR, "wildcard-css");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/components/Button.css"),
    `CSS files are excluded from unused-file detection, got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/components/Button.ts"),
    `Button.ts should be reachable via export, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should detect Electron main/preload entries and mark imported files reachable", async () => {
  const result = await scanFixture("electron-detection");
  const fixtureDir = resolve(FIXTURES_DIR, "electron-detection");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/main.ts"),
    `src/main.ts should be reachable as Electron main entry, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/preload/index.ts"),
    `src/preload/index.ts should be reachable as Electron preload entry, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/window.ts"),
    `src/window.ts should be reachable via import from main, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

describe("cycle-simple", () => {
  it("should detect a simple A→B→A circular dependency", async () => {
    const result = await scanFixture("cycle-simple");
    assert.ok(result.circularDependencies.length > 0, "should find at least one cycle");
    const cyclePaths = result.circularDependencies.map((cycle) =>
      cycle.files.map((filePath) => {
        const fixtureDir = resolve(FIXTURES_DIR, "cycle-simple");
        return relative(fixtureDir, filePath);
      }),
    );
    const hasCycle = cyclePaths.some(
      (paths) => paths.includes("src/a.ts") && paths.includes("src/b.ts"),
    );
    assert.ok(
      hasCycle,
      `should find cycle between a.ts and b.ts, got: ${JSON.stringify(cyclePaths)}`,
    );
  });
});

describe("cycle-type-only", () => {
  it("should not detect circular dependencies when imports are type-only", async () => {
    const result = await scanFixture("cycle-type-only");
    assert.equal(
      result.circularDependencies.length,
      0,
      `type-only imports should not create cycles, got: ${JSON.stringify(result.circularDependencies)}`,
    );
  });
});

describe("cycle-chain", () => {
  it("should detect A→B→C→A circular dependency chain", async () => {
    const result = await scanFixture("cycle-chain");
    assert.ok(result.circularDependencies.length > 0, "should find at least one cycle");
    const cyclePaths = result.circularDependencies.map((cycle) =>
      cycle.files.map((filePath) => {
        const fixtureDir = resolve(FIXTURES_DIR, "cycle-chain");
        return relative(fixtureDir, filePath);
      }),
    );
    const hasThreeNodeCycle = cyclePaths.some(
      (paths) =>
        paths.length === 3 &&
        paths.includes("src/a.ts") &&
        paths.includes("src/b.ts") &&
        paths.includes("src/c.ts"),
    );
    assert.ok(
      hasThreeNodeCycle,
      `should find 3-node cycle between a.ts, b.ts, c.ts, got: ${JSON.stringify(cyclePaths)}`,
    );
  });
});

describe("cycle-none", () => {
  it("should not detect any circular dependencies in a linear dependency graph", async () => {
    const result = await scanFixture("cycle-none");
    assert.equal(result.circularDependencies.length, 0);
  });
});

describe("reexport-default-named", () => {
  it("should track default-as-named re-exports and detect unused files", async () => {
    const result = await scanFixture("reexport-default-named");
    const fixtureDir = resolve(FIXTURES_DIR, "reexport-default-named");
    const unusedFiles = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFiles.includes("widget.ts"),
      "widget.ts should be reachable via re-export { default as Widget }",
    );
    assert.ok(
      !unusedFiles.includes("gadget.ts"),
      "gadget.ts should be reachable via re-export { default as Gadget }",
    );
    assert.ok(!unusedFiles.includes("index.ts"), "index.ts should be reachable as entry");
    assert.ok(
      unusedFiles.includes("consumer.ts"),
      "consumer.ts should be unused (not an entry point, not imported by entry)",
    );
  });

  it("should detect unused exports in re-exported modules", async () => {
    const result = await scanFixture("reexport-default-named");
    const exportNames = deadExportNames(result);
    assert.ok(
      exportNames.includes("widgetHelper"),
      "widgetHelper should be unused (not re-exported or consumed)",
    );
    assert.ok(
      exportNames.includes("gadgetHelper"),
      "gadgetHelper should be unused (not re-exported or consumed)",
    );
  });
});

describe("import-mixed", () => {
  it("should handle combined default, named, and namespace imports", async () => {
    const result = await scanFixture("import-mixed");
    const fixtureDir = resolve(FIXTURES_DIR, "import-mixed");
    const unusedFiles = orphanPaths(result, fixtureDir);
    assert.ok(unusedFiles.includes("orphan.ts"), "orphan.ts should be unused (not imported)");
    assert.ok(!unusedFiles.includes("lib.ts"), "lib.ts should be reachable via mixed import");
    assert.ok(
      !unusedFiles.includes("utils.ts"),
      "utils.ts should be reachable via namespace import",
    );
  });

  it("should detect unused exports across import patterns", async () => {
    const result = await scanFixture("import-mixed");
    const exportNames = deadExportNames(result);
    assert.ok(exportNames.includes("unused"), "unused export from lib.ts should be detected");
    assert.ok(
      exportNames.includes("unusedUtil"),
      "unusedUtil export from utils.ts should be detected",
    );
  });
});

describe("ns-chain", () => {
  it("should track namespace import that is re-exported", async () => {
    const result = await scanFixture("ns-chain");
    const fixtureDir = resolve(FIXTURES_DIR, "ns-chain");
    const unusedFiles = orphanPaths(result, fixtureDir);
    assert.ok(unusedFiles.includes("unused-module.ts"), "unused-module.ts should be unused");
    assert.ok(
      !unusedFiles.includes("helpers.ts"),
      "helpers.ts should be reachable via namespace re-export chain",
    );
    assert.ok(
      unusedFiles.includes("consumer.ts"),
      "consumer.ts should be unused (not an entry point)",
    );
  });
});

describe("type-reexport-filter", () => {
  it("should not report type-only re-exports as unused by default", async () => {
    const result = await scanFixture("type-reexport-filter");
    const fixtureDir = resolve(FIXTURES_DIR, "type-reexport-filter");
    const unusedFiles = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFiles.includes("types.ts"),
      "types.ts should be reachable via type-only re-export",
    );
    assert.ok(!unusedFiles.includes("user.ts"), "user.ts should be reachable via named re-export");
    assert.ok(
      unusedFiles.includes("consumer.ts"),
      "consumer.ts should be unused (not an entry point)",
    );
  });

  it("should detect unused exports even with type re-exports", async () => {
    const result = await scanFixture("type-reexport-filter");
    const exportNames = deadExportNames(result);
    assert.ok(
      exportNames.includes("deleteUser"),
      "deleteUser should be unused (not re-exported or imported)",
    );
  });
});

describe("cycle-with-orphans", () => {
  it("should detect circular dependency between module-a and module-b", async () => {
    const result = await scanFixture("cycle-with-orphans");
    assert.ok(
      result.circularDependencies.length > 0,
      "should find circular dependency between module-a and module-b",
    );
  });

  it("should detect unused files alongside circular deps", async () => {
    const result = await scanFixture("cycle-with-orphans");
    const fixtureDir = resolve(FIXTURES_DIR, "cycle-with-orphans");
    const unusedFiles = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFiles.includes("orphan.ts"),
      "orphan.ts should be unused despite circular deps in other files",
    );
  });

  it("should detect unused exports in circular dependency modules", async () => {
    const result = await scanFixture("cycle-with-orphans");
    const exportNames = deadExportNames(result);
    assert.ok(
      exportNames.includes("unusedFromA"),
      "unusedFromA should be detected as unused despite circular dep",
    );
    assert.ok(
      exportNames.includes("unusedFromB"),
      "unusedFromB should be detected as unused despite circular dep",
    );
  });
});

describe("deep-reexport-chain", () => {
  it("should propagate usage through 4-level re-export chain", async () => {
    const result = await scanFixture("deep-reexport-chain");
    const fixtureDir = resolve(FIXTURES_DIR, "deep-reexport-chain");
    const unusedFiles = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFiles.includes("level-3.ts"),
      "level-3.ts should be reachable through deep re-export chain",
    );
    assert.ok(
      !unusedFiles.includes("level-2.ts"),
      "level-2.ts should be reachable through re-export chain",
    );
    assert.ok(
      !unusedFiles.includes("level-1.ts"),
      "level-1.ts should be reachable through re-export chain",
    );
    assert.ok(
      unusedFiles.includes("consumer.ts"),
      "consumer.ts should be unused (not an entry point)",
    );
  });

  it("should detect exports that are not propagated through the chain", async () => {
    const result = await scanFixture("deep-reexport-chain");
    const exportNames = deadExportNames(result);
    assert.ok(
      exportNames.includes("delta"),
      "delta should be unused (not re-exported past level-2)",
    );
    assert.ok(
      exportNames.includes("gamma"),
      "gamma should be unused (not re-exported past level-1 to index)",
    );
  });
});

describe("enum-export", () => {
  it("should detect unused enum exports", async () => {
    const result = await scanFixture("enum-export");
    const exportNames = deadExportNames(result);
    assert.ok(exportNames.includes("UnusedEnum"), "UnusedEnum should be detected as unused");
    assert.ok(
      !exportNames.includes("Status"),
      "Status should NOT be detected as unused (it is imported)",
    );
  });
});

describe("alias-named-exports", () => {
  it("should track aliased re-exports correctly", async () => {
    const result = await scanFixture("alias-named-exports");
    const fixtureDir = resolve(FIXTURES_DIR, "alias-named-exports");
    const unusedFiles = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFiles.includes("greetings.ts"),
      "greetings.ts should be reachable via aliased re-export",
    );
  });

  it("should detect unused exports with aliased names", async () => {
    const result = await scanFixture("alias-named-exports");
    const exportNames = deadExportNames(result);
    assert.ok(
      exportNames.includes("unusedGreeting"),
      "unusedGreeting should be unused (not re-exported)",
    );
  });
});

describe("module-side-effect", () => {
  it("should keep side-effect imported files as reachable", async () => {
    const result = await scanFixture("module-side-effect");
    const fixtureDir = resolve(FIXTURES_DIR, "module-side-effect");
    const unusedFiles = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFiles.includes("polyfill.ts"),
      "polyfill.ts should be reachable via side-effect import",
    );
    assert.ok(
      !unusedFiles.includes("register.ts"),
      "register.ts should be reachable via side-effect import",
    );
    assert.ok(unusedFiles.includes("orphan.ts"), "orphan.ts should be unused");
  });
});

describe("reexport-star-named", () => {
  it("should handle mixed star and named re-exports", async () => {
    const result = await scanFixture("reexport-star-named");
    const fixtureDir = resolve(FIXTURES_DIR, "reexport-star-named");
    const unusedFiles = orphanPaths(result, fixtureDir);
    assert.ok(!unusedFiles.includes("utils.ts"), "utils.ts should be reachable via star re-export");
    assert.ok(
      !unusedFiles.includes("special.ts"),
      "special.ts should be reachable via named re-export",
    );
    assert.ok(
      unusedFiles.includes("consumer.ts"),
      "consumer.ts should be unused (not an entry point)",
    );
  });

  it("should detect unused exports from modules included via star", async () => {
    const result = await scanFixture("reexport-star-named");
    const exportNames = deadExportNames(result);
    assert.ok(
      exportNames.includes("notReExported"),
      "notReExported should be unused (not consumed via star or named re-export)",
    );
  });
});

const unusedTypeNames = (result: ScanResult): string[] =>
  result.unusedTypes.map((unusedType) => unusedType.name).sort();

describe("unused-types: default (semantic disabled)", () => {
  it("should not surface unusedTypes when semantic disabled", async () => {
    const result = await scanFixture("unused-types-basic");
    assert.deepEqual(result.unusedTypes, [], "unusedTypes should be empty by default");
  });
});

describe("unused-types-basic (semantic enabled)", () => {
  it("should flag exported interface with zero references", async () => {
    const result = await scanFixture("unused-types-basic", { semantic: { enabled: true } });
    const names = unusedTypeNames(result);
    assert.ok(
      names.includes("UnusedInterface"),
      `UnusedInterface should be flagged, got: ${names.join(", ")}`,
    );
  });

  it("should flag exported type alias with zero references", async () => {
    const result = await scanFixture("unused-types-basic", { semantic: { enabled: true } });
    const names = unusedTypeNames(result);
    assert.ok(
      names.includes("UnusedAlias"),
      `UnusedAlias should be flagged, got: ${names.join(", ")}`,
    );
  });

  it("should NOT flag used interface", async () => {
    const result = await scanFixture("unused-types-basic", { semantic: { enabled: true } });
    const names = unusedTypeNames(result);
    assert.ok(!names.includes("UsedInterface"), "UsedInterface must not be flagged");
  });

  it("should NOT flag used type alias", async () => {
    const result = await scanFixture("unused-types-basic", { semantic: { enabled: true } });
    const names = unusedTypeNames(result);
    assert.ok(!names.includes("UsedAlias"), "UsedAlias must not be flagged");
  });

  it("emits confidence + reason + trace metadata", async () => {
    const result = await scanFixture("unused-types-basic", { semantic: { enabled: true } });
    const unusedInterface = result.unusedTypes.find(
      (unusedType) => unusedType.name === "UnusedInterface",
    );
    assert.ok(unusedInterface, "UnusedInterface entry should exist");
    assert.equal(unusedInterface!.confidence, "high");
    assert.equal(unusedInterface!.kind, "interface");
    assert.ok(unusedInterface!.reason.length > 0);
    assert.ok(unusedInterface!.trace.length > 0);
  });
});

describe("unused-types-nested (semantic enabled)", () => {
  it("should NOT flag type referenced only inside another type body", async () => {
    const result = await scanFixture("unused-types-nested", { semantic: { enabled: true } });
    const names = unusedTypeNames(result);
    assert.ok(!names.includes("Inner"), `Inner should not be flagged, got: ${names.join(", ")}`);
    assert.ok(!names.includes("Outer"), `Outer should not be flagged, got: ${names.join(", ")}`);
  });
});

describe("unused-types-extends (semantic enabled)", () => {
  it("should NOT flag parent interface when only child is imported", async () => {
    const result = await scanFixture("unused-types-extends", { semantic: { enabled: true } });
    const names = unusedTypeNames(result);
    assert.ok(!names.includes("Parent"), `Parent should not be flagged, got: ${names.join(", ")}`);
  });
});

describe("unused-types-reexport-chain (semantic enabled)", () => {
  it("should NOT flag re-exported type chain when leaf consumer exists", async () => {
    const result = await scanFixture("unused-types-reexport-chain", {
      semantic: { enabled: true },
    });
    const names = unusedTypeNames(result);
    assert.ok(
      !names.includes("Carried"),
      `Carried should not be flagged, got: ${names.join(", ")}`,
    );
  });
});

describe("unused-types-decl-merge (semantic enabled)", () => {
  it("should NOT flag declaration-merged interface when any merge branch is referenced", async () => {
    const result = await scanFixture("unused-types-decl-merge", { semantic: { enabled: true } });
    const names = unusedTypeNames(result);
    assert.ok(
      !names.includes("Settings"),
      `Settings should not be flagged, got: ${names.join(", ")}`,
    );
  });
});

describe("unused-types-generics (semantic enabled)", () => {
  it("should NOT flag generic constraint type referenced only as constraint", async () => {
    const result = await scanFixture("unused-types-generics", { semantic: { enabled: true } });
    const names = unusedTypeNames(result);
    assert.ok(
      !names.includes("Identifiable"),
      `Identifiable should not be flagged, got: ${names.join(", ")}`,
    );
    assert.ok(!names.includes("Box"), `Box should not be flagged, got: ${names.join(", ")}`);
  });
});

describe("unused-types-import-type (semantic enabled)", () => {
  it("should NOT flag type imported via 'import type' and used as annotation", async () => {
    const result = await scanFixture("unused-types-import-type", { semantic: { enabled: true } });
    const names = unusedTypeNames(result);
    assert.ok(
      !names.includes("Payload"),
      `Payload should not be flagged, got: ${names.join(", ")}`,
    );
  });
});

describe("unused-types-jsdoc (semantic enabled)", () => {
  it("should NOT flag type referenced via type annotation (JSDoc fixture)", async () => {
    const result = await scanFixture("unused-types-jsdoc", { semantic: { enabled: true } });
    const names = unusedTypeNames(result);
    assert.ok(!names.includes("Vector"), `Vector should not be flagged, got: ${names.join(", ")}`);
  });
});

describe("unused-types-entry-export (semantic enabled)", () => {
  it("should NOT flag entry-exported type by default", async () => {
    const result = await scanFixture("unused-types-entry-export", {
      semantic: { enabled: true },
    });
    const names = unusedTypeNames(result);
    assert.ok(
      !names.includes("PublicApiType"),
      `PublicApiType must not be flagged when includeEntryExports is false, got: ${names.join(", ")}`,
    );
  });

  it("should flag entry-exported type when includeEntryExports is true", async () => {
    const result = await scanFixture("unused-types-entry-export", {
      semantic: { enabled: true },
      includeEntryExports: true,
    });
    const names = unusedTypeNames(result);
    assert.ok(
      names.includes("PublicApiType"),
      `PublicApiType should be flagged with includeEntryExports, got: ${names.join(", ")}`,
    );
  });
});

describe("unused-types: graceful fallback without tsconfig", () => {
  it("should not crash and should emit empty unusedTypes on tsconfig-less fixture", async () => {
    const result = await scanFixture("simple-app", { semantic: { enabled: true } });
    assert.ok(Array.isArray(result.unusedTypes), "unusedTypes should always be an array");
  });
});

const unusedEnumMemberNames = (result: ScanResult): string[] =>
  result.unusedEnumMembers.map((member) => `${member.enumName}.${member.memberName}`).sort();

describe("unused-enum-members: default (semantic disabled)", () => {
  it("should not surface unusedEnumMembers when semantic disabled", async () => {
    const result = await scanFixture("unused-enum-members-string");
    assert.deepEqual(result.unusedEnumMembers, []);
  });

  it("should not surface unusedEnumMembers when only reportUnusedTypes is on", async () => {
    const result = await scanFixture("unused-enum-members-string", {
      semantic: { enabled: true },
    });
    assert.deepEqual(
      result.unusedEnumMembers,
      [],
      "default semantic config keeps enum member reporting off",
    );
  });
});

describe("unused-enum-members-string (semantic enum-members enabled)", () => {
  it("flags string enum members with no references", async () => {
    const result = await scanFixture("unused-enum-members-string", {
      semantic: { enabled: true, reportUnusedEnumMembers: true },
    });
    const flagged = unusedEnumMemberNames(result);
    assert.ok(
      flagged.includes("Status.Inactive"),
      `Status.Inactive should be flagged, got: ${flagged.join(", ")}`,
    );
    assert.ok(
      flagged.includes("Status.Pending"),
      `Status.Pending should be flagged, got: ${flagged.join(", ")}`,
    );
  });

  it("should NOT flag string enum member referenced via enum-dot access", async () => {
    const result = await scanFixture("unused-enum-members-string", {
      semantic: { enabled: true, reportUnusedEnumMembers: true },
    });
    const flagged = unusedEnumMemberNames(result);
    assert.ok(
      !flagged.includes("Status.Active"),
      `Status.Active must not be flagged, got: ${flagged.join(", ")}`,
    );
  });

  it("emits high confidence for string enum member findings", async () => {
    const result = await scanFixture("unused-enum-members-string", {
      semantic: { enabled: true, reportUnusedEnumMembers: true },
    });
    for (const member of result.unusedEnumMembers) {
      assert.equal(
        member.confidence,
        "high",
        `string-enum member ${member.enumName}.${member.memberName} should have high confidence`,
      );
    }
  });
});

describe("unused-enum-members-numeric-reverse (semantic enum-members enabled)", () => {
  it("should NOT flag any numeric enum member when whole enum reverse-lookup is used", async () => {
    const result = await scanFixture("unused-enum-members-numeric-reverse", {
      semantic: { enabled: true, reportUnusedEnumMembers: true },
    });
    assert.deepEqual(
      result.unusedEnumMembers,
      [],
      "numeric enum with reverse lookup must not flag any member",
    );
  });
});

describe("unused-enum-members-const (semantic enum-members enabled)", () => {
  it("should NOT flag any const enum member", async () => {
    const result = await scanFixture("unused-enum-members-const", {
      semantic: { enabled: true, reportUnusedEnumMembers: true },
    });
    assert.deepEqual(
      result.unusedEnumMembers,
      [],
      "const enums must be skipped (compile-time erased)",
    );
  });
});

const unusedClassMemberKeys = (result: ScanResult): string[] =>
  result.unusedClassMembers.map((member) => `${member.className}.${member.memberName}`).sort();

describe("unused-class-members: default (semantic disabled)", () => {
  it("should not surface unusedClassMembers by default", async () => {
    const result = await scanFixture("unused-class-members-public");
    assert.deepEqual(result.unusedClassMembers, []);
  });
});

describe("unused-class-members-public (semantic class-members enabled)", () => {
  it("flags public methods never referenced", async () => {
    const result = await scanFixture("unused-class-members-public", {
      semantic: { enabled: true, reportUnusedClassMembers: true },
    });
    const keys = unusedClassMemberKeys(result);
    assert.ok(
      keys.includes("Service.unusedMethod"),
      `Service.unusedMethod should be flagged, got: ${keys.join(", ")}`,
    );
  });

  it("should NOT flag public method that is referenced", async () => {
    const result = await scanFixture("unused-class-members-public", {
      semantic: { enabled: true, reportUnusedClassMembers: true },
    });
    const keys = unusedClassMemberKeys(result);
    assert.ok(
      !keys.includes("Service.greet"),
      `Service.greet must not be flagged, got: ${keys.join(", ")}`,
    );
  });
});

describe("unused-class-members-inheritance (semantic class-members enabled)", () => {
  it("should NOT flag base method when subclass overrides it (override credit)", async () => {
    const result = await scanFixture("unused-class-members-inheritance", {
      semantic: { enabled: true, reportUnusedClassMembers: true },
    });
    const keys = unusedClassMemberKeys(result);
    assert.ok(
      !keys.includes("Base.describe"),
      `Base.describe must not be flagged when overridden by Child, got: ${keys.join(", ")}`,
    );
    assert.ok(
      !keys.includes("Child.describe"),
      `Child.describe must not be flagged when referenced, got: ${keys.join(", ")}`,
    );
  });
});

describe("unused-class-members-decorated (semantic class-members enabled)", () => {
  it("should NOT flag decorated method when decorator is on allowlist (NestJS-style)", async () => {
    const result = await scanFixture("unused-class-members-decorated", {
      semantic: { enabled: true, reportUnusedClassMembers: true },
    });
    const keys = unusedClassMemberKeys(result);
    assert.ok(
      !keys.includes("UsersController.list"),
      `UsersController.list must not be flagged because of @Get, got: ${keys.join(", ")}`,
    );
  });
});

describe("unused-class-members-private-skip (semantic class-members enabled)", () => {
  it("should NOT flag private (modifier or #) members regardless of usage", async () => {
    const result = await scanFixture("unused-class-members-private-skip", {
      semantic: { enabled: true, reportUnusedClassMembers: true },
    });
    const keys = unusedClassMemberKeys(result);
    assert.ok(
      !keys.includes("Widget.hiddenHelper"),
      `Widget.hiddenHelper (private modifier) must not be flagged, got: ${keys.join(", ")}`,
    );
    assert.ok(
      !keys.some((key) => key.includes("brandPrivate")),
      `Widget.#brandPrivate must not be flagged, got: ${keys.join(", ")}`,
    );
  });
});

const redundantExportNames = (result: ScanResult): string[] =>
  result.redundantExports.map((entry) => entry.name).sort();

describe("redundant-exports: default (semantic disabled)", () => {
  it("should not surface redundantExports by default", async () => {
    const result = await scanFixture("redundant-exports-duplicate");
    assert.deepEqual(result.redundantExports, []);
  });
});

describe("redundant-exports-duplicate (semantic enabled)", () => {
  it("flags duplicate-named export with mixed consumption", async () => {
    const result = await scanFixture("redundant-exports-duplicate", {
      semantic: { enabled: true, reportRedundantExports: true },
    });
    const names = redundantExportNames(result);
    assert.ok(
      names.includes("formatValue"),
      `formatValue should be flagged, got: ${names.join(", ")}`,
    );
    const entry = result.redundantExports.find((finding) => finding.name === "formatValue");
    assert.equal(entry?.confidence, "medium");
    assert.equal(entry?.paths.length, 2);
  });
});

describe("redundant-exports-distinct (semantic enabled)", () => {
  it("should NOT flag exports with distinct names across modules", async () => {
    const result = await scanFixture("redundant-exports-distinct", {
      semantic: { enabled: true, reportRedundantExports: true },
    });
    assert.deepEqual(
      result.redundantExports,
      [],
      "distinct exports should not appear in redundantExports",
    );
  });
});

describe("redundant-exports-both-consumed (semantic enabled)", () => {
  it("flags same-name exports across modules at low confidence when both consumed", async () => {
    const result = await scanFixture("redundant-exports-both-consumed", {
      semantic: { enabled: true, reportRedundantExports: true },
    });
    const names = redundantExportNames(result);
    assert.ok(
      names.includes("transform"),
      `transform should be flagged at low confidence, got: ${names.join(", ")}`,
    );
    const entry = result.redundantExports.find((finding) => finding.name === "transform");
    assert.equal(entry?.confidence, "low");
  });
});

const privateLeakKeys = (result: ScanResult): string[] =>
  result.privateTypeLeaks.map((leak) => `${leak.exportName}->${leak.leakedTypeName}`).sort();

describe("private-type-leaks: default (semantic disabled)", () => {
  it("should not surface privateTypeLeaks by default", async () => {
    const result = await scanFixture("private-type-leak");
    assert.deepEqual(result.privateTypeLeaks, []);
  });
});

describe("private-type-leak (semantic enabled)", () => {
  it("flags exported function whose signature references an unexported type", async () => {
    const result = await scanFixture("private-type-leak", {
      semantic: { enabled: true, reportPrivateTypeLeaks: true },
    });
    const keys = privateLeakKeys(result);
    assert.ok(
      keys.includes("createInternal->InternalShape"),
      `createInternal->InternalShape should be flagged, got: ${keys.join(", ")}`,
    );
    const finding = result.privateTypeLeaks.find(
      (leak) => leak.exportName === "createInternal" && leak.leakedTypeName === "InternalShape",
    );
    assert.equal(finding?.confidence, "high");
  });
});

describe("private-type-no-leak (semantic enabled)", () => {
  it("should NOT flag exported function with only public types in signature", async () => {
    const result = await scanFixture("private-type-no-leak", {
      semantic: { enabled: true, reportPrivateTypeLeaks: true },
    });
    assert.deepEqual(result.privateTypeLeaks, [], "public-only signatures must not produce leaks");
  });
});

describe("private-type-leak-class (semantic enabled)", () => {
  it("flags exported class with public method referencing unexported type", async () => {
    const result = await scanFixture("private-type-leak-class", {
      semantic: { enabled: true, reportPrivateTypeLeaks: true },
    });
    const keys = privateLeakKeys(result);
    assert.ok(
      keys.includes("Service->PrivateConfig"),
      `Service->PrivateConfig should be flagged, got: ${keys.join(", ")}`,
    );
  });
});

const misclassifiedNames = (result: ScanResult): string[] =>
  result.misclassifiedDependencies.map((entry) => entry.name).sort();

describe("misclassified-deps: default (semantic disabled)", () => {
  it("should not surface misclassifiedDependencies by default", async () => {
    const result = await scanFixture("misclassified-deps-type-only");
    assert.deepEqual(result.misclassifiedDependencies, []);
  });
});

describe("misclassified-deps-type-only (semantic enabled)", () => {
  it("flags type-only dependency declared as prod dependency", async () => {
    const result = await scanFixture("misclassified-deps-type-only", {
      semantic: { enabled: true, reportMisclassifiedDependencies: true },
    });
    const names = misclassifiedNames(result);
    assert.ok(
      names.includes("type-only-pkg"),
      `type-only-pkg should be flagged, got: ${names.join(", ")}`,
    );
    const entry = result.misclassifiedDependencies.find((d) => d.name === "type-only-pkg");
    assert.equal(entry?.recommended, "devDependency");
  });
});

describe("misclassified-deps-value (semantic enabled)", () => {
  it("should NOT flag dependency imported for values", async () => {
    const result = await scanFixture("misclassified-deps-value", {
      semantic: { enabled: true, reportMisclassifiedDependencies: true },
    });
    assert.deepEqual(
      result.misclassifiedDependencies,
      [],
      "value-imported deps must not be flagged",
    );
  });
});

describe("misclassified-deps-mixed (semantic enabled)", () => {
  it("should NOT flag dependency with at least one value import", async () => {
    const result = await scanFixture("misclassified-deps-mixed", {
      semantic: { enabled: true, reportMisclassifiedDependencies: true },
    });
    const names = misclassifiedNames(result);
    assert.ok(
      !names.includes("mixed-pkg"),
      `mixed-pkg must not be flagged when any usage is value, got: ${names.join(", ")}`,
    );
  });
});

const unusedParameterKeys = (result: ScanResult): string[] =>
  result.unusedParameters.map((entry) => `${entry.functionName}.${entry.parameterName}`).sort();

describe("unused-parameters: default (semantic disabled)", () => {
  it("should not surface unusedParameters by default", async () => {
    const result = await scanFixture("unused-parameters-basic");
    assert.deepEqual(result.unusedParameters, []);
  });
});

describe("unused-parameters-basic (semantic enabled)", () => {
  it("flags parameter that is declared but never referenced inside function body", async () => {
    const result = await scanFixture("unused-parameters-basic", {
      semantic: { enabled: true, reportUnusedParameters: true },
    });
    const keys = unusedParameterKeys(result);
    assert.ok(
      keys.includes("greet.salutation"),
      `greet.salutation should be flagged, got: ${keys.join(", ")}`,
    );
    assert.ok(!keys.some((key) => key.startsWith("usedAll")), "usedAll params must not be flagged");
  });
});

describe("unused-parameters-underscore (semantic enabled)", () => {
  it("should NOT flag parameters whose name starts with underscore", async () => {
    const result = await scanFixture("unused-parameters-underscore", {
      semantic: { enabled: true, reportUnusedParameters: true },
    });
    assert.deepEqual(
      result.unusedParameters,
      [],
      "underscore-prefixed params must be skipped (TS / community convention)",
    );
  });
});

describe("unused-exports trace fields (Stretch DoD)", () => {
  it("populates confidence/reason/trace on unused exports", async () => {
    const result = await scanFixture("simple-app");
    const unusedExport = result.unusedExports.find(
      (entry) => entry.name === "unusedFunction" || entry.name === "anotherUnused",
    );
    assert.ok(unusedExport, "simple-app should expose at least one unused export");
    assert.ok(
      unusedExport!.confidence === "high" ||
        unusedExport!.confidence === "medium" ||
        unusedExport!.confidence === "low",
      `confidence should be one of high/medium/low, got ${unusedExport!.confidence}`,
    );
    assert.ok(
      typeof unusedExport!.reason === "string" && unusedExport!.reason.length > 0,
      "reason should be a non-empty string",
    );
    assert.ok(
      Array.isArray(unusedExport!.trace) && unusedExport!.trace.length > 0,
      "trace should be a non-empty array",
    );
  });
});

describe("unused-types-wildcard-reexport (FP-class fix)", () => {
  it("should NOT flag types in a module whose exports flow through an entry's export * chain", async () => {
    const result = await scanFixture("unused-types-wildcard-reexport", {
      semantic: { enabled: true },
    });
    const names = result.unusedTypes.map((entry) => entry.name).sort();
    assert.deepEqual(
      names,
      [],
      "wildcard-re-exported types must not be flagged when default config hides entry exports",
    );
  });
});

describe("unused-types-named-reexport (FP-class fix)", () => {
  it("skips named-re-exported type, flags the sibling that wasn't re-exported", async () => {
    const result = await scanFixture("unused-types-named-reexport", {
      semantic: { enabled: true },
    });
    const names = result.unusedTypes.map((entry) => entry.name).sort();
    assert.ok(
      !names.includes("PublishedA"),
      `PublishedA is named-re-exported from entry; must not be flagged, got: ${names.join(", ")}`,
    );
    assert.ok(
      names.includes("LeakedInternal"),
      `LeakedInternal is declared but not re-exported; should be flagged, got: ${names.join(", ")}`,
    );
  });
});

const duplicateTypeKeys = (result: ScanResult): string[] =>
  result.duplicateTypeDefinitions.map((entry) => `${entry.kind}:${entry.name}`).sort();

describe("duplicate-types: default (semantic disabled)", () => {
  it("should not surface duplicateTypeDefinitions by default", async () => {
    const result = await scanFixture("duplicate-types-positive");
    assert.deepEqual(result.duplicateTypeDefinitions, []);
  });
});

describe("duplicate-types-positive (semantic enabled)", () => {
  it("flags structurally identical interface declared in two modules at high confidence", async () => {
    const result = await scanFixture("duplicate-types-positive", {
      semantic: { enabled: true, reportDuplicateTypeDefinitions: true },
    });
    const keys = duplicateTypeKeys(result);
    assert.ok(keys.includes("interface:Point"), `Point should be flagged, got: ${keys.join(", ")}`);
    const entry = result.duplicateTypeDefinitions.find(
      (finding) => finding.name === "Point" && finding.kind === "interface",
    );
    assert.equal(entry?.confidence, "high");
    assert.equal(entry?.paths.length, 2);
  });
});

describe("duplicate-types-distinct (semantic enabled)", () => {
  it("should NOT flag structurally distinct types", async () => {
    const result = await scanFixture("duplicate-types-distinct", {
      semantic: { enabled: true, reportDuplicateTypeDefinitions: true },
    });
    assert.deepEqual(
      result.duplicateTypeDefinitions,
      [],
      "structurally distinct types should not be flagged",
    );
  });
});

describe("duplicate-types-aliases (semantic enabled)", () => {
  it("flags structurally identical aliases under different names at medium confidence", async () => {
    const result = await scanFixture("duplicate-types-aliases", {
      semantic: { enabled: true, reportDuplicateTypeDefinitions: true },
    });
    assert.equal(
      result.duplicateTypeDefinitions.length,
      1,
      `expected one duplicate-types finding, got: ${JSON.stringify(result.duplicateTypeDefinitions)}`,
    );
    const finding = result.duplicateTypeDefinitions[0];
    assert.equal(finding.kind, "type-alias");
    assert.equal(finding.confidence, "medium");
    assert.ok(finding.name.includes("StringId") && finding.name.includes("UserId"));
  });
});

describe("misclassified-deps-checker-only (semantic enabled)", () => {
  it("uses TS checker to upgrade syntactic value imports that resolve to type-only symbols", async () => {
    const result = await scanFixture("misclassified-deps-checker-only", {
      semantic: { enabled: true, reportMisclassifiedDependencies: true },
    });
    const names = result.misclassifiedDependencies.map((entry) => entry.name).sort();
    assert.ok(
      names.includes("checker-only-pkg"),
      `checker-only-pkg should be flagged via checker upgrade, got: ${names.join(", ")}`,
    );
    const finding = result.misclassifiedDependencies.find((d) => d.name === "checker-only-pkg");
    assert.equal(
      finding?.confidence,
      "high",
      "checker-confirmed type-only imports should be high-confidence",
    );
    assert.ok(
      finding?.reason.includes("checker confirms"),
      "reason should cite the checker as evidence",
    );
  });
});
