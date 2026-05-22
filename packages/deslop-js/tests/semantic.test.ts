import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { analyze, defineConfig } from "../src/index.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "fixtures");

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
    assert.equal(config.semantic.reportUnusedEnumMembers, false);
    assert.ok(Array.isArray(config.semantic.decoratorAllowlist));
    assert.ok(config.semantic.decoratorAllowlist.length > 0);
  });
});
