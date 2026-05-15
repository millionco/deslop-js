import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { resolve, relative } from "node:path";
import { analyze, createConfig } from "../src/index.js";
import type { AnalysisResult } from "../src/types.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "fixtures");

const analyzeFixture = async (
  fixtureName: string,
  overrides: Record<string, unknown> = {},
): Promise<AnalysisResult> => {
  const fixtureDir = resolve(FIXTURES_DIR, fixtureName);
  const config = createConfig({
    rootDir: fixtureDir,
    ...overrides,
  });
  return analyze(config);
};

const relativePaths = (result: AnalysisResult, fixtureDir: string): string[] =>
  result.unusedFiles.map((unusedFile) => relative(fixtureDir, unusedFile.path)).sort();

const unusedExportNames = (result: AnalysisResult): string[] =>
  result.unusedExports.map((unusedExport) => unusedExport.name).sort();

const unusedExportsByFile = (
  result: AnalysisResult,
  fixtureDir: string,
): Record<string, string[]> => {
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

const unusedDependencyNames = (result: AnalysisResult): string[] =>
  result.unusedDependencies.map((dep) => dep.name).sort();

describe("basic-project", () => {
  it("should detect orphan file", async () => {
    const result = await analyzeFixture("basic-project");
    const fixtureDir = resolve(FIXTURES_DIR, "basic-project");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(unusedFilePaths.includes("src/orphan.ts"), `orphan.ts should be unused, got: ${unusedFilePaths}`);
  });

  it("should detect unused exports in utils", async () => {
    const result = await analyzeFixture("basic-project");
    const fixtureDir = resolve(FIXTURES_DIR, "basic-project");
    const exportsByFile = unusedExportsByFile(result, fixtureDir);
    assert.ok(
      exportsByFile["src/utils.ts"]?.includes("unusedFunction"),
      `unusedFunction should be flagged, got: ${JSON.stringify(exportsByFile["src/utils.ts"])}`,
    );
  });

  it("should detect unused dependency", async () => {
    const result = await analyzeFixture("basic-project");
    const deps = unusedDependencyNames(result);
    assert.ok(deps.includes("unused-dep"), `unused-dep should be flagged, got: ${deps}`);
  });

  it("should not flag usedFunction as unused", async () => {
    const result = await analyzeFixture("basic-project");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(!allUnusedNames.includes("usedFunction"), "usedFunction should not be unused");
  });

  it("should flag react as unused (declared but never imported)", async () => {
    const result = await analyzeFixture("basic-project");
    const deps = unusedDependencyNames(result);
    assert.ok(deps.includes("react"), `react should be unused since never imported, got: ${deps}`);
  });
});

describe("barrel-exports", () => {
  it("should not flag foo as unused (used via barrel)", async () => {
    const result = await analyzeFixture("barrel-exports");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(!allUnusedNames.includes("foo"), "foo is used through barrel");
  });

  it("should flag fooUnused as unused", async () => {
    const result = await analyzeFixture("barrel-exports");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(allUnusedNames.includes("fooUnused"), `fooUnused should be unused, got: ${allUnusedNames}`);
  });

  it("should flag module-b.ts as unused file (re-exported by barrel but bar never consumed)", async () => {
    const result = await analyzeFixture("barrel-exports");
    const fixtureDir = resolve(FIXTURES_DIR, "barrel-exports");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.some((filePath) => filePath === "src/module-b.ts"),
      `module-b.ts should be unused since bar is never consumed, got: ${unusedFilePaths}`,
    );
  });

  it("should flag module-c.ts as unused file (star re-exported by barrel but neither baz nor qux consumed)", async () => {
    const result = await analyzeFixture("barrel-exports");
    const fixtureDir = resolve(FIXTURES_DIR, "barrel-exports");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.some((filePath) => filePath === "src/module-c.ts"),
      `module-c.ts should be unused since no exports from it are consumed, got: ${unusedFilePaths}`,
    );
  });
});

describe("re-export-chains (3-level barrel chain)", () => {
  it("should not flag alpha and beta (used via 3-level chain)", async () => {
    const result = await analyzeFixture("re-export-chains");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(!allUnusedNames.includes("alpha"), "alpha is used via chain");
    assert.ok(!allUnusedNames.includes("beta"), "beta is used via chain");
  });

  it("should flag gamma and delta as unused", async () => {
    const result = await analyzeFixture("re-export-chains");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(allUnusedNames.includes("gamma"), `gamma should be unused, got: ${allUnusedNames}`);
    assert.ok(allUnusedNames.includes("delta"), `delta should be unused, got: ${allUnusedNames}`);
  });

  it("should not flag any file as unused", async () => {
    const result = await analyzeFixture("re-export-chains");
    assert.equal(result.unusedFiles.length, 0, "all files are reachable via chain");
  });
});

describe("namespace-imports", () => {
  it("should not flag any exports as unused (namespace import marks all used)", async () => {
    const result = await analyzeFixture("namespace-imports");
    assert.equal(result.unusedExports.length, 0, `expected 0 unused exports, got: ${unusedExportNames(result)}`);
  });

  it("should not flag any files as unused", async () => {
    const result = await analyzeFixture("namespace-imports");
    assert.equal(result.unusedFiles.length, 0);
  });
});

describe("default-export", () => {
  it("should flag default export of component.ts (only named is used)", async () => {
    const result = await analyzeFixture("default-export");
    const fixtureDir = resolve(FIXTURES_DIR, "default-export");
    const exportsByFile = unusedExportsByFile(result, fixtureDir);
    assert.ok(
      exportsByFile["src/component.ts"]?.includes("default"),
      `default should be unused in component.ts, got: ${JSON.stringify(exportsByFile)}`,
    );
  });

  it("should flag unused-default.ts as unused file", async () => {
    const result = await analyzeFixture("default-export");
    const fixtureDir = resolve(FIXTURES_DIR, "default-export");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/unused-default.ts"),
      `unused-default.ts should be unused file, got: ${unusedFilePaths}`,
    );
  });

  it("should not flag usedNamed as unused", async () => {
    const result = await analyzeFixture("default-export");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(!allUnusedNames.includes("usedNamed"), "usedNamed is imported");
  });
});

describe("side-effect-imports", () => {
  it("should keep setup.ts reachable (side-effect import)", async () => {
    const result = await analyzeFixture("side-effect-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "side-effect-imports");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/setup.ts"), "setup.ts is side-effect imported");
  });

  it("should flag orphan.ts as unused", async () => {
    const result = await analyzeFixture("side-effect-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "side-effect-imports");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(unusedFilePaths.includes("src/orphan.ts"), `orphan.ts should be unused, got: ${unusedFilePaths}`);
  });
});

