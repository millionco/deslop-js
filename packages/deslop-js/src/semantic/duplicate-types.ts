import ts from "typescript";
import type { DependencyGraph, DeslopConfig, DuplicateTypeDefinition } from "../types.js";
import { SEMANTIC_TRACE_MAX_ENTRIES } from "../constants.js";
import { lookupSourceFile } from "./program.js";
import type { SemanticContext } from "./program.js";

interface DeclarationFingerprint {
  hash: string;
  name: string;
  kind: "interface" | "type-alias";
  modulePath: string;
}

const normalizeIdentifierNames = (text: string, declaredName: string): string =>
  text
    .replace(
      new RegExp(`\\b${declaredName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "g"),
      "<name>",
    )
    .replace(/\s+/g, " ")
    .trim();

const hashInterface = (declaration: ts.InterfaceDeclaration, sourceFile: ts.SourceFile): string => {
  const memberFingerprints: string[] = [];
  for (const member of declaration.members) {
    const rawText = member.getText(sourceFile);
    memberFingerprints.push(rawText.replace(/\s+/g, " ").trim());
  }
  memberFingerprints.sort();
  const heritageText = declaration.heritageClauses
    ? declaration.heritageClauses
        .map((clause) => clause.getText(sourceFile).replace(/\s+/g, " ").trim())
        .sort()
        .join("|")
    : "";
  return `interface::${heritageText}::${memberFingerprints.join("||")}`;
};

const hashTypeAlias = (declaration: ts.TypeAliasDeclaration, sourceFile: ts.SourceFile): string => {
  const body = declaration.type.getText(sourceFile);
  const declaredName = declaration.name.text;
  return `type-alias::${normalizeIdentifierNames(body, declaredName)}`;
};

const collectFingerprints = (
  graph: DependencyGraph,
  context: SemanticContext,
): DeclarationFingerprint[] => {
  const fingerprints: DeclarationFingerprint[] = [];

  for (const module of graph.modules) {
    if (!module.isReachable) continue;
    if (module.isDeclarationFile) continue;

    const sourceFile = lookupSourceFile(context, module.fileId.path);
    if (!sourceFile) continue;

    for (const statement of sourceFile.statements) {
      if (ts.isInterfaceDeclaration(statement)) {
        fingerprints.push({
          hash: hashInterface(statement, sourceFile),
          name: statement.name.text,
          kind: "interface",
          modulePath: module.fileId.path,
        });
      } else if (ts.isTypeAliasDeclaration(statement)) {
        fingerprints.push({
          hash: hashTypeAlias(statement, sourceFile),
          name: statement.name.text,
          kind: "type-alias",
          modulePath: module.fileId.path,
        });
      }
    }
  }
  return fingerprints;
};

export const detectDuplicateTypeDefinitions = (
  graph: DependencyGraph,
  _config: DeslopConfig,
  context: SemanticContext,
): DuplicateTypeDefinition[] => {
  const fingerprints = collectFingerprints(graph, context);
  if (fingerprints.length === 0) return [];

  const groups = new Map<string, DeclarationFingerprint[]>();
  for (const entry of fingerprints) {
    const existing = groups.get(entry.hash);
    if (existing) existing.push(entry);
    else groups.set(entry.hash, [entry]);
  }

  const findings: DuplicateTypeDefinition[] = [];
  for (const matches of groups.values()) {
    if (matches.length < 2) continue;
    const distinctPaths = new Set(matches.map((m) => m.modulePath));
    if (distinctPaths.size < 2) continue;

    const allSameKind = matches.every((m) => m.kind === matches[0].kind);
    if (!allSameKind) continue;

    const names = [...new Set(matches.map((m) => m.name))];
    const sortedPaths = [...distinctPaths].sort();

    findings.push({
      name: names.length === 1 ? names[0] : names.join("|"),
      kind: matches[0].kind,
      paths: sortedPaths,
      confidence: names.length === 1 ? "high" : "medium",
      reason:
        names.length === 1
          ? `${matches[0].kind} \`${names[0]}\` has structurally identical declarations in ${sortedPaths.length} modules`
          : `Structurally identical ${matches[0].kind} declared under names: ${names.join(", ")}`,
      trace: [
        `structural hash matches across ${sortedPaths.length} modules`,
        `names: ${names.join(", ")}`,
        `paths: ${sortedPaths.slice(0, 3).join(" | ")}`,
      ].slice(0, SEMANTIC_TRACE_MAX_ENTRIES),
    });
  }

  return findings;
};
