import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { analyze, defineConfig } from "../src/index.js";
import type { ScanResult, SemanticConfig } from "../src/types.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "fixtures");

const scanFixtureWithSemantic = async (
  fixtureName: string,
  semanticOverrides: Partial<SemanticConfig> = {},
  extraConfigOverrides: Record<string, unknown> = {},
): Promise<ScanResult> => {
  return analyze(
    defineConfig({
      rootDir: resolve(FIXTURES_DIR, fixtureName),
      semantic: { enabled: true, ...semanticOverrides },
      ...extraConfigOverrides,
    }),
  );
};

const unusedTypeNames = (result: ScanResult): string[] =>
  result.unusedTypes.map((unusedType) => unusedType.name).sort();

describe("semantic (Phase 0)", () => {
  it("populates unusedTypes as [] by default (semantic disabled)", async () => {
    const result = await analyze(defineConfig({ rootDir: resolve(FIXTURES_DIR, "simple-app") }));
    assert.deepEqual(result.unusedTypes, []);
  });

  it("does not crash when semantic.enabled is true on a project without tsconfig", async () => {
    const result = await analyze(
      defineConfig({
        rootDir: resolve(FIXTURES_DIR, "simple-app"),
        semantic: { enabled: true },
      }),
    );
    assert.ok(Array.isArray(result.unusedTypes), "unusedTypes must be an array");
    assert.equal(result.unusedTypes.length, 0, "Phase 0 returns no findings yet");
  });

  it("preserves all pre-existing ScanResult fields when semantic is enabled", async () => {
    const result = await analyze(
      defineConfig({
        rootDir: resolve(FIXTURES_DIR, "simple-app"),
        semantic: { enabled: true },
      }),
    );
    assert.ok(Array.isArray(result.unusedFiles));
    assert.ok(Array.isArray(result.unusedExports));
    assert.ok(Array.isArray(result.unusedDependencies));
    assert.ok(Array.isArray(result.circularDependencies));
    assert.equal(typeof result.totalFiles, "number");
    assert.equal(typeof result.totalExports, "number");
    assert.equal(typeof result.analysisTimeMs, "number");
  });

  it("respects defineConfig defaults: semantic is undefined when not provided", async () => {
    const config = defineConfig({ rootDir: resolve(FIXTURES_DIR, "simple-app") });
    assert.equal(config.semantic, undefined);
  });

  it("fills semantic defaults when {} passed", async () => {
    const config = defineConfig({
      rootDir: resolve(FIXTURES_DIR, "simple-app"),
      semantic: {},
    });
    assert.ok(config.semantic, "semantic should be set");
    assert.equal(config.semantic.enabled, false);
    assert.equal(config.semantic.reportUnusedTypes, true);
    assert.equal(config.semantic.reportUnusedEnumMembers, true);
    assert.equal(config.semantic.reportMisclassifiedDependencies, true);
    assert.equal(config.semantic.reportRedundantVariableAliases, true);
    assert.equal(config.semantic.reportUnusedClassMembers, false);
    assert.ok(Array.isArray(config.semantic.decoratorAllowlist));
    assert.ok(config.semantic.decoratorAllowlist.length > 0);
  });
});

describe("semantic / unused-types: P0 basic", () => {
  it("flags interface and type-alias with no references", async () => {
    const result = await scanFixtureWithSemantic("unused-types-basic");
    const found = unusedTypeNames(result);
    assert.deepEqual(found, ["UnusedAlias", "UnusedType"]);
  });

  it("does NOT flag types that have at least one referencing import", async () => {
    const result = await scanFixtureWithSemantic("unused-types-basic");
    const found = unusedTypeNames(result);
    assert.ok(!found.includes("UsedType"));
    assert.ok(!found.includes("UsedAlias"));
  });

  it("classifies kinds correctly (interface vs type-alias)", async () => {
    const result = await scanFixtureWithSemantic("unused-types-basic");
    const byName = new Map(result.unusedTypes.map((unusedType) => [unusedType.name, unusedType]));
    assert.equal(byName.get("UnusedType")?.kind, "interface");
    assert.equal(byName.get("UnusedAlias")?.kind, "type-alias");
  });

  it("populates trace with declaration site + reference counts", async () => {
    const result = await scanFixtureWithSemantic("unused-types-basic");
    const target = result.unusedTypes.find((unusedType) => unusedType.name === "UnusedType");
    assert.ok(target);
    assert.ok(target.trace.length > 0, "trace should be populated");
    assert.ok(
      target.trace[0].includes("UnusedType"),
      `first trace entry should mention the type, got: ${target.trace[0]}`,
    );
  });
});

