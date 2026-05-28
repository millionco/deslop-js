import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toPosixPath } from "../src/utils/to-posix-path.js";
import { buildDependencyGraph, type ModuleLinkInput } from "../src/linker/build.js";
import { traceReachability } from "../src/linker/reachability.js";
import type { ParsedSource } from "../src/collect/parse.js";
import type { ResolvedImport } from "../src/resolver/resolve.js";
import type { ImportReference } from "../src/types.js";

const emptyParsed = (overrides: Partial<ParsedSource> = {}): ParsedSource => ({
  imports: [],
  exports: [],
  memberAccesses: [],
  wholeObjectUses: [],
  localIdentifierReferences: [],
  referencedFilenames: [],
  redundantTypePatterns: [],
  identityWrappers: [],
  typeDefinitionHashes: [],
  inlineTypeLiterals: [],
  simplifiableFunctions: [],
  simplifiableExpressions: [],
  duplicateConstantCandidates: [],
  errors: [],
  ...overrides,
});

const namedImport = (specifier: string, importedName: string): ImportReference => ({
  specifier,
  importedNames: [
    {
      name: importedName,
      alias: undefined,
      isNamespace: false,
      isDefault: false,
      isTypeOnly: false,
    },
  ],
  isTypeOnly: false,
  isDynamic: false,
  isSideEffect: false,
  isGlob: false,
  line: 1,
  column: 1,
});

describe("toPosixPath", () => {
  it("converts windows separators to forward slashes", () => {
    assert.equal(toPosixPath("C:\\project\\src\\App.tsx"), "C:/project/src/App.tsx");
  });

  it("leaves posix paths untouched", () => {
    assert.equal(toPosixPath("/project/src/App.tsx"), "/project/src/App.tsx");
  });

  it("normalizes mixed separators", () => {
    assert.equal(toPosixPath("C:/project\\src/App.tsx"), "C:/project/src/App.tsx");
  });
});

describe("buildDependencyGraph cross-platform path keying", () => {
  it("links imports when the resolver returns backslash paths", () => {
    const entry: ModuleLinkInput = {
      fileId: { index: 0, path: "C:/project/src/index.ts" },
      parsed: emptyParsed({ imports: [namedImport("./app", "App")] }),
      resolvedImports: new Map<string, ResolvedImport>([
        [
          "./app",
          { resolvedPath: "C:\\project\\src\\app.ts", isExternal: false, packageName: undefined },
        ],
      ]),
      isEntryPoint: true,
      isTestEntry: false,
    };
    const target: ModuleLinkInput = {
      fileId: { index: 1, path: "C:/project/src/app.ts" },
      parsed: emptyParsed(),
      resolvedImports: new Map<string, ResolvedImport>(),
      isEntryPoint: false,
      isTestEntry: false,
    };

    const graph = buildDependencyGraph([entry, target]);

    assert.ok(
      graph.edges.some((edge) => edge.source === 0 && edge.target === 1),
      "expected an import edge despite the backslash resolved path",
    );

    traceReachability(graph);
    assert.equal(
      graph.modules[1].isReachable,
      true,
      "app.ts must be reachable from the entry point and not reported as an unused file",
    );
  });
});
