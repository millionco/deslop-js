import ts from "typescript";
import type { DependencyGraph, DeslopConfig, UnusedClassMember } from "../types.js";
import { SEMANTIC_TRACE_MAX_ENTRIES } from "../constants.js";
import { lookupSourceFile } from "./program.js";
import type { SemanticContext } from "./program.js";
import type { ReferenceIndex } from "./references.js";
import { buildEntryExposureIndex } from "./utils/entry-exposed-modules.js";

type ClassMemberCandidate =
  | {
      kind: "method";
      node: ts.MethodDeclaration;
      container: ts.ClassDeclaration;
    }
  | { kind: "property"; node: ts.PropertyDeclaration; container: ts.ClassDeclaration }
  | {
      kind: "accessor";
      node: ts.GetAccessorDeclaration | ts.SetAccessorDeclaration;
      container: ts.ClassDeclaration;
    };

const getClassElementName = (node: ts.ClassElement): ts.PropertyName | undefined =>
  ts.isMethodDeclaration(node) ||
  ts.isPropertyDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node)
    ? node.name
    : undefined;

const isPrivateLike = (node: ts.ClassElement): boolean => {
  const elementName = getClassElementName(node);
  if (elementName && ts.isPrivateIdentifier(elementName)) return true;
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (!modifiers) return false;
  return modifiers.some(
    (modifier) =>
      modifier.kind === ts.SyntaxKind.PrivateKeyword ||
      modifier.kind === ts.SyntaxKind.ProtectedKeyword,
  );
};

const isStatic = (node: ts.ClassElement): boolean => {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (!modifiers) return false;
  return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword);
};

const hasDecorator = (node: ts.ClassElement, allowlist: Set<string>): boolean => {
  if (!ts.canHaveDecorators(node)) return false;
  const decorators = ts.getDecorators(node);
  if (!decorators) return false;
  for (const decorator of decorators) {
    let expression: ts.Expression = decorator.expression;
    if (ts.isCallExpression(expression)) expression = expression.expression;
    if (ts.isIdentifier(expression) && allowlist.has(expression.text)) return true;
    if (
      ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.name) &&
      allowlist.has(expression.name.text)
    ) {
      return true;
    }
  }
  return false;
};

const classHasIgnoredDecorator = (
  classDeclaration: ts.ClassDeclaration,
  allowlist: Set<string>,
): boolean => {
  if (!ts.canHaveDecorators(classDeclaration)) return false;
  const decorators = ts.getDecorators(classDeclaration);
  if (!decorators) return false;
  for (const decorator of decorators) {
    let expression: ts.Expression = decorator.expression;
    if (ts.isCallExpression(expression)) expression = expression.expression;
    if (ts.isIdentifier(expression) && allowlist.has(expression.text)) return true;
    if (
      ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.name) &&
      allowlist.has(expression.name.text)
    ) {
      return true;
    }
  }
  return false;
};

const collectClassMembers = (
  classDeclaration: ts.ClassDeclaration,
  decoratorAllowlist: Set<string>,
): ClassMemberCandidate[] => {
  const candidates: ClassMemberCandidate[] = [];
  for (const member of classDeclaration.members) {
    if (ts.isConstructorDeclaration(member)) continue;
    if (isPrivateLike(member)) continue;
    if (hasDecorator(member, decoratorAllowlist)) continue;
    const memberName = getClassElementName(member);
    if (!memberName) continue;
    if (!ts.isIdentifier(memberName) && !ts.isStringLiteral(memberName)) continue;

    if (ts.isMethodDeclaration(member)) {
      candidates.push({ kind: "method", node: member, container: classDeclaration });
    } else if (ts.isPropertyDeclaration(member)) {
      candidates.push({ kind: "property", node: member, container: classDeclaration });
    } else if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
      candidates.push({ kind: "accessor", node: member, container: classDeclaration });
    }
  }
  return candidates;
};

const collectOverrideNames = (
  classDeclaration: ts.ClassDeclaration,
  checker: ts.TypeChecker,
): Set<string> => {
  const overrides = new Set<string>();
  const heritageClauses = classDeclaration.heritageClauses;
  if (!heritageClauses) return overrides;
  for (const clause of heritageClauses) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const expression of clause.types) {
      const symbol = checker.getSymbolAtLocation(expression.expression);
      if (!symbol) continue;
      const declaration = symbol.declarations?.[0];
      if (!declaration || !ts.isClassDeclaration(declaration)) continue;
      for (const baseMember of declaration.members) {
        const baseName = getClassElementName(baseMember);
        if (!baseName) continue;
        if (ts.isIdentifier(baseName)) overrides.add(baseName.text);
        else if (ts.isStringLiteral(baseName)) overrides.add(baseName.text);
      }
    }
  }
  return overrides;
};