describe("semantic / unused-types: nested references should NOT flag inner types", () => {
  it("does NOT flag Inner referenced only inside Outer's body", async () => {
    const result = await scanFixtureWithSemantic("unused-types-nested");
    const found = unusedTypeNames(result);
    assert.ok(!found.includes("Inner"), `Inner is used inside Outer, got: ${found}`);
    assert.ok(!found.includes("Outer"), `Outer is imported by entry, got: ${found}`);
  });

  it("still flags truly-unused types in the same module", async () => {
    const result = await scanFixtureWithSemantic("unused-types-nested");
    assert.ok(unusedTypeNames(result).includes("DeadDeep"));
  });
});

describe("semantic / unused-types: heritage clauses", () => {
  it("does NOT flag Parent when only Child is referenced (extends keeps Parent alive)", async () => {
    const result = await scanFixtureWithSemantic("unused-types-extends");
    const found = unusedTypeNames(result);
    assert.ok(!found.includes("Parent"), `Parent is extended by Child, got: ${found}`);
    assert.ok(!found.includes("Child"));
  });

  it("flags OrphanInterface with no references", async () => {
    const result = await scanFixtureWithSemantic("unused-types-extends");
    assert.ok(unusedTypeNames(result).includes("OrphanInterface"));
  });
});

describe("semantic / unused-types: re-export chains", () => {
  it("does NOT flag types reachable through 3-hop re-export chain", async () => {
    const result = await scanFixtureWithSemantic("unused-types-reexport-chain");
    const found = unusedTypeNames(result);
    assert.ok(!found.includes("TripleHopUsed"), `TripleHopUsed reaches entry, got: ${found}`);
  });

  it("flags TripleHopDead which has zero non-re-export references", async () => {
    const result = await scanFixtureWithSemantic("unused-types-reexport-chain");
    assert.ok(unusedTypeNames(result).includes("TripleHopDead"));
  });

  it("marks confidence as medium when only re-export references exist", async () => {
    const result = await scanFixtureWithSemantic("unused-types-reexport-chain");
    const target = result.unusedTypes.find((unusedType) => unusedType.name === "TripleHopDead");
    assert.equal(target?.confidence, "medium");
  });
});

describe("semantic / unused-types: declaration merging", () => {
  it("does NOT flag any branch of a merged interface when the merged symbol is referenced", async () => {
    const result = await scanFixtureWithSemantic("unused-types-decl-merge");
    const found = unusedTypeNames(result);
    assert.ok(!found.includes("MergedConfig"), `MergedConfig branches must not flag, got: ${found}`);
  });

  it("flags non-merged dead types alongside merged-and-used types", async () => {
    const result = await scanFixtureWithSemantic("unused-types-decl-merge");
    assert.ok(unusedTypeNames(result).includes("SoloDead"));
  });
});

describe("semantic / unused-types: generics", () => {
  it("does NOT flag a type used only as a generic constraint", async () => {
    const result = await scanFixtureWithSemantic("unused-types-generics");
    const found = unusedTypeNames(result);
    assert.ok(!found.includes("Identifiable"), `Identifiable is a constraint, got: ${found}`);
    assert.ok(!found.includes("Box"));
  });

  it("flags DeadBox with no references at all", async () => {
    const result = await scanFixtureWithSemantic("unused-types-generics");
    assert.ok(unusedTypeNames(result).includes("DeadBox"));
  });
});

describe("semantic / unused-types: import type", () => {
  it("does NOT flag type referenced via import type", async () => {
    const result = await scanFixtureWithSemantic("unused-types-import-type");
    const found = unusedTypeNames(result);
    assert.ok(!found.includes("ReturnedShape"));
  });

  it("flags NeverImported truly dead type-alias", async () => {
    const result = await scanFixtureWithSemantic("unused-types-import-type");
    assert.ok(unusedTypeNames(result).includes("NeverImported"));
  });
});

describe("semantic / unused-types: JSDoc references", () => {
  it("does NOT flag a type referenced only from JSDoc @param annotations", async () => {
    const result = await scanFixtureWithSemantic("unused-types-jsdoc");
    const found = unusedTypeNames(result);
    assert.ok(
      !found.includes("JsDocConsumed"),
      `JsDocConsumed is used via JSDoc import("./types.js"), got: ${found}`,
    );
  });

  it("does NOT flag a type imported via regular TS import alongside JSDoc usage", async () => {
    const result = await scanFixtureWithSemantic("unused-types-jsdoc");
    assert.ok(!unusedTypeNames(result).includes("RegularImported"));
  });

  it("flags NeverReferenced as unused inside a JSDoc-aware project", async () => {
    const result = await scanFixtureWithSemantic("unused-types-jsdoc");
    assert.ok(unusedTypeNames(result).includes("NeverReferenced"));
  });
});

