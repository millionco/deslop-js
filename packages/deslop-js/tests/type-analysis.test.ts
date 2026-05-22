import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import ts from "typescript";
import { analyze, defineConfig } from "../src/index.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "fixtures");

interface DifferentialCase {
  fixture: string;
  expectedUnused: string[];
  divergenceNote?: string;
}

const DIFFERENTIAL_CASES: DifferentialCase[] = [
  { fixture: "unused-types-basic", expectedUnused: ["UnusedAlias", "UnusedInterface"] },
  { fixture: "unused-types-nested", expectedUnused: [] },
  { fixture: "unused-types-extends", expectedUnused: [] },
  { fixture: "unused-types-reexport-chain", expectedUnused: [] },
  { fixture: "unused-types-decl-merge", expectedUnused: [] },
  { fixture: "unused-types-generics", expectedUnused: [] },
  { fixture: "unused-types-import-type", expectedUnused: [] },
  { fixture: "unused-types-jsdoc", expectedUnused: [] },
];

const collectTypeScriptUnusedTypes = (fixtureDir: string): Set<string> => {
  const tsconfigPath = resolve(fixtureDir, "tsconfig.json");
  const readResult = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (readResult.error) return new Set();
  const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, fixtureDir);
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: { ...parsed.options, noEmit: true, skipLibCheck: true },
  });
  const checker = program.getTypeChecker();

  const knownSymbols = new Map<ts.Symbol, { name: string; declaringFile: string }>();
  const referenceCountBySymbol = new Map<ts.Symbol, number>();

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (!sourceFile.fileName.startsWith(fixtureDir)) continue;

    const visitDeclarations = (node: ts.Node): void => {
      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
        const symbol = checker.getSymbolAtLocation(node.name);
        if (symbol) {
          knownSymbols.set(symbol, {
            name: node.name.getText(sourceFile),
            declaringFile: sourceFile.fileName,
          });
        }
      }
      ts.forEachChild(node, visitDeclarations);
    };
    visitDeclarations(sourceFile);
  }

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (!sourceFile.fileName.startsWith(fixtureDir)) continue;

    const countReferences = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol) {
          const resolved =
            (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
          if (knownSymbols.has(resolved)) {
            let isDeclarationName = false;
            let cursor: ts.Node | undefined = node.parent;
            while (cursor) {
              if (
                (ts.isInterfaceDeclaration(cursor) || ts.isTypeAliasDeclaration(cursor)) &&
                cursor.name === node
              ) {
                isDeclarationName = true;
                break;
              }
              cursor = cursor.parent;
            }
            let isSpecifier = false;
            cursor = node.parent;
            while (cursor) {
              if (ts.isImportSpecifier(cursor) || ts.isExportSpecifier(cursor)) {
                isSpecifier = true;
                break;
              }
              cursor = cursor.parent;
            }
            if (!isDeclarationName && !isSpecifier) {
              referenceCountBySymbol.set(resolved, (referenceCountBySymbol.get(resolved) ?? 0) + 1);
            }
          }
        }
      }
      ts.forEachChild(node, countReferences);
    };
    countReferences(sourceFile);
  }

  const unusedNames = new Set<string>();
  for (const [symbol, info] of knownSymbols) {
    if ((referenceCountBySymbol.get(symbol) ?? 0) === 0) {
      unusedNames.add(info.name);
    }
  }
  return unusedNames;
};

describe("type-analysis differential", () => {
  for (const differentialCase of DIFFERENTIAL_CASES) {
    it(`deslop ⊆ TS-known-unused for ${differentialCase.fixture}${differentialCase.divergenceNote ? ` (${differentialCase.divergenceNote})` : ""}`, async () => {
      const fixtureDir = resolve(FIXTURES_DIR, differentialCase.fixture);
      const config = defineConfig({
        rootDir: fixtureDir,
        semantic: { enabled: true },
      });
      const result = await analyze(config);
      const deslopFlagged = new Set(result.unusedTypes.map((unusedType) => unusedType.name));
      const tsExpected = collectTypeScriptUnusedTypes(fixtureDir);

      for (const flagged of deslopFlagged) {
        assert.ok(
          tsExpected.has(flagged),
          `deslop flagged "${flagged}" but TS sees it as referenced in ${differentialCase.fixture}`,
        );
      }

      const expectedSet = new Set(differentialCase.expectedUnused);
      assert.deepEqual(
        [...deslopFlagged].sort(),
        [...expectedSet].sort(),
        `deslop's unusedTypes mismatch for ${differentialCase.fixture}`,
      );
    });
  }
});
