import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { analyze, defineConfig } from "../src/index.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "fixtures");

const SEMANTIC_ON = process.env.DESLOP_TEST_SEMANTIC !== "off";

describe("semantic pipeline smoke (env-gated)", () => {
  it("returns empty unusedTypes when semantic is disabled (default)", async () => {
    const fixtureDir = resolve(FIXTURES_DIR, "simple-app");
    const config = defineConfig({ rootDir: fixtureDir });
    const result = await analyze(config);
    assert.deepEqual(result.unusedTypes, [], "default config keeps unusedTypes empty");
    assert.deepEqual(result.unusedEnumMembers, [], "unusedEnumMembers empty by default");
    assert.deepEqual(result.unusedClassMembers, [], "unusedClassMembers empty by default");
    assert.deepEqual(result.privateTypeLeaks, [], "privateTypeLeaks empty by default");
    assert.deepEqual(result.unusedParameters, [], "unusedParameters empty by default");
    assert.deepEqual(
      result.duplicateTypeDefinitions,
      [],
      "duplicateTypeDefinitions empty by default",
    );
    assert.deepEqual(result.redundantExports, [], "redundantExports empty by default");
    assert.deepEqual(
      result.misclassifiedDependencies,
      [],
      "misclassifiedDependencies empty by default",
    );
  });

  it("no-op pass when semantic.enabled is true but every report flag is false", async (testContext) => {
    if (!SEMANTIC_ON) {
      testContext.diagnostic("DESLOP_TEST_SEMANTIC=off; skipping semantic-on tests");
      return;
    }
    const fixtureDir = resolve(FIXTURES_DIR, "unused-types-basic");
    const config = defineConfig({
      rootDir: fixtureDir,
      semantic: {
        enabled: true,
        reportUnusedTypes: false,
        reportUnusedEnumMembers: false,
        reportUnusedClassMembers: false,
        reportPrivateTypeLeaks: false,
        reportUnusedParameters: false,
        reportDuplicateTypeDefinitions: false,
        reportRedundantExports: false,
        reportMisclassifiedDependencies: false,
      },
    });
    const result = await analyze(config);
    assert.deepEqual(result.unusedTypes, [], "no rules enabled → no findings");
    assert.deepEqual(result.unusedEnumMembers, []);
    assert.deepEqual(result.unusedClassMembers, []);
    assert.deepEqual(result.privateTypeLeaks, []);
    assert.deepEqual(result.unusedParameters, []);
    assert.deepEqual(result.duplicateTypeDefinitions, []);
  });

  it("degrades gracefully when no tsconfig is present", async (testContext) => {
    if (!SEMANTIC_ON) {
      testContext.diagnostic("DESLOP_TEST_SEMANTIC=off; skipping semantic-on tests");
      return;
    }
    const fixtureDir = resolve(FIXTURES_DIR, "simple-app");
    const config = defineConfig({
      rootDir: fixtureDir,
      semantic: {
        enabled: true,
        reportUnusedTypes: true,
        reportUnusedEnumMembers: true,
        reportUnusedClassMembers: true,
        reportPrivateTypeLeaks: true,
        reportUnusedParameters: true,
        reportDuplicateTypeDefinitions: true,
      },
    });
    const result = await analyze(config);
    assert.ok(Array.isArray(result.unusedTypes), "unusedTypes is always an array");
    assert.ok(Array.isArray(result.unusedEnumMembers));
    assert.ok(Array.isArray(result.unusedClassMembers));
    assert.ok(Array.isArray(result.privateTypeLeaks));
    assert.ok(Array.isArray(result.unusedParameters));
    assert.ok(Array.isArray(result.duplicateTypeDefinitions));
  });

  it("semantic pass on tsconfig-bearing fixture flags expected types", async (testContext) => {
    if (!SEMANTIC_ON) {
      testContext.diagnostic("DESLOP_TEST_SEMANTIC=off; skipping semantic-on tests");
      return;
    }
    const fixtureDir = resolve(FIXTURES_DIR, "unused-types-basic");
    const config = defineConfig({
      rootDir: fixtureDir,
      semantic: { enabled: true },
    });
    const result = await analyze(config);
    const names = result.unusedTypes.map((entry) => entry.name).sort();
    assert.deepEqual(names, ["UnusedAlias", "UnusedInterface"]);
  });

  it("never crashes when semantic flags are all simultaneously enabled", async (testContext) => {
    if (!SEMANTIC_ON) {
      testContext.diagnostic("DESLOP_TEST_SEMANTIC=off; skipping semantic-on tests");
      return;
    }
    const fixtureDir = resolve(FIXTURES_DIR, "unused-class-members-public");
    const config = defineConfig({
      rootDir: fixtureDir,
      semantic: {
        enabled: true,
        reportUnusedTypes: true,
        reportUnusedEnumMembers: true,
        reportUnusedClassMembers: true,
        reportPrivateTypeLeaks: true,
        reportUnusedParameters: true,
        reportDuplicateTypeDefinitions: true,
        reportRedundantExports: true,
        reportMisclassifiedDependencies: true,
      },
    });
    const result = await analyze(config);
    assert.ok(result.totalFiles > 0, "should still produce a non-empty graph");
    assert.ok(typeof result.analysisTimeMs === "number");
  });
});