describe("semantic / unused-types: entry export gating", () => {
  it("respects includeEntryExports=false: never flags top-level entry exports", async () => {
    const result = await scanFixtureWithSemantic("unused-types-entry-export");
    assert.deepEqual(unusedTypeNames(result), []);
  });

  it("includeEntryExports=true flags dead types declared in the entry file", async () => {
    const result = await scanFixtureWithSemantic(
      "unused-types-entry-export",
      {},
      { includeEntryExports: true },
    );
    const found = unusedTypeNames(result);
    assert.ok(found.includes("DeadEntryType"));
    assert.ok(!found.includes("PublicApiShape"), "PublicApiShape used by callApi");
  });

  it("respects reportUnusedTypes=false: skips type detection entirely", async () => {
    const result = await scanFixtureWithSemantic(
      "unused-types-basic",
      { reportUnusedTypes: false },
    );
    assert.deepEqual(result.unusedTypes, []);
  });
});

const misclassifiedNames = (result: ScanResult): string[] =>
  result.misclassifiedDependencies.map((finding) => finding.name).sort();

describe("semantic / misclassified-dependencies", () => {
  it("populates the additive misclassifiedDependencies field as [] when semantic disabled", async () => {
    const result = await analyze(
      defineConfig({ rootDir: resolve(FIXTURES_DIR, "misclassified-deps-typeonly") }),
    );
    assert.deepEqual(result.misclassifiedDependencies, []);
  });

  it("flags dependencies that are only consumed via `import type`", async () => {
    const result = await scanFixtureWithSemantic(
      "misclassified-deps-typeonly",
      { reportUnusedTypes: false },
    );
    const names = misclassifiedNames(result);
    assert.ok(
      names.includes("type-only-lib"),
      `type-only-lib should be flagged, got: ${names}`,
    );
  });

  it("flags dependencies that are only consumed via `export type ... from`", async () => {
    const result = await scanFixtureWithSemantic(
      "misclassified-deps-typeonly",
      { reportUnusedTypes: false },
    );
    assert.ok(misclassifiedNames(result).includes("reexported-type-lib"));
  });

  it("does NOT flag dependencies imported with value bindings", async () => {
    const result = await scanFixtureWithSemantic(
      "misclassified-deps-typeonly",
      { reportUnusedTypes: false },
    );
    const names = misclassifiedNames(result);
    assert.ok(!names.includes("value-used-lib"), `value-used-lib used at runtime, got: ${names}`);
  });

  it("does NOT flag side-effect imports (always runtime)", async () => {
    const result = await scanFixtureWithSemantic(
      "misclassified-deps-typeonly",
      { reportUnusedTypes: false },
    );
    assert.ok(!misclassifiedNames(result).includes("side-effect-lib"));
  });

  it("does NOT flag mixed-use packages (any value import wins)", async () => {
    const result = await scanFixtureWithSemantic(
      "misclassified-deps-typeonly",
      { reportUnusedTypes: false },
    );
    assert.ok(!misclassifiedNames(result).includes("mixed-use-lib"));
  });

  it("does NOT flag value re-exports `export { x } from`", async () => {
    const result = await scanFixtureWithSemantic(
      "misclassified-deps-typeonly",
      { reportUnusedTypes: false },
    );
    assert.ok(!misclassifiedNames(result).includes("reexported-value-lib"));
  });

  it("includes a trace with at least one import site path", async () => {
    const result = await scanFixtureWithSemantic(
      "misclassified-deps-typeonly",
      { reportUnusedTypes: false },
    );
    const finding = result.misclassifiedDependencies.find(
      (entry) => entry.name === "type-only-lib",
    );
    assert.ok(finding);
    assert.ok(finding.trace.length > 0);
    assert.ok(
      finding.trace[0].includes("src/index.ts"),
      `expected trace to mention src/index.ts, got: ${finding.trace[0]}`,
    );
  });

  it("marks suggestedAs as devDependencies for all current findings", async () => {
    const result = await scanFixtureWithSemantic(
      "misclassified-deps-typeonly",
      { reportUnusedTypes: false },
    );
    for (const finding of result.misclassifiedDependencies) {
      assert.equal(finding.suggestedAs, "devDependencies");
    }
  });

  it("respects reportMisclassifiedDependencies=false", async () => {
    const result = await scanFixtureWithSemantic(
      "misclassified-deps-typeonly",
      { reportUnusedTypes: false, reportMisclassifiedDependencies: false },
    );
    assert.deepEqual(result.misclassifiedDependencies, []);
  });
});

