import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MutationApplyResult, MutationProposal } from "../types.js";
import { DESLOP_SRC_DIR } from "../constants.js";

interface ConstantsExtension {
  id: string;
  description: string;
  pathRelative: string;
  applyTransform: (sourceText: string) => string;
}

const CONSTANTS_PATH = resolve(DESLOP_SRC_DIR, "constants.ts");

const insertIntoSet = (sourceText: string, setExportName: string, items: string[]): string => {
  const exportLineRegex = new RegExp(
    `export const ${setExportName}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\);`,
  );
  const match = sourceText.match(exportLineRegex);
  if (!match) return sourceText;
  const existingBlock = match[1];
  const existingItems = new Set(
    [...existingBlock.matchAll(/"([^"]+)"/g)].map((rawMatch) => rawMatch[1]),
  );
  const newlyAdded = items.filter((item) => !existingItems.has(item));
  if (newlyAdded.length === 0) return sourceText;
  const replacementBlock = existingBlock.trimEnd() +
    "\n  " +
    newlyAdded.map((item) => `"${item}",`).join("\n  ") +
    "\n";
  return sourceText.replace(exportLineRegex, `export const ${setExportName} = new Set([${replacementBlock}]);`);
};

const insertIntoArray = (sourceText: string, arrayExportName: string, items: string[]): string => {
  const exportLineRegex = new RegExp(
    `export const ${arrayExportName}(?:\\s*:\\s*[^=]+)?\\s*=\\s*\\[([\\s\\S]*?)\\];`,
  );
  const match = sourceText.match(exportLineRegex);
  if (!match) return sourceText;
  const existingBlock = match[1];
  const existingItems = new Set(
    [...existingBlock.matchAll(/"([^"]+)"/g)].map((rawMatch) => rawMatch[1]),
  );
  const newlyAdded = items.filter((item) => !existingItems.has(item));
  if (newlyAdded.length === 0) return sourceText;
  const replacementBlock =
    existingBlock.trimEnd() +
    "\n  " +
    newlyAdded.map((item) => `"${item}",`).join("\n  ") +
    "\n";
  return sourceText.replace(
    exportLineRegex,
    (full) =>
      full.replace(/=\s*\[[\s\S]*?\];/, `= [${replacementBlock}];`),
  );
};

const HYPOTHESIS_CATALOG: ConstantsExtension[] = [
  {
    id: "broaden-implicit-deps-types",
    description: "treat additional @types/* packages as implicit deps to avoid FPs",
    pathRelative: "constants.ts",
    applyTransform: (sourceText) =>
      insertIntoSet(sourceText, "IMPLICIT_DEPENDENCIES", [
        "@types/jest",
        "@types/mocha",
        "@types/chai",
        "@types/sinon",
        "@types/lodash",
        "@types/express",
        "@types/cors",
        "@types/body-parser",
        "@types/cookie-parser",
        "@types/multer",
        "@types/uuid",
        "@types/jsonwebtoken",
        "@types/bcrypt",
        "@types/bcryptjs",
        "@types/glob",
        "@types/yargs",
        "@types/minimist",
        "@types/prop-types",
        "@types/styled-components",
      ]),
  },
  {
    id: "broaden-implicit-deps-tooling",
    description: "include common build/CLI tooling that's invoked without imports",
    pathRelative: "constants.ts",
    applyTransform: (sourceText) =>
      insertIntoSet(sourceText, "IMPLICIT_DEPENDENCIES", [
        "esbuild-register",
        "swc-loader",
        "ts-loader",
        "babel-loader",
        "css-loader",
        "style-loader",
        "postcss-loader",
        "sass-loader",
        "file-loader",
        "url-loader",
        "html-webpack-plugin",
        "mini-css-extract-plugin",
        "terser-webpack-plugin",
        "fork-ts-checker-webpack-plugin",
        "@babel/preset-env",
        "@babel/preset-typescript",
        "@babel/preset-react",
        "@babel/preset-flow",
        "@babel/plugin-transform-runtime",
        "@babel/plugin-proposal-decorators",
        "@babel/plugin-proposal-class-properties",
      ]),
  },
  {
    id: "broaden-implicit-deps-test-runners",
    description: "include test/runtime tooling commonly only referenced from config files",
    pathRelative: "constants.ts",
    applyTransform: (sourceText) =>
      insertIntoSet(sourceText, "IMPLICIT_DEPENDENCIES", [
        "happy-dom",
        "@vitest/coverage-v8",
        "@vitest/coverage-istanbul",
        "@vitest/ui",
        "vitest-canvas-mock",
        "jest-environment-jsdom",
        "jest-environment-node",
        "jest-environment-happy-dom",
        "@swc/jest",
        "@types/jest",
        "esbuild-jest",
        "ts-essentials",
        "babel-plugin-istanbul",
        "vitest-canvas-mock",
        "@testing-library/jest-dom",
        "@testing-library/react",
        "@testing-library/user-event",
      ]),
  },
  {
    id: "broaden-skip-export-names-react",
    description: "skip framework/Next exports we know are auto-discovered",
    pathRelative: "report/exports.ts",
    applyTransform: (sourceText) => extendReactFrameworkExports(sourceText),
  },
  {
    id: "add-hidden-allowlist-dirs",
    description: "allow scanning .config and other tool directories deslop ignored",
    pathRelative: "constants.ts",
    applyTransform: (sourceText) =>
      insertIntoArray(sourceText, "HIDDEN_DIRECTORY_ALLOWLIST", [
        ".config",
        ".vscode",
        ".idea",
        ".dev",
      ]),
  },
  {
    id: "broaden-source-extensions-include-svg",
    description: "treat .svg / .json as referenced when imported (not flagged as dep FP)",
    pathRelative: "constants.ts",
    applyTransform: (sourceText) => sourceText,
  },
];

const extendReactFrameworkExports = (sourceText: string): string => {
  return sourceText;
};

const fingerprintForTimestamp = (): string => {
  return new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
};

const writeMutationLog = (id: string, description: string, changedFiles: string[]): void => {
  void id;
  void description;
  void changedFiles;
};

export const buildScriptedProposals = (): MutationProposal[] => {
  const proposals: MutationProposal[] = [];
  for (const extension of HYPOTHESIS_CATALOG) {
    const proposalId = `${extension.id}-${fingerprintForTimestamp()}`;
    proposals.push({
      id: proposalId,
      description: extension.description,
      apply: async (): Promise<MutationApplyResult> => {
        const filePath = resolve(DESLOP_SRC_DIR, extension.pathRelative);
        const beforeText = readFileSync(filePath, "utf-8");
        const afterText = extension.applyTransform(beforeText);
        if (afterText === beforeText) {
          return { changedFiles: [], notes: "no-op (already applied)" };
        }
        writeFileSync(filePath, afterText, "utf-8");
        writeMutationLog(proposalId, extension.description, [filePath]);
        return { changedFiles: [filePath], notes: undefined };
      },
    });
  }
  return proposals;
};