describe("circular-re-export", () => {
  it("should not flag fromA or fromB (used despite circular re-exports)", async () => {
    const result = await analyzeFixture("circular-re-export");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(!allUnusedNames.includes("fromA"), "fromA is used");
    assert.ok(!allUnusedNames.includes("fromB"), "fromB is used");
  });

  it("should not hang or crash from circular re-export", async () => {
    const result = await analyzeFixture("circular-re-export");
    assert.ok(result.totalFiles > 0, "analysis should complete");
  });
});

describe("star-re-export-chain", () => {
  it("should not flag used as unused (via star re-export chain)", async () => {
    const result = await analyzeFixture("star-re-export-chain");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(!allUnusedNames.includes("used"), "used should be found through star chain");
  });

  it("should flag unused export in source", async () => {
    const result = await analyzeFixture("star-re-export-chain");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(allUnusedNames.includes("unused"), `unused should be flagged, got: ${allUnusedNames}`);
  });
});

describe("star-selective-usage", () => {
  it("should not flag usedOne and usedTwo (selectively imported via star barrel)", async () => {
    const result = await analyzeFixture("star-selective-usage");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(!allUnusedNames.includes("usedOne"), "usedOne is used");
    assert.ok(!allUnusedNames.includes("usedTwo"), "usedTwo is used");
  });

  it("should flag unusedThree and unusedFour", async () => {
    const result = await analyzeFixture("star-selective-usage");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(allUnusedNames.includes("unusedThree"), `unusedThree should be flagged, got: ${allUnusedNames}`);
    assert.ok(allUnusedNames.includes("unusedFour"), `unusedFour should be flagged, got: ${allUnusedNames}`);
  });
});

describe("multi-hop-barrel", () => {
  it("should not flag used (imported through two barrel hops)", async () => {
    const result = await analyzeFixture("multi-hop-barrel");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(!allUnusedNames.includes("used"), "used is consumed through 2-hop barrel");
  });

  it("should flag unused1 and unused2", async () => {
    const result = await analyzeFixture("multi-hop-barrel");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(allUnusedNames.includes("unused1"), `unused1 should be unused, got: ${allUnusedNames}`);
    assert.ok(allUnusedNames.includes("unused2"), `unused2 should be unused, got: ${allUnusedNames}`);
  });
});

describe("multi-level-barrel-chain", () => {
  it("should not flag alpha and beta (used through 3-level named re-export chain)", async () => {
    const result = await analyzeFixture("multi-level-barrel-chain");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(!allUnusedNames.includes("alpha"), "alpha is used");
    assert.ok(!allUnusedNames.includes("beta"), "beta is used");
  });

  it("should flag gamma (re-exported in barrel-a but not imported)", async () => {
    const result = await analyzeFixture("multi-level-barrel-chain");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(allUnusedNames.includes("gamma"), `gamma should be unused, got: ${allUnusedNames}`);
  });

  it("should flag delta (only in barrel-b, not re-exported by barrel-a)", async () => {
    const result = await analyzeFixture("multi-level-barrel-chain");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(allUnusedNames.includes("delta"), `delta should be unused, got: ${allUnusedNames}`);
  });

  it("should flag epsilon (not re-exported at all)", async () => {
    const result = await analyzeFixture("multi-level-barrel-chain");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(allUnusedNames.includes("epsilon"), `epsilon should be unused, got: ${allUnusedNames}`);
  });
});

describe("barrel-default-reexport", () => {
  it("should not flag Button (used via default re-export through barrel)", async () => {
    const result = await analyzeFixture("barrel-default-reexport");
    const fixtureDir = resolve(FIXTURES_DIR, "barrel-default-reexport");
    const exportsByFile = unusedExportsByFile(result, fixtureDir);
    const buttonExports = exportsByFile["src/components/Button.ts"];
    assert.ok(
      !buttonExports?.includes("default"),
      "Button default export is used",
    );
  });
});

describe("barrel-unused-reexports", () => {
  it("should not flag UsedComponent", async () => {
    const result = await analyzeFixture("barrel-unused-reexports");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(!allUnusedNames.includes("UsedComponent"), "UsedComponent is imported");
  });

  it("should flag unused-source.ts as unused file (barrel re-exports it but nobody consumes UnusedComponent)", async () => {
    const result = await analyzeFixture("barrel-unused-reexports");
    const fixtureDir = resolve(FIXTURES_DIR, "barrel-unused-reexports");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.some((filePath) => filePath === "src/components/unused-source.ts"),
      `unused-source.ts should be an unused file since UnusedComponent is never consumed, got: ${unusedFilePaths}`,
    );
  });
});

describe("deep-barrel-symbol-tracking", () => {
  it("should keep used-source.ts reachable (usedHelper consumed through two barrel layers)", async () => {
    const result = await analyzeFixture("deep-barrel-symbol-tracking");
    const fixtureDir = resolve(FIXTURES_DIR, "deep-barrel-symbol-tracking");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/used-source.ts"),
      "used-source.ts should be reachable via barrel-mid → barrel-top → index",
    );
  });

  it("should flag unused-source.ts as unused file (unusedHelper never consumed at root)", async () => {
    const result = await analyzeFixture("deep-barrel-symbol-tracking");
    const fixtureDir = resolve(FIXTURES_DIR, "deep-barrel-symbol-tracking");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/unused-source.ts"),
      `unused-source.ts should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan.ts as unused file", async () => {
    const result = await analyzeFixture("deep-barrel-symbol-tracking");
    const fixtureDir = resolve(FIXTURES_DIR, "deep-barrel-symbol-tracking");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should flag usedHelperSibling as unused export", async () => {
    const result = await analyzeFixture("deep-barrel-symbol-tracking");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(
      allUnusedNames.includes("usedHelperSibling"),
      `usedHelperSibling should be unused, got: ${allUnusedNames}`,
    );
  });
});

describe("late-consumed-wildcard-reexport", () => {
  it("should keep color-picker reachable when consumed via plugin that imports from sibling component barrel", async () => {
    const result = await analyzeFixture("late-consumed-wildcard-reexport");
    const fixtureDir = resolve(FIXTURES_DIR, "late-consumed-wildcard-reexport");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/color-picker/color-picker.ts"),
      `color-picker.ts should be reachable via plugin → components barrel → color-picker barrel, got unused: ${unusedFilePaths}`,
    );
  });

  it("should keep color-picker/index.ts reachable as intermediate barrel", async () => {
    const result = await analyzeFixture("late-consumed-wildcard-reexport");
    const fixtureDir = resolve(FIXTURES_DIR, "late-consumed-wildcard-reexport");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/color-picker/index.ts"),
      `color-picker/index.ts should be reachable, got unused: ${unusedFilePaths}`,
    );
  });

  it("should flag unused-widget.ts as unused file (never imported by any plugin)", async () => {
    const result = await analyzeFixture("late-consumed-wildcard-reexport");
    const fixtureDir = resolve(FIXTURES_DIR, "late-consumed-wildcard-reexport");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/components/unused-widget.ts"),
      `unused-widget.ts should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should flag ColorUtils as unused export (only ColorPicker consumed from color-picker.ts)", async () => {
    const result = await analyzeFixture("late-consumed-wildcard-reexport");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(
      allUnusedNames.includes("ColorUtils"),
      `ColorUtils should be unused export, got: ${allUnusedNames}`,
    );
  });
});

