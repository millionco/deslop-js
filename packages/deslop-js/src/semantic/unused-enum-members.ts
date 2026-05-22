import ts from "typescript";
import type { DependencyGraph, DeslopConfig, UnusedEnumMember } from "../types.js";
import { SEMANTIC_TRACE_MAX_ENTRIES } from "../constants.js";
import { lookupSourceFile } from "./program.js";
import type { SemanticContext } from "./program.js";
import type { ReferenceIndex } from "./references.js";
import { buildEntryExposureIndex } from "./utils/entry-exposed-modules.js";

interface EnumCandidate {
  modulePath: string;
  enumDeclaration: ts.EnumDeclaration;
  isStringEnum: boolean;
  isConstEnum: boolean;
}

const isStringMember = (member: ts.EnumMember): boolean => {
  if (!member.initializer) return false;
  return (
    ts.isStringLiteral(member.initializer) || ts.isNoSubstitutionTemplateLiteral(member.initializer)
  );
};

const isConstEnum = (declaration: ts.EnumDeclaration): boolean =>
  Boolean(ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Const);

const collectEnumCandidates = (
  graph: DependencyGraph,
  config: DeslopConfig,
  context: SemanticContext,
): EnumCandidate[] => {
  const candidates: EnumCandidate[] = [];
  const exposure = config.includeEntryExports ? undefined : buildEntryExposureIndex(graph);

  for (const module of graph.modules) {
    if (!module.isReachable) continue;
    if (module.isDeclarationFile) continue;
    if (module.isEntryPoint && !config.includeEntryExports) continue;
    if (exposure?.isModuleWildcardExposed(module.fileId.index)) continue;

    const sourceFile = lookupSourceFile(context, module.fileId.path);
    if (!sourceFile) continue;

    for (const statement of sourceFile.statements) {
      if (!ts.isEnumDeclaration(statement)) continue;
      const isExported = Boolean(ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export);
      if (!isExported) continue;
      const enumName = statement.name.text;
      if (exposure?.isNamedReExportedFromEntry(module.fileId.path, enumName)) continue;

      const members = statement.members;
      const isStringEnum = members.length > 0 && members.every(isStringMember);
      candidates.push({
        modulePath: module.fileId.path,
        enumDeclaration: statement,
        isStringEnum,
        isConstEnum: isConstEnum(statement),
      });
    }
  }

  return candidates;
};

const findEnumMemberReferences = (
  member: ts.EnumMember,
  context: SemanticContext,
  referenceIndex: ReferenceIndex,
): { hasExternalUse: boolean; externalCount: number } => {
  const memberSymbol = context.checker.getSymbolAtLocation(member.name);
  if (!memberSymbol) return { hasExternalUse: false, externalCount: 0 };

  const sites = referenceIndex.get(memberSymbol);
  let externalCount = 0;
  for (const site of sites) {
    if (site.isInsideDeclaration) continue;
    externalCount += 1;
  }
  return { hasExternalUse: externalCount > 0, externalCount };
};

const wholeEnumReferenced = (
  enumDeclaration: ts.EnumDeclaration,
  context: SemanticContext,
  referenceIndex: ReferenceIndex,
): boolean => {
  const enumSymbol = context.checker.getSymbolAtLocation(enumDeclaration.name);
  if (!enumSymbol) return false;
  const sites = referenceIndex.get(enumSymbol);
  for (const site of sites) {
    if (site.isInsideDeclaration) continue;
    if (site.isInsideImportSpecifier) continue;
    if (site.isInsideExportSpecifier) continue;
    return true;
  }
  return false;
};

const hasComputedMember = (enumDeclaration: ts.EnumDeclaration): boolean => {
  for (const member of enumDeclaration.members) {
    if (!member.initializer) continue;
    if (
      !ts.isStringLiteral(member.initializer) &&
      !ts.isNumericLiteral(member.initializer) &&
      !ts.isNoSubstitutionTemplateLiteral(member.initializer)
    ) {
      return true;
    }
  }
  return false;
};

export const detectUnusedEnumMembers = (
  graph: DependencyGraph,
  _config: DeslopConfig,
  context: SemanticContext,
): UnusedEnumMember[] => {
  const candidates = collectEnumCandidates(graph, _config, context);
  if (candidates.length === 0) return [];

  const referenceIndex = context.getReferenceIndex();
  const unusedMembers: UnusedEnumMember[] = [];

  for (const candidate of candidates) {
    if (candidate.isConstEnum) continue;
    if (hasComputedMember(candidate.enumDeclaration)) continue;

    const isWholeEnumUsed = wholeEnumReferenced(candidate.enumDeclaration, context, referenceIndex);

    if (!candidate.isStringEnum && isWholeEnumUsed) continue;

    const sourceFile = candidate.enumDeclaration.getSourceFile();
    for (const member of candidate.enumDeclaration.members) {
      if (!ts.isIdentifier(member.name) && !ts.isStringLiteral(member.name)) continue;

      const { hasExternalUse } = findEnumMemberReferences(member, context, referenceIndex);

      if (hasExternalUse) continue;

      const lineAndChar = sourceFile.getLineAndCharacterOfPosition(
        member.name.getStart(sourceFile),
      );

      const enumName = candidate.enumDeclaration.name.getText(sourceFile);
      const memberName = ts.isIdentifier(member.name) ? member.name.text : member.name.text;

      const confidence: UnusedEnumMember["confidence"] = candidate.isStringEnum
        ? "high"
        : isWholeEnumUsed
          ? "low"
          : "medium";

      const reasonParts = [
        candidate.isStringEnum ? "string enum" : "numeric enum",
        "member has no non-declaration references",
      ];
      if (!candidate.isStringEnum) {
        reasonParts.push("(numeric enums may be reverse-looked-up via Enum[value])");
      }

      const trace = [
        `${candidate.modulePath}: enum \`${enumName}\` declared`,
        `member \`${memberName}\` has 0 external references`,
        ...(isWholeEnumUsed ? ["whole enum identifier is referenced elsewhere"] : []),
      ];

      unusedMembers.push({
        path: candidate.modulePath,
        enumName,
        memberName,
        line: lineAndChar.line + 1,
        column: lineAndChar.character,
        confidence,
        reason: reasonParts.join(" — "),
        trace: trace.slice(0, SEMANTIC_TRACE_MAX_ENTRIES),
      });
    }
  }

  return unusedMembers;
};