const enumMemberLabels = (result: ScanResult): string[] =>
  result.unusedEnumMembers
    .map((finding) => `${finding.enumName}.${finding.memberName}`)
    .sort();

describe("semantic / unused-enum-members: string enum", () => {
  it("flags unreferenced members with high confidence", async () => {
    const result = await scanFixtureWithSemantic("unused-enum-members-string", {
      reportUnusedTypes: false,
      reportMisclassifiedDependencies: false,
    });
    const labels = enumMemberLabels(result);
    assert.deepEqual(labels, ["Status.Archived", "Status.Deprecated"]);
    for (const finding of result.unusedEnumMembers) {
      assert.equal(finding.confidence, "high");
    }
  });

  it("does NOT flag members that are referenced via dot access", async () => {
    const result = await scanFixtureWithSemantic("unused-enum-members-string", {
      reportUnusedTypes: false,
      reportMisclassifiedDependencies: false,
    });
    const labels = enumMemberLabels(result);
    assert.ok(!labels.includes("Status.Active"));
    assert.ok(!labels.includes("Status.Pending"));
  });
});

describe("semantic / unused-enum-members: numeric enum", () => {
  it("flags unreferenced numeric members with medium confidence", async () => {
    const result = await scanFixtureWithSemantic("unused-enum-members-numeric", {
      reportUnusedTypes: false,
      reportMisclassifiedDependencies: false,
    });
    const labels = enumMemberLabels(result);
    assert.deepEqual(labels, ["Level.High", "Level.Low", "Level.Medium"]);
    for (const finding of result.unusedEnumMembers) {
      assert.equal(finding.confidence, "medium");
    }
  });
});

describe("semantic / unused-enum-members: reverse-lookup pattern", () => {
  it("does NOT flag any member when Enum[X] computed access exists", async () => {
    const result = await scanFixtureWithSemantic("unused-enum-members-reverse-lookup", {
      reportUnusedTypes: false,
      reportMisclassifiedDependencies: false,
    });
    assert.deepEqual(result.unusedEnumMembers, []);
  });
});

describe("semantic / unused-enum-members: const enum", () => {
  it("flags unreferenced const-enum members with low confidence (inlining caveat)", async () => {
    const result = await scanFixtureWithSemantic("unused-enum-members-const", {
      reportUnusedTypes: false,
      reportMisclassifiedDependencies: false,
    });
    const labels = enumMemberLabels(result);
    assert.deepEqual(labels, ["Flags.Execute", "Flags.None"]);
    for (const finding of result.unusedEnumMembers) {
      assert.equal(finding.confidence, "low");
    }
  });
});

describe("semantic / unused-enum-members: feature flag", () => {
  it("respects reportUnusedEnumMembers=false", async () => {
    const result = await scanFixtureWithSemantic("unused-enum-members-string", {
      reportUnusedTypes: false,
      reportUnusedEnumMembers: false,
      reportMisclassifiedDependencies: false,
    });
    assert.deepEqual(result.unusedEnumMembers, []);
  });

  it("populates the additive unusedEnumMembers field as [] when semantic disabled", async () => {
    const result = await analyze(
      defineConfig({
        rootDir: resolve(FIXTURES_DIR, "unused-enum-members-string"),
      }),
    );
    assert.deepEqual(result.unusedEnumMembers, []);
  });
});

const scanFixtureSyntactic = async (fixtureName: string): Promise<ScanResult> =>
  analyze(defineConfig({ rootDir: resolve(FIXTURES_DIR, fixtureName) }));

const redundantAliasKinds = (result: ScanResult): Array<{ kind: string; name: string }> =>
  result.redundantAliases
    .map((finding) => ({ kind: finding.kind, name: finding.name }))
    .sort((leftEntry, rightEntry) =>
      `${leftEntry.kind}/${leftEntry.name}`.localeCompare(`${rightEntry.kind}/${rightEntry.name}`),
    );