const hasReferences = (symbol: ts.Symbol, referenceIndex: ReferenceIndex): boolean => {
  const sites = referenceIndex.get(symbol);
  for (const site of sites) {
    if (site.isInsideDeclaration) continue;
    return true;
  }
  return false;
};

const collectSubclassOverrideNamesByBase = (
  program: ts.Program,
  checker: ts.TypeChecker,
): Map<ts.Symbol, Set<string>> => {
  const result = new Map<ts.Symbol, Set<string>>();
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) && node.heritageClauses) {
        for (const clause of node.heritageClauses) {
          if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
          for (const baseExpression of clause.types) {
            const baseSymbol = checker.getSymbolAtLocation(baseExpression.expression);
            if (!baseSymbol) continue;
            const resolvedBase =
              (baseSymbol.flags & ts.SymbolFlags.Alias) !== 0
                ? checker.getAliasedSymbol(baseSymbol)
                : baseSymbol;
            let names = result.get(resolvedBase);
            if (!names) {
              names = new Set();
              result.set(resolvedBase, names);
            }
            for (const member of node.members) {
              if (ts.isConstructorDeclaration(member)) continue;
              const memberName = getClassElementName(member);
              if (!memberName) continue;
              if (ts.isIdentifier(memberName)) names.add(memberName.text);
              else if (ts.isStringLiteral(memberName)) names.add(memberName.text);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return result;
};

const classIsExported = (classDeclaration: ts.ClassDeclaration): boolean =>
  Boolean(ts.getCombinedModifierFlags(classDeclaration) & ts.ModifierFlags.Export);

export const detectUnusedClassMembers = (
  graph: DependencyGraph,
  config: DeslopConfig,
  context: SemanticContext,
): UnusedClassMember[] => {
  const decoratorAllowlist = new Set(config.semantic.decoratorAllowlist);
  const referenceIndex = context.getReferenceIndex();
  const subclassOverrideNamesByBase = collectSubclassOverrideNamesByBase(
    context.program,
    context.checker,
  );
  const exposure = config.includeEntryExports ? undefined : buildEntryExposureIndex(graph);
  const findings: UnusedClassMember[] = [];

  for (const module of graph.modules) {
    if (!module.isReachable) continue;
    if (module.isDeclarationFile) continue;
    if (module.isEntryPoint && !config.includeEntryExports) continue;

    const isPubliclyExposedModule = exposure?.isModuleWildcardExposed(module.fileId.index);

    const sourceFile = lookupSourceFile(context, module.fileId.path);
    if (!sourceFile) continue;

    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node)) {
        if (!classIsExported(node)) {
          ts.forEachChild(node, visit);
          return;
        }
        if (classHasIgnoredDecorator(node, decoratorAllowlist)) {
          ts.forEachChild(node, visit);
          return;
        }
        const className = node.name ? node.name.text : undefined;
        if (
          isPubliclyExposedModule ||
          (className && exposure?.isNamedReExportedFromEntry(module.fileId.path, className))
        ) {
          ts.forEachChild(node, visit);
          return;
        }

        const overrides = collectOverrideNames(node, context.checker);
        const candidates = collectClassMembers(node, decoratorAllowlist);
        const resolvedClassName = className ?? "<anonymous>";

        const classSymbol = node.name ? context.checker.getSymbolAtLocation(node.name) : undefined;
        const subclassOverrideNames = classSymbol
          ? (subclassOverrideNamesByBase.get(classSymbol) ?? new Set<string>())
          : new Set<string>();

        for (const candidate of candidates) {
          const memberNameNode = getClassElementName(candidate.node);
          if (!memberNameNode) continue;
          const memberSymbol = context.checker.getSymbolAtLocation(memberNameNode);
          const memberName = ts.isIdentifier(memberNameNode)
            ? memberNameNode.text
            : ts.isStringLiteral(memberNameNode)
              ? memberNameNode.text
              : memberNameNode.getText(sourceFile);

          if (!memberSymbol) continue;
          if (overrides.has(memberName)) continue;
          if (subclassOverrideNames.has(memberName)) continue;
          if (hasReferences(memberSymbol, referenceIndex)) continue;

          const lineAndChar = sourceFile.getLineAndCharacterOfPosition(
            memberNameNode.getStart(sourceFile),
          );

          const confidence: UnusedClassMember["confidence"] = isStatic(candidate.node)
            ? "medium"
            : "high";

          findings.push({
            path: module.fileId.path,
            className: resolvedClassName,
            memberName,
            memberKind: candidate.kind,
            line: lineAndChar.line + 1,
            column: lineAndChar.character,
            confidence,
            reason: `class \`${resolvedClassName}\` ${candidate.kind} \`${memberName}\` has no non-declaration references`,
            trace: [
              `${module.fileId.path}: declared class \`${resolvedClassName}\``,
              `${candidate.kind} \`${memberName}\` has 0 external references`,
            ].slice(0, SEMANTIC_TRACE_MAX_ENTRIES),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return findings;
};
