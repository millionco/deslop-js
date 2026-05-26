import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, relative } from "node:path";
import { defineConfig, pruneUnusedFiles } from "../src/index.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "fixtures");

const stageFixtureCopy = (fixtureName: string): string => {
  const stagingRoot = mkdtempSync(resolve(tmpdir(), "deslop-prune-"));
  const stagedFixture = resolve(stagingRoot, fixtureName);
  cpSync(resolve(FIXTURES_DIR, fixtureName), stagedFixture, { recursive: true });
  return stagedFixture;
};

describe("pruneUnusedFiles", () => {
  it("reports orphan files without touching disk in dry-run mode", async () => {
    const fixtureRoot = stageFixtureCopy("simple-app");
    const orphanPath = resolve(fixtureRoot, "src/orphan.ts");

    try {
      assert.ok(existsSync(orphanPath));
      const result = await pruneUnusedFiles(defineConfig({ rootDir: fixtureRoot }), {
        dryRun: true,
      });
      const reportedRelativePaths = result.deletedFiles.map((filePath) =>
        relative(fixtureRoot, filePath),
      );
      assert.ok(
        reportedRelativePaths.includes("src/orphan.ts"),
        `expected orphan.ts in dry-run output, got: ${reportedRelativePaths.join(", ")}`,
      );
      assert.equal(result.dryRun, true);
      assert.ok(existsSync(orphanPath), "dry-run must not delete files");
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("deletes orphan files and converges in one pass for a simple app", async () => {
    const fixtureRoot = stageFixtureCopy("simple-app");
    const orphanPath = resolve(fixtureRoot, "src/orphan.ts");

    try {
      const result = await pruneUnusedFiles(defineConfig({ rootDir: fixtureRoot }));

      assert.ok(
        result.deletedFiles
          .map((filePath) => relative(fixtureRoot, filePath))
          .includes("src/orphan.ts"),
        "orphan.ts should be deleted",
      );
      assert.equal(existsSync(orphanPath), false, "orphan.ts must be removed from disk");
      assert.equal(result.converged, true, "prune should converge");
      assert.ok(result.iterations.length >= 1);
      assert.equal(result.iterations.at(-1)?.deletedFiles.length, 0, "last pass deletes nothing");
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("cascades deletion when an orphan re-exports a file that becomes unused", async () => {
    const fixtureRoot = stageFixtureCopy("simple-app");

    const indirectOrphanPath = resolve(fixtureRoot, "src/indirect-orphan.ts");
    const reexportingOrphanPath = resolve(fixtureRoot, "src/orphan-barrel.ts");
    writeFileSync(indirectOrphanPath, `export const onlyUsedByBarrel = 1;\n`);
    writeFileSync(reexportingOrphanPath, `export { onlyUsedByBarrel } from "./indirect-orphan";\n`);

    try {
      const result = await pruneUnusedFiles(defineConfig({ rootDir: fixtureRoot }));
      const deletedRelative = result.deletedFiles.map((filePath) =>
        relative(fixtureRoot, filePath),
      );

      assert.ok(
        deletedRelative.includes("src/orphan-barrel.ts"),
        `barrel should be deleted, got: ${deletedRelative.join(", ")}`,
      );
      assert.ok(
        deletedRelative.includes("src/indirect-orphan.ts"),
        `cascaded indirect orphan should be deleted, got: ${deletedRelative.join(", ")}`,
      );
      assert.ok(result.iterations.length >= 2, "cascade should require multiple passes");
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("does not touch files that index.ts still imports", async () => {
    const fixtureRoot = stageFixtureCopy("simple-app");
    const utilsPath = resolve(fixtureRoot, "src/utils.ts");
    const originalUtilsContent = readFileSync(utilsPath, "utf-8");

    try {
      await pruneUnusedFiles(defineConfig({ rootDir: fixtureRoot }));
      assert.equal(existsSync(utilsPath), true, "utils.ts must remain");
      assert.equal(readFileSync(utilsPath, "utf-8"), originalUtilsContent);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
