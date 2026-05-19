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
  const replacementBlock =
    existingBlock.trimEnd() +
    "\n  " +
    newlyAdded.map((item) => `"${item}",`).join("\n  ") +
    "\n";
  return sourceText.replace(
    exportLineRegex,
    `export const ${setExportName} = new Set([${replacementBlock}]);`,
  );
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
  return sourceText.replace(exportLineRegex, (fullMatch) =>
    fullMatch.replace(/=\s*\[[\s\S]*?\];/, `= [${replacementBlock}];`),
  );
};

const HYPOTHESIS_CATALOG: ConstantsExtension[] = [
  {
    id: "implicit-deps-types-batch-1",
    description: "add common @types/* packages to implicit deps",
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
      ]),
  },
  {
    id: "implicit-deps-types-batch-2",
    description: "add more @types/* (bcrypt, glob, yargs, ...)",
    pathRelative: "constants.ts",
    applyTransform: (sourceText) =>
      insertIntoSet(sourceText, "IMPLICIT_DEPENDENCIES", [
        "@types/bcrypt",
        "@types/bcryptjs",
        "@types/glob",
        "@types/yargs",
        "@types/minimist",
        "@types/prop-types",
        "@types/styled-components",
        "@types/three",
        "@types/dompurify",
        "@types/file-saver",
        "@types/markdown-it",
        "@types/morgan",
      ]),
  },
  {
    id: "implicit-deps-build-tooling",
    description: "common build/CLI tooling invoked without imports",
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
      ]),
  },
  {
    id: "implicit-deps-babel-presets",
    description: "babel presets and plugins resolved via config files",
    pathRelative: "constants.ts",
    applyTransform: (sourceText) =>
      insertIntoSet(sourceText, "IMPLICIT_DEPENDENCIES", [
        "@babel/preset-env",
        "@babel/preset-typescript",
        "@babel/preset-react",
        "@babel/preset-flow",
        "@babel/plugin-transform-runtime",
        "@babel/plugin-proposal-decorators",
        "@babel/plugin-proposal-class-properties",
        "babel-plugin-module-resolver",
        "babel-plugin-istanbul",
      ]),
  },
  {
    id: "implicit-deps-vite-vitest-extras",
    description: "vitest/vite ecosystem packages used implicitly via config",
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
        "esbuild-jest",
        "@testing-library/jest-dom",
        "@testing-library/react",
        "@testing-library/user-event",
      ]),
  },
  {
    id: "implicit-deps-react-native-tooling",
    description: "react native / expo / metro tooling",
    pathRelative: "constants.ts",
    applyTransform: (sourceText) =>
      insertIntoSet(sourceText, "IMPLICIT_DEPENDENCIES", [
        "@react-native/metro-config",
        "@react-native/babel-preset",
        "@react-native/eslint-config",
        "@react-native/typescript-config",
        "@react-native-community/cli",
        "@react-native-community/cli-platform-ios",
        "@react-native-community/cli-platform-android",
        "metro-react-native-babel-preset",
        "babel-preset-expo",
      ]),
  },
  {
    id: "hidden-allowlist-config-dirs",
    description: "scan dot-config directories deslop currently ignores",
    pathRelative: "constants.ts",
    applyTransform: (sourceText) =>
      insertIntoArray(sourceText, "HIDDEN_DIRECTORY_ALLOWLIST", [
        ".config",
        ".vscode",
        ".dev",
        ".husky",
      ]),
  },
  {
    id: "platform-suffixes-add-server",
    description: "add .server/.client platform suffixes (remix/react router)",
    pathRelative: "constants.ts",
    applyTransform: (sourceText) =>
      insertIntoArray(sourceText, "PLATFORM_SUFFIXES", [
        ".server",
        ".client",
      ]),
  },
  {
    id: "implicit-deps-prettier-eslint-plugins",
    description: "prettier and eslint plugins invoked via config",
    pathRelative: "constants.ts",
    applyTransform: (sourceText) =>
      insertIntoSet(sourceText, "IMPLICIT_DEPENDENCIES", [
        "prettier-plugin-tailwindcss",
        "prettier-plugin-organize-imports",
        "prettier-plugin-svelte",
        "prettier-plugin-astro",
        "@trivago/prettier-plugin-sort-imports",
        "@ianvs/prettier-plugin-sort-imports",
        "eslint-config-prettier",
        "eslint-config-next",
        "eslint-config-turbo",
        "eslint-plugin-import",
        "eslint-plugin-react",
        "eslint-plugin-react-hooks",
        "eslint-plugin-jsx-a11y",
        "eslint-plugin-tailwindcss",
        "eslint-plugin-prettier",
        "@typescript-eslint/eslint-plugin",
        "@typescript-eslint/parser",
      ]),
  },
  {
    id: "implicit-deps-postcss-plugins",
    description: "postcss/tailwind plugins loaded via config",
    pathRelative: "constants.ts",
    applyTransform: (sourceText) =>
      insertIntoSet(sourceText, "IMPLICIT_DEPENDENCIES", [
        "@tailwindcss/forms",
        "@tailwindcss/typography",
        "@tailwindcss/aspect-ratio",
        "@tailwindcss/container-queries",
        "@tailwindcss/postcss",
        "tailwindcss-animate",
        "postcss-nested",
        "postcss-import",
        "postcss-preset-env",
      ]),
  },
];

const fingerprintForTimestamp = (): string => {
  return new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
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
        return { changedFiles: [filePath], notes: undefined };
      },
    });
  }
  return proposals;
};