describe("import-and-reexport-same-target", () => {
  it("should create both direct import and re-export edges when a file imports from and re-exports the same module", async () => {
    const result = await analyzeFixture("import-and-reexport-same-target");
    const fixtureDir = resolve(FIXTURES_DIR, "import-and-reexport-same-target");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/widget.ts"),
      `widget.ts should be reachable via re-export through components barrel (export * from), got unused: ${unusedFilePaths}`,
    );
  });

  it("should keep helper.ts reachable via both direct import and re-export", async () => {
    const result = await analyzeFixture("import-and-reexport-same-target");
    const fixtureDir = resolve(FIXTURES_DIR, "import-and-reexport-same-target");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/helper.ts"),
      `helper.ts should be reachable, got unused: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan.ts as unused (not imported or re-exported by anyone)", async () => {
    const result = await analyzeFixture("import-and-reexport-same-target");
    const fixtureDir = resolve(FIXTURES_DIR, "import-and-reexport-same-target");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("re-export-alias-chain", () => {
  it("should not flag original and renamed (used via aliased re-export chain)", async () => {
    const result = await analyzeFixture("re-export-alias-chain");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(!allUnusedNames.includes("original"), "original is used via aliasC");
    assert.ok(!allUnusedNames.includes("renamed"), "renamed is used via doubleAlias");
  });

  it("should flag unusedOriginal (aliased but never consumed)", async () => {
    const result = await analyzeFixture("re-export-alias-chain");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(
      allUnusedNames.includes("unusedOriginal"),
      `unusedOriginal should be unused, got: ${allUnusedNames}`,
    );
  });

  it("should flag neverExported (not re-exported by any barrel)", async () => {
    const result = await analyzeFixture("re-export-alias-chain");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(
      allUnusedNames.includes("neverExported"),
      `neverExported should be unused, got: ${allUnusedNames}`,
    );
  });
});

describe("dynamic-imports", () => {
  it("should keep lazy.ts reachable via dynamic import", async () => {
    const result = await analyzeFixture("dynamic-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "dynamic-imports");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/lazy.ts"), "lazy.ts is dynamically imported");
  });

  it("should flag orphan.ts as unused file", async () => {
    const result = await analyzeFixture("dynamic-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "dynamic-imports");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(unusedFilePaths.includes("src/orphan.ts"), `orphan.ts should be unused, got: ${unusedFilePaths}`);
  });

  it("should flag unused export in utils", async () => {
    const result = await analyzeFixture("dynamic-imports");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(allUnusedNames.includes("unused"), `unused should be flagged, got: ${allUnusedNames}`);
  });
});

describe("type-only-deps", () => {
  it("should detect type-only imports", async () => {
    const result = await analyzeFixture("type-only-deps");
    assert.ok(result.totalFiles > 0, "should find files");
  });
});

describe("unreachable-barrel-subtree", () => {
  it("should flag all files in the dead subtree", async () => {
    const result = await analyzeFixture("unreachable-barrel-subtree");
    const fixtureDir = resolve(FIXTURES_DIR, "unreachable-barrel-subtree");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/subtree/setup.ts"),
      `setup.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("unreachable-mixed-exports", () => {
  it("should flag both files in unreachable test-utils", async () => {
    const result = await analyzeFixture("unreachable-mixed-exports");
    const fixtureDir = resolve(FIXTURES_DIR, "unreachable-mixed-exports");
    const unusedFilePaths = relativePaths(result, fixtureDir);
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

describe("mixed-named-star-reexports", () => {
  it("should not flag namedUsed and starUsed", async () => {
    const result = await analyzeFixture("mixed-named-star-reexports");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(!allUnusedNames.includes("namedUsed"), "namedUsed is consumed");
    assert.ok(!allUnusedNames.includes("starUsed"), "starUsed is consumed");
  });

  it("should flag namedUnused and starUnused", async () => {
    const result = await analyzeFixture("mixed-named-star-reexports");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(allUnusedNames.includes("namedUnused"), `namedUnused should be flagged, got: ${allUnusedNames}`);
    assert.ok(allUnusedNames.includes("starUnused"), `starUnused should be flagged, got: ${allUnusedNames}`);
  });
});

describe("path-aliases", () => {
  it("should resolve @/ alias and not flag helper as unused", async () => {
    const result = await analyzeFixture("path-aliases");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(!allUnusedNames.includes("helper"), "helper is imported via @/ alias");
  });

  it("should not flag any files as unused", async () => {
    const result = await analyzeFixture("path-aliases");
    assert.equal(result.unusedFiles.length, 0, "all files reachable via alias");
  });
});

describe("entry-export-validation", () => {
  it("should not flag entry exports by default", async () => {
    const result = await analyzeFixture("entry-export-validation");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(!allUnusedNames.includes("meatdata"), "entry exports are excluded by default");
    assert.ok(!allUnusedNames.includes("config"), "entry exports are excluded by default");
  });

  it("should flag entry exports when includeEntryExports is true", async () => {
    const result = await analyzeFixture("entry-export-validation", {
      includeEntryExports: true,
    });
    const allUnusedNames = unusedExportNames(result);
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

describe("namespace-exports", () => {
  it("should handle TypeScript namespace exports", async () => {
    const result = await analyzeFixture("namespace-exports");
    assert.ok(result.totalFiles > 0, "should parse files with namespace exports");
    const fixtureDir = resolve(FIXTURES_DIR, "namespace-exports");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/helpers.ts"), "helpers.ts is imported");
  });
});

describe("cjs-project", () => {
  it("should flag orphan.js as unused", async () => {
    const result = await analyzeFixture("cjs-project");
    const fixtureDir = resolve(FIXTURES_DIR, "cjs-project");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(unusedFilePaths.includes("src/orphan.js"), `orphan.js should be unused, got: ${unusedFilePaths}`);
  });
});

describe("config-file-project", () => {
  it("should flag orphan.ts as unused", async () => {
    const result = await analyzeFixture("config-file-project");
    const fixtureDir = resolve(FIXTURES_DIR, "config-file-project");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(unusedFilePaths.includes("src/orphan.ts"), `orphan.ts should be unused, got: ${unusedFilePaths}`);
  });

  it("should flag unusedFunction as unused export", async () => {
    const result = await analyzeFixture("config-file-project");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(allUnusedNames.includes("unusedFunction"), `unusedFunction should be unused, got: ${allUnusedNames}`);
  });
});

describe("dynamic-import-literals", () => {
  it("should keep notes.ts reachable via dynamic import from parent path", async () => {
    const result = await analyzeFixture("dynamic-import-literals");
    const fixtureDir = resolve(FIXTURES_DIR, "dynamic-import-literals");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("notes.ts"), "notes.ts is dynamically imported");
  });

  it("should flag orphan.ts as unused", async () => {
    const result = await analyzeFixture("dynamic-import-literals");
    const fixtureDir = resolve(FIXTURES_DIR, "dynamic-import-literals");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(unusedFilePaths.includes("src/orphan.ts"), `orphan.ts should be unused, got: ${unusedFilePaths}`);
  });
});

describe("arrow-wrapped-dynamic-imports", () => {
  it("should keep Foo.tsx, Bar.tsx, Baz.tsx reachable via wrapped dynamic imports", async () => {
    const result = await analyzeFixture("arrow-wrapped-dynamic-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "arrow-wrapped-dynamic-imports");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/Foo.tsx"), "Foo.tsx is lazily imported");
    assert.ok(!unusedFilePaths.includes("src/Bar.tsx"), "Bar.tsx is lazily imported");
    assert.ok(!unusedFilePaths.includes("src/Baz.tsx"), "Baz.tsx is lazily imported");
  });

  it("should keep feature.routes.ts reachable via loadChildren arrow", async () => {
    const result = await analyzeFixture("arrow-wrapped-dynamic-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "arrow-wrapped-dynamic-imports");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/feature.routes.ts"), "feature.routes.ts is dynamically imported");
  });

  it("should flag orphan.ts as unused", async () => {
    const result = await analyzeFixture("arrow-wrapped-dynamic-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "arrow-wrapped-dynamic-imports");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(unusedFilePaths.includes("src/orphan.ts"), `orphan.ts should be unused, got: ${unusedFilePaths}`);
  });
});

describe("type-only-cycle", () => {
  it("should not crash on circular type-only imports", async () => {
    const result = await analyzeFixture("type-only-cycle");
    assert.ok(result.totalFiles > 0, "should complete analysis without crashing");
  });

  it("should not flag user.ts or post.ts as unused", async () => {
    const result = await analyzeFixture("type-only-cycle");
    const fixtureDir = resolve(FIXTURES_DIR, "type-only-cycle");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/user.ts"), "user.ts is imported");
    assert.ok(!unusedFilePaths.includes("src/post.ts"), "post.ts is imported");
  });

  it("should not flag createUser or createPost as unused", async () => {
    const result = await analyzeFixture("type-only-cycle");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(!allUnusedNames.includes("createUser"), "createUser is used");
    assert.ok(!allUnusedNames.includes("createPost"), "createPost is used");
  });
});

describe("unreachable-dynamic-subtree", () => {
  it("should flag setup.ts and lazy.ts as unused (subtree not reachable from entry)", async () => {
    const result = await analyzeFixture("unreachable-dynamic-subtree");
    const fixtureDir = resolve(FIXTURES_DIR, "unreachable-dynamic-subtree");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(unusedFilePaths.includes("src/subtree/setup.ts"), `setup.ts should be unused, got: ${unusedFilePaths}`);
    assert.ok(unusedFilePaths.includes("src/subtree/lazy.ts"), `lazy.ts should be unused, got: ${unusedFilePaths}`);
  });
});

describe("unreachable-shared-child", () => {
  it("should flag subtree/setup.ts and subtree/helpers.ts as unused", async () => {
    const result = await analyzeFixture("unreachable-shared-child");
    const fixtureDir = resolve(FIXTURES_DIR, "unreachable-shared-child");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(unusedFilePaths.includes("src/subtree/setup.ts"), `setup.ts should be unused, got: ${unusedFilePaths}`);
    assert.ok(unusedFilePaths.includes("src/subtree/helpers.ts"), `helpers.ts should be unused, got: ${unusedFilePaths}`);
  });

  it("should not flag shared/utils.ts as unused (imported by entry)", async () => {
    const result = await analyzeFixture("unreachable-shared-child");
    const fixtureDir = resolve(FIXTURES_DIR, "unreachable-shared-child");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/shared/utils.ts"), "shared/utils.ts is used by entry");
  });
});

describe("css-tracking", () => {
  it("should track imported CSS as reachable via import graph", async () => {
    const result = await analyzeFixture("css-tracking");
    const fixtureDir = resolve(FIXTURES_DIR, "css-tracking");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/styles.css"), "styles.css is imported and should be reachable");
  });

  it("should flag unimported CSS files as unused", async () => {
    const result = await analyzeFixture("css-tracking");
    const fixtureDir = resolve(FIXTURES_DIR, "css-tracking");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(unusedFilePaths.includes("src/unused.css"), "unused.css should be flagged as unused");
  });

  it("should flag orphan TS files", async () => {
    const result = await analyzeFixture("css-tracking");
    const fixtureDir = resolve(FIXTURES_DIR, "css-tracking");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(unusedFilePaths.includes("src/orphan.ts"), `orphan.ts should be unused, got: ${unusedFilePaths}`);
  });
});

describe("config-files-cjs-mjs", () => {
  it("should treat .cjs and .mjs config files as entry points", async () => {
    const result = await analyzeFixture("config-files-cjs-mjs");
    const fixtureDir = resolve(FIXTURES_DIR, "config-files-cjs-mjs");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("lage.config.cjs"),
      "lage.config.cjs should be excluded as config file (matches *.config.* pattern)",
    );
    assert.ok(
      !unusedFilePaths.includes("prettier.config.mjs"),
      "prettier.config.mjs should be treated as config entry point",
    );
    assert.ok(
      !unusedFilePaths.includes("vitest.config.mts"),
      "vitest.config.mts should be treated as config entry point",
    );
  });

  it("should still flag orphan files", async () => {
    const result = await analyzeFixture("config-files-cjs-mjs");
    const fixtureDir = resolve(FIXTURES_DIR, "config-files-cjs-mjs");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(unusedFilePaths.includes("src/orphan.ts"), `orphan.ts should be unused, got: ${unusedFilePaths}`);
  });
});

describe("test-runner-detection", () => {
  it("should treat .test.ts files as entry points when vitest is a dependency", async () => {
    const result = await analyzeFixture("test-runner-detection");
    const fixtureDir = resolve(FIXTURES_DIR, "test-runner-detection");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/helper.test.ts"),
      "helper.test.ts should be a test entry point",
    );
  });

  it("should treat __tests__ files as entry points when vitest is a dependency", async () => {
    const result = await analyzeFixture("test-runner-detection");
    const fixtureDir = resolve(FIXTURES_DIR, "test-runner-detection");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/__tests__/utils.test.ts"),
      "__tests__/utils.test.ts should be a test entry point",
    );
  });

  it("should keep files imported by test files as reachable", async () => {
    const result = await analyzeFixture("test-runner-detection");
    const fixtureDir = resolve(FIXTURES_DIR, "test-runner-detection");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/helper.ts"),
      "helper.ts is imported by test file and should be reachable",
    );
    assert.ok(
      !unusedFilePaths.includes("src/test-only-used.ts"),
      "test-only-used.ts is imported by __tests__ file and should be reachable",
    );
  });

  it("should still flag orphan files", async () => {
    const result = await analyzeFixture("test-runner-detection");
    const fixtureDir = resolve(FIXTURES_DIR, "test-runner-detection");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("no-test-runner", () => {
  it("should NOT treat .test.ts as entry point without a test runner dependency", async () => {
    const result = await analyzeFixture("no-test-runner");
    const fixtureDir = resolve(FIXTURES_DIR, "no-test-runner");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/helper.test.ts"),
      `helper.test.ts should be unused without test runner, got: ${unusedFilePaths}`,
    );
  });
});

describe("path-aliases-mixed-exports", () => {
  it("should resolve @/ aliases and keep used files reachable", async () => {
    const result = await analyzeFixture("path-aliases-mixed-exports");
    const fixtureDir = resolve(FIXTURES_DIR, "path-aliases-mixed-exports");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/types.ts"), "types.ts is imported via alias");
    assert.ok(!unusedFilePaths.includes("src/helpers.ts"), "helpers.ts is imported via alias");
  });

  it("should flag orphan.ts as unused", async () => {
    const result = await analyzeFixture("path-aliases-mixed-exports");
    const fixtureDir = resolve(FIXTURES_DIR, "path-aliases-mixed-exports");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(unusedFilePaths.includes("src/orphan.ts"), `orphan.ts should be unused, got: ${unusedFilePaths}`);
  });

  it("should flag unusedExport and unusedHelper", async () => {
    const result = await analyzeFixture("path-aliases-mixed-exports");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(allUnusedNames.includes("unusedExport"), `unusedExport should be unused, got: ${allUnusedNames}`);
    assert.ok(allUnusedNames.includes("unusedHelper"), `unusedHelper should be unused, got: ${allUnusedNames}`);
  });
});

describe("fixture-patterns", () => {
  it("should treat __fixtures__ files as entry points when vitest is present", async () => {
    const result = await analyzeFixture("fixture-patterns");
    const fixtureDir = resolve(FIXTURES_DIR, "fixture-patterns");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/__fixtures__/user-data.ts"),
      `__fixtures__/user-data.ts should be treated as entry point, got: ${unusedFilePaths}`,
    );
  });

  it("should report __mocks__ files as unused when not imported", async () => {
    const result = await analyzeFixture("fixture-patterns");
    const fixtureDir = resolve(FIXTURES_DIR, "fixture-patterns");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/__mocks__/api-client.ts"),
      `__mocks__/api-client.ts should be unused (not an entry point), got: ${unusedFilePaths}`,
    );
  });

  it("should still flag orphan files", async () => {
    const result = await analyzeFixture("fixture-patterns");
    const fixtureDir = resolve(FIXTURES_DIR, "fixture-patterns");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("electron-project", () => {
  it("should treat src/main and src/preload as entry points in Electron projects", async () => {
    const result = await analyzeFixture("electron-project");
    const fixtureDir = resolve(FIXTURES_DIR, "electron-project");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/main/index.ts"),
      `src/main/index.ts should be entry point, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/main/window.ts"),
      `src/main/window.ts should be reachable from main, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/preload/preload.ts"),
      `src/preload/preload.ts should be entry point, got: ${unusedFilePaths}`,
    );
  });

  it("should still flag orphan files in Electron projects", async () => {
    const result = await analyzeFixture("electron-project");
    const fixtureDir = resolve(FIXTURES_DIR, "electron-project");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("source-path-fallback", () => {
  it("should resolve dist/ exports to src/index.ts fallback when exact match not found", async () => {
    const result = await analyzeFixture("source-path-fallback");
    const fixtureDir = resolve(FIXTURES_DIR, "source-path-fallback");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/index.ts"),
      `src/index.ts should be resolved from dist/index.js export, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/helper.ts"),
      `src/helper.ts should be reachable from index.ts, got: ${unusedFilePaths}`,
    );
  });

  it("should NOT resolve dist/cli.js to src/cli/index.ts via directory fallback", async () => {
    const result = await analyzeFixture("source-path-fallback");
    const fixtureDir = resolve(FIXTURES_DIR, "source-path-fallback");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/cli/index.ts"),
      `src/cli/index.ts should be unused (no direct src/cli.ts match), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/cli/runner.ts"),
      `src/cli/runner.ts should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should still flag orphan files", async () => {
    const result = await analyzeFixture("source-path-fallback");
    const fixtureDir = resolve(FIXTURES_DIR, "source-path-fallback");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("dash-spec-patterns", () => {
  it("should treat *-spec.ts and *_spec.ts as test entry points with vitest", async () => {
    const result = await analyzeFixture("dash-spec-patterns");
    const fixtureDir = resolve(FIXTURES_DIR, "dash-spec-patterns");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("spec/utils-spec.ts"),
      `utils-spec.ts should be test entry point, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("spec/engine_spec.ts"),
      `engine_spec.ts should be test entry point, got: ${unusedFilePaths}`,
    );
  });

  it("should still flag orphan files", async () => {
    const result = await analyzeFixture("dash-spec-patterns");
    const fixtureDir = resolve(FIXTURES_DIR, "dash-spec-patterns");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("workspace-explicit-entries", () => {
  it("should NOT use default fallback entries when workspace has explicit main field", async () => {
    const result = await analyzeFixture("workspace-explicit-entries");
    const fixtureDir = resolve(FIXTURES_DIR, "workspace-explicit-entries");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("packages/ui/src/index.ts"),
      `packages/ui/src/index.ts should be unused because ui has explicit main=src/button.ts, got: ${unusedFilePaths}`,
    );
  });

  it("should use default fallback entries when workspace has no explicit entries", async () => {
    const result = await analyzeFixture("workspace-explicit-entries");
    const fixtureDir = resolve(FIXTURES_DIR, "workspace-explicit-entries");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("packages/utils/src/index.ts"),
      `packages/utils/src/index.ts should be entry (fallback) since utils has no explicit main, got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan files in packages without explicit entries", async () => {
    const result = await analyzeFixture("workspace-explicit-entries");
    const fixtureDir = resolve(FIXTURES_DIR, "workspace-explicit-entries");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("packages/utils/src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("storybook-project", () => {
  it("should treat .stories.ts files as entry points when @storybook/* is present", async () => {
    const result = await analyzeFixture("storybook-project");
    const fixtureDir = resolve(FIXTURES_DIR, "storybook-project");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/Button.stories.ts"),
      `Button.stories.ts should be entry point, got: ${unusedFilePaths}`,
    );
  });

  it("should treat .storybook config files as entry points", async () => {
    const result = await analyzeFixture("storybook-project");
    const fixtureDir = resolve(FIXTURES_DIR, "storybook-project");
    const unusedFilePaths = relativePaths(result, fixtureDir);
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
    const result = await analyzeFixture("storybook-project");
    const fixtureDir = resolve(FIXTURES_DIR, "storybook-project");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/Button.ts"),
      `Button.ts should be reachable from stories, got: ${unusedFilePaths}`,
    );
  });

  it("should still flag orphan files in storybook projects", async () => {
    const result = await analyzeFixture("storybook-project");
    const fixtureDir = resolve(FIXTURES_DIR, "storybook-project");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("graphql-files", () => {
  it("should track imported graphql files as reachable", async () => {
    const result = await analyzeFixture("graphql-files");
    const fixtureDir = resolve(FIXTURES_DIR, "graphql-files");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/schema.graphql"),
      `schema.graphql is imported and should be reachable, got: ${unusedFilePaths}`,
    );
  });

  it("should flag unused graphql files", async () => {
    const result = await analyzeFixture("graphql-files");
    const fixtureDir = resolve(FIXTURES_DIR, "graphql-files");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/unused.graphql"),
      `unused.graphql should be flagged as unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("nextjs-pages-mdx", () => {
  it("should not treat standalone MDX files in pages/ as entry points", async () => {
    const result = await analyzeFixture("nextjs-pages-mdx");
    const fixtureDir = resolve(FIXTURES_DIR, "nextjs-pages-mdx");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("pages/about.mdx"),
      `about.mdx should be unused (not auto-discovered as page entry), got: ${unusedFilePaths}`,
    );
  });

  it("should still discover TSX files in pages/ as entry points", async () => {
    const result = await analyzeFixture("nextjs-pages-mdx");
    const fixtureDir = resolve(FIXTURES_DIR, "nextjs-pages-mdx");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("pages/index.tsx"),
      `index.tsx should be entry point, got: ${unusedFilePaths}`,
    );
  });

  it("should mark components imported by pages as reachable", async () => {
    const result = await analyzeFixture("nextjs-pages-mdx");
    const fixtureDir = resolve(FIXTURES_DIR, "nextjs-pages-mdx");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/Home.ts"),
      `Home.ts is imported by index.tsx and should be reachable, got: ${unusedFilePaths}`,
    );
  });
});

describe("orm-migrations", () => {
  it("should treat migration files as entry points when ORM is detected", async () => {
    const result = await analyzeFixture("orm-migrations");
    const fixtureDir = resolve(FIXTURES_DIR, "orm-migrations");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("migrations/001-create-users.ts"),
      `migration file should be entry point when knex is present, got: ${unusedFilePaths}`,
    );
  });

  it("should still flag orphan files", async () => {
    const result = await analyzeFixture("orm-migrations");
    const fixtureDir = resolve(FIXTURES_DIR, "orm-migrations");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("migrations-no-orm", () => {
  it("should NOT treat migration files as entry points without ORM dependency", async () => {
    const result = await analyzeFixture("migrations-no-orm");
    const fixtureDir = resolve(FIXTURES_DIR, "migrations-no-orm");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("migrations/001-create-users.ts"),
      `migration file should be unused without ORM, got: ${unusedFilePaths}`,
    );
  });
});

describe("css-imports", () => {
  it("should track CSS files imported from TS as reachable", async () => {
    const result = await analyzeFixture("css-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "css-imports");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/app.css"),
      `app.css is imported by index.ts and should be reachable, got: ${unusedFilePaths}`,
    );
  });

  it("should track CSS @import chains as reachable", async () => {
    const result = await analyzeFixture("css-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "css-imports");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("styles/base.css"),
      `base.css is @imported from app.css and should be reachable, got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan CSS files as unused", async () => {
    const result = await analyzeFixture("css-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "css-imports");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("styles/orphan.css"),
      `orphan.css is not imported and should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("nestjs-project", () => {
  it("should detect NestJS convention files as entry points", async () => {
    const result = await analyzeFixture("nestjs-project");
    const fixtureDir = resolve(FIXTURES_DIR, "nestjs-project");
    const unusedFilePaths = relativePaths(result, fixtureDir);
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
    const result = await analyzeFixture("nestjs-project");
    const fixtureDir = resolve(FIXTURES_DIR, "nestjs-project");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("node-test-runner", () => {
  it("should detect node --test scripts as test entry points", async () => {
    const result = await analyzeFixture("node-test-runner");
    const fixtureDir = resolve(FIXTURES_DIR, "node-test-runner");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/__tests__/main.test.ts"),
      `main.test.ts should be an entry point (node --test runner), got: ${unusedFilePaths}`,
    );
  });

  it("should flag non-test orphan files as unused", async () => {
    const result = await analyzeFixture("node-test-runner");
    const fixtureDir = resolve(FIXTURES_DIR, "node-test-runner");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("config-flag-scripts", () => {
  it("should detect --config flag files as entry points", async () => {
    const result = await analyzeFixture("config-flag-scripts");
    const fixtureDir = resolve(FIXTURES_DIR, "config-flag-scripts");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("db/drizzle.config.ts"),
      `drizzle.config.ts should be entry point (--config flag), got: ${unusedFilePaths}`,
    );
  });

  it("should detect tsx script files as entry points", async () => {
    const result = await analyzeFixture("config-flag-scripts");
    const fixtureDir = resolve(FIXTURES_DIR, "config-flag-scripts");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("scripts/seed.ts"),
      `seed.ts should be entry point (tsx script), got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan files as unused", async () => {
    const result = await analyzeFixture("config-flag-scripts");
    const fixtureDir = resolve(FIXTURES_DIR, "config-flag-scripts");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused (config-flag-scripts), got: ${unusedFilePaths}`,
    );
  });
});

describe("i18n-project", () => {
  it("should mark locale JSON files as always-used when i18next is a dependency", async () => {
    const result = await analyzeFixture("i18n-project");
    const fixtureDir = resolve(FIXTURES_DIR, "i18n-project");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("public/locales/en.json"),
      `en.json should be always-used (i18next locale), got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan files as unused", async () => {
    const result = await analyzeFixture("i18n-project");
    const fixtureDir = resolve(FIXTURES_DIR, "i18n-project");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused (i18n-project), got: ${unusedFilePaths}`,
    );
  });
});

describe("standalone-subproject-excluded", () => {
  it("should still scan standalone sub-project files and report unused", async () => {
    const result = await analyzeFixture("standalone-subproject-excluded");
    const fixtureDir = resolve(FIXTURES_DIR, "standalone-subproject-excluded");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.some((filePath: string) => filePath.startsWith("docs/")),
      `docs/ files should still be scanned (matching fallow behavior), got: ${unusedFilePaths}`,
    );
  });

  it("should still detect unused files in the main app", async () => {
    const result = await analyzeFixture("standalone-subproject-excluded");
    const fixtureDir = resolve(FIXTURES_DIR, "standalone-subproject-excluded");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("app/src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("build-script-source-map", () => {
  it("should resolve build/ script references to src/ source files", async () => {
    const result = await analyzeFixture("build-script-source-map");
    const fixtureDir = resolve(FIXTURES_DIR, "build-script-source-map");
    const unusedFilePaths = relativePaths(result, fixtureDir);
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
    const result = await analyzeFixture("build-script-source-map");
    const fixtureDir = resolve(FIXTURES_DIR, "build-script-source-map");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("tsconfig-path-alias-wildcard", () => {
  it("should resolve wildcard * path alias that shadows Node.js built-in modules", async () => {
    const result = await analyzeFixture("tsconfig-path-alias-wildcard");
    const fixtureDir = resolve(FIXTURES_DIR, "tsconfig-path-alias-wildcard");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/constants/api.ts"),
      `constants/api.ts should be resolved via wildcard path alias, got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan files as unused", async () => {
    const result = await analyzeFixture("tsconfig-path-alias-wildcard");
    const fixtureDir = resolve(FIXTURES_DIR, "tsconfig-path-alias-wildcard");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused (wildcard alias), got: ${unusedFilePaths}`,
    );
  });
});

describe("scss-partials", () => {
  it("should resolve SCSS partial imports with underscore prefix", async () => {
    const result = await analyzeFixture("scss-partials");
    const fixtureDir = resolve(FIXTURES_DIR, "scss-partials");
    const unusedFilePaths = relativePaths(result, fixtureDir);
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
    const result = await analyzeFixture("scss-partials");
    const fixtureDir = resolve(FIXTURES_DIR, "scss-partials");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/styles/_orphan.scss"),
      `_orphan.scss should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("custom-test-extensions", () => {
  it("should recognize .clienttest and .servertest as vitest test files", async () => {
    const result = await analyzeFixture("custom-test-extensions");
    const fixtureDir = resolve(FIXTURES_DIR, "custom-test-extensions");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/utils.clienttest.ts"),
      `.clienttest.ts should be used (vitest custom test), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/api.servertest.ts"),
      `.servertest.ts should be used (vitest custom test), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/__e2e__/login.test.ts"),
      `__e2e__ test should be used (vitest e2e dir), got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan files as unused", async () => {
    const result = await analyzeFixture("custom-test-extensions");
    const fixtureDir = resolve(FIXTURES_DIR, "custom-test-extensions");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("vue-sfc", () => {
  it("should follow imports inside Vue SFC script blocks", async () => {
    const result = await analyzeFixture("vue-sfc");
    const fixtureDir = resolve(FIXTURES_DIR, "vue-sfc");
    const unusedFilePaths = relativePaths(result, fixtureDir);
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
    const result = await analyzeFixture("vue-sfc");
    const fixtureDir = resolve(FIXTURES_DIR, "vue-sfc");
    const unusedFilePaths = relativePaths(result, fixtureDir);
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

describe("vite-entry", () => {
  it("should detect entry points from vite.config rollupOptions.input", async () => {
    const result = await analyzeFixture("vite-entry");
    const fixtureDir = resolve(FIXTURES_DIR, "vite-entry");
    const unusedFilePaths = relativePaths(result, fixtureDir);
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
    const result = await analyzeFixture("vite-entry");
    const fixtureDir = resolve(FIXTURES_DIR, "vite-entry");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("outdir-source-map", () => {
  it("should resolve built paths back to source via tsconfig outDir", async () => {
    const result = await analyzeFixture("outdir-source-map");
    const fixtureDir = resolve(FIXTURES_DIR, "outdir-source-map");
    const unusedFilePaths = relativePaths(result, fixtureDir);
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
    const result = await analyzeFixture("outdir-source-map");
    const fixtureDir = resolve(FIXTURES_DIR, "outdir-source-map");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("main/orphan.ts"),
      `main/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

test("should resolve imports with query parameters (e.g. ?url, ?raw, ?worker)", async () => {
  const result = await analyzeFixture("query-param-imports");
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
  const result = await analyzeFixture("query-param-imports");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("orphan.ts")),
    `orphan.ts should be unused, got unused: ${unusedFilePaths}`,
  );
});

test("should detect script entry points with --key value flag pairs", async () => {
  const result = await analyzeFixture("script-flag-args");
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
  const result = await analyzeFixture("angular-workspace");
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
});

test("should resolve #hash subpath imports via tsconfig paths with .js extension", async () => {
  const result = await analyzeFixture("subpath-imports");
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

test("should detect vitest setupFiles as entry points", async () => {
  const result = await analyzeFixture("vitest-setup-files");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("test/setup.ts")),
    `test/setup.ts should NOT be unused (referenced in vitest.config.ts setupFiles), got unused: ${unusedFilePaths}`,
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
  const result = await analyzeFixture("new-url-worker");
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
  const result = await analyzeFixture("config-multi-segment");
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

test("should detect jest moduleNameMapper files and __mocks__ as entries", async () => {
  const result = await analyzeFixture("jest-module-mapper");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("__mocks__/styleMock.js")),
    `styleMock.js should NOT be unused (referenced in moduleNameMapper), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("__mocks__/fileMock.js")),
    `fileMock.js should NOT be unused (referenced in moduleNameMapper), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("orphan.ts")),
    `orphan.ts should be unused (not imported), got unused: ${unusedFilePaths}`,
  );
});

test("should resolve CSS files imported via tsconfig path aliases", async () => {
  const result = await analyzeFixture("css-path-alias");
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
  const result = await analyzeFixture("nextjs-empty-tsconfig");
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

describe("docusaurus-content", () => {
  it("should exclude docs/ and blog/ content directories from file discovery", async () => {
    const result = await analyzeFixture("docusaurus-content");
    const fixtureDir = resolve(FIXTURES_DIR, "docusaurus-content");
    const unusedFilePaths = relativePaths(result, fixtureDir);
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
  const result = await analyzeFixture("react-native-platform");
  const fixtureDir = resolve(FIXTURES_DIR, "react-native-platform");
  const unusedFilePaths = relativePaths(result, fixtureDir);
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

it("should mark config files in non-workspace directories as always used via global patterns", async () => {
  const result = await analyzeFixture("global-config-patterns");
  const fixtureDir = resolve(FIXTURES_DIR, "global-config-patterns");
  const unusedFilePaths = relativePaths(result, fixtureDir);
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
  const result = await analyzeFixture("dynamic-import-template");
  const fixtureDir = resolve(FIXTURES_DIR, "dynamic-import-template");
  const unusedFilePaths = relativePaths(result, fixtureDir);
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
  const result = await analyzeFixture("exports-ts-to-tsx");
  const fixtureDir = resolve(FIXTURES_DIR, "exports-ts-to-tsx");
  const unusedFilePaths = relativePaths(result, fixtureDir);
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
  const result = await analyzeFixture("exports-js-to-ts");
  const fixtureDir = resolve(FIXTURES_DIR, "exports-js-to-ts");
  const unusedFilePaths = relativePaths(result, fixtureDir);
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
  const result = await analyzeFixture("ci-workflow-scripts");
  const fixtureDir = resolve(FIXTURES_DIR, "ci-workflow-scripts");
  const unusedFilePaths = relativePaths(result, fixtureDir);
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
  const result = await analyzeFixture("next-config-global");
  const fixtureDir = resolve(FIXTURES_DIR, "next-config-global");
  const unusedFilePaths = relativePaths(result, fixtureDir);
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
  const result = await analyzeFixture("script-glob-entries");
  const fixtureDir = resolve(FIXTURES_DIR, "script-glob-entries");
  const unusedFilePaths = relativePaths(result, fixtureDir);
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
  const result = await analyzeFixture("config-file-exclusion");
  const fixtureDir = resolve(FIXTURES_DIR, "config-file-exclusion");
  const unusedFilePaths = relativePaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("vitest.config.ts"),
    `vitest.config.ts should be excluded as config file, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("sanity.config.ts"),
    `sanity.config.ts should be excluded as config file, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("sanity.cli.ts"),
    `sanity.cli.ts should be excluded as config file, got unused: ${unusedFilePaths}`,
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

it("should detect vi.mock and jest.mock as import edges", async () => {
  const result = await analyzeFixture("test-mock-imports");
  const fixtureDir = resolve(FIXTURES_DIR, "test-mock-imports");
  const unusedFilePaths = relativePaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/mocked-util.ts"),
    `mocked-util.ts should not be unused (referenced via vi.mock), got: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should still be flagged as unused, got: ${unusedFilePaths}`,
  );
});

test("should not treat all .github files as entries, only CI-referenced scripts", async () => {
  const result = await analyzeFixture("github-actions-scripts");
  const fixtureDir = resolve(FIXTURES_DIR, "github-actions-scripts");
  const unusedFilePaths = relativePaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith(".github/actions/deploy/run.js")),
    `run.js should NOT be unused (referenced in CI workflow), got: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith(".github/actions/deploy/unused-helper.js")),
    `unused-helper.js should be unused (not referenced anywhere), got: ${unusedFilePaths}`,
  );
});

test("should resolve workspace dist paths to source and not mark dist as entries", async () => {
  const result = await analyzeFixture("workspace-dist-resolution");
  const fixtureDir = resolve(FIXTURES_DIR, "workspace-dist-resolution");
  const unusedFilePaths = relativePaths(result, fixtureDir);
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
  const result = await analyzeFixture("generated-spec-files");
  const fixtureDir = resolve(FIXTURES_DIR, "generated-spec-files");
  const unusedFilePaths = relativePaths(result, fixtureDir);
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("types.spec.gen.ts")),
    `types.spec.gen.ts should be unused (generated file, not a test), got: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("schema.gen.ts")),
    `schema.gen.ts should be unused (generated file, not imported), got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("index.test.ts")),
    `index.test.ts should NOT be unused (real test file), got: ${unusedFilePaths}`,
  );
});

test("should not treat formatter/linter glob targets as entry points", async () => {
  const result = await analyzeFixture("formatter-glob-scripts");
  const fixtureDir = resolve(FIXTURES_DIR, "formatter-glob-scripts");
  const unusedFilePaths = relativePaths(result, fixtureDir);
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
  const result = await analyzeFixture("framework-gating/no-framework");
  const fixtureDir = resolve(FIXTURES_DIR, "framework-gating/no-framework");
  const unusedFilePaths = relativePaths(result, fixtureDir);
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
  const result = await analyzeFixture("framework-gating/with-nextjs");
  const fixtureDir = resolve(FIXTURES_DIR, "framework-gating/with-nextjs");
  const unusedFilePaths = relativePaths(result, fixtureDir);
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
  const result = await analyzeFixture("framework-gating/with-react-router");
  const fixtureDir = resolve(FIXTURES_DIR, "framework-gating/with-react-router");
  const unusedFilePaths = relativePaths(result, fixtureDir);
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

describe("sub-project-workspace", () => {
  it("should not activate framework detection for sub-project children", async () => {
    const result = await analyzeFixture("sub-project-workspace");
    const fixtureDir = resolve(FIXTURES_DIR, "sub-project-workspace");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("app/packages/core/app/page.ts"),
      `app/packages/core/app/page.ts should be unused (Next.js detection should not activate for sub-project children), got: ${unusedFilePaths}`,
    );
  });

  it("should not add sub-project child package entry files as global entries", async () => {
    const result = await analyzeFixture("sub-project-workspace");
    const fixtureDir = resolve(FIXTURES_DIR, "sub-project-workspace");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("app/packages/icons/src/index.ts"),
      `app/packages/icons/src/index.ts should be unused (not an entry when root has no workspace patterns), got: ${unusedFilePaths}`,
    );
  });

  it("should still detect files under sub-project children as unused", async () => {
    const result = await analyzeFixture("sub-project-workspace");
    const fixtureDir = resolve(FIXTURES_DIR, "sub-project-workspace");
    const unusedFilePaths = relativePaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("app/packages/core/src/unused-util.ts"),
      `app/packages/core/src/unused-util.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});
