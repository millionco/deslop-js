import { describe, it } from "node:test";
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

  it("should flag bar as unused (re-exported but never imported)", async () => {
    const result = await analyzeFixture("barrel-exports");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(allUnusedNames.includes("bar"), `bar should be unused, got: ${allUnusedNames}`);
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

  it("should flag UnusedComponent", async () => {
    const result = await analyzeFixture("barrel-unused-reexports");
    const allUnusedNames = unusedExportNames(result);
    assert.ok(allUnusedNames.includes("UnusedComponent"), `UnusedComponent should be unused, got: ${allUnusedNames}`);
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