describe("redundancy / self-aliases (syntactic, default-on)", () => {
  it("flags import { x as x }", async () => {
    const result = await scanFixtureSyntactic("redundant-aliases-self");
    const found = redundantAliasKinds(result);
    assert.ok(
      found.some((entry) => entry.kind === "import-self-alias" && entry.name === "usedThing"),
      `expected import-self-alias for usedThing, got: ${JSON.stringify(found)}`,
    );
  });

  it("flags export { x as x }", async () => {
    const result = await scanFixtureSyntactic("redundant-aliases-self");
    const found = redundantAliasKinds(result);
    assert.ok(
      found.some((entry) => entry.kind === "export-self-alias" && entry.name === "reusedLocal"),
    );
  });

  it("flags export { x as x } from ...", async () => {
    const result = await scanFixtureSyntactic("redundant-aliases-self");
    const found = redundantAliasKinds(result);
    assert.ok(
      found.some(
        (entry) => entry.kind === "reexport-self-alias" && entry.name === "reExportedThrough",
      ),
    );
  });

  it("does NOT flag legitimate renaming aliases", async () => {
    const result = await scanFixtureSyntactic("redundant-aliases-self");
    const found = redundantAliasKinds(result);
    assert.ok(
      !found.some((entry) => entry.name === "betterName"),
      `betterName is a real rename, must not flag, got: ${JSON.stringify(found)}`,
    );
    assert.ok(
      !found.some((entry) => entry.name === "renamedUsedThing"),
      `renamedUsedThing is a real rename, must not flag, got: ${JSON.stringify(found)}`,
    );
  });

  it("respects reportRedundancy=false", async () => {
    const result = await analyze(
      defineConfig({
        rootDir: resolve(FIXTURES_DIR, "redundant-aliases-self"),
        reportRedundancy: false,
      }),
    );
    assert.deepEqual(result.redundantAliases, []);
    assert.deepEqual(result.duplicateExports, []);
  });
});

describe("redundancy / variable aliases (semantic)", () => {
  it("flags const x = y when y has no other consumer", async () => {
    const result = await scanFixtureWithSemantic("redundant-aliases-variable", {
      reportUnusedTypes: false,
      reportUnusedEnumMembers: false,
      reportMisclassifiedDependencies: false,
    });
    const variableAliases = result.redundantAliases.filter(
      (entry) => entry.kind === "variable-alias",
    );
    const names = variableAliases.map((entry) => entry.name).sort();
    assert.ok(
      names.includes("renamedOnce"),
      `renamedOnce should be flagged (only consumer of ARRIVED_AT_VALUE), got: ${names}`,
    );
  });

  it("does NOT flag a variable alias when the source has other consumers", async () => {
    const result = await scanFixtureWithSemantic("redundant-aliases-variable", {
      reportUnusedTypes: false,
      reportUnusedEnumMembers: false,
      reportMisclassifiedDependencies: false,
    });
    const variableAliases = result.redundantAliases.filter(
      (entry) => entry.kind === "variable-alias",
    );
    const names = variableAliases.map((entry) => entry.name).sort();
    assert.ok(
      !names.includes("sharedAlias"),
      `sharedAlias' source SHARED_VALUE is also consumed directly — must not flag, got: ${names}`,
    );
  });

  it("respects reportRedundantVariableAliases=false", async () => {
    const result = await scanFixtureWithSemantic("redundant-aliases-variable", {
      reportUnusedTypes: false,
      reportUnusedEnumMembers: false,
      reportMisclassifiedDependencies: false,
      reportRedundantVariableAliases: false,
    });
    const variableAliases = result.redundantAliases.filter(
      (entry) => entry.kind === "variable-alias",
    );
    assert.deepEqual(variableAliases, []);
  });
});

describe("redundancy / duplicate exports", () => {
  it("flags barrels that export the same name from multiple sources", async () => {
    const result = await scanFixtureSyntactic("duplicate-exports-barrel");
    const names = result.duplicateExports.map((entry) => entry.name).sort();
    assert.ok(names.includes("shared"), `shared exported twice from barrel.ts, got: ${names}`);
  });

  it("does NOT flag uniquely-named re-exports", async () => {
    const result = await scanFixtureSyntactic("duplicate-exports-barrel");
    const names = result.duplicateExports.map((entry) => entry.name).sort();
    assert.ok(!names.includes("aOnly"));
    assert.ok(!names.includes("bOnly"));
  });

  it("records each occurrence with line + reExportSource", async () => {
    const result = await scanFixtureSyntactic("duplicate-exports-barrel");
    const sharedFinding = result.duplicateExports.find((entry) => entry.name === "shared");
    assert.ok(sharedFinding);
    assert.equal(sharedFinding.occurrences.length, 2);
    for (const occurrence of sharedFinding.occurrences) {
      assert.ok(occurrence.isReExport);
      assert.ok(occurrence.reExportSource);
    }
  });
});
