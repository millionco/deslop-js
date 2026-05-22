import ts from "typescript";
import type { DependencyGraph, DeslopConfig, UnusedParameter } from "../types.js";
import { SEMANTIC_TRACE_MAX_ENTRIES } from "../constants.js";
import { lookupSourceFile } from "./program.js";
import type { SemanticContext } from "./program.js";

const NOUNUSED_DIAGNOSTIC_CODES = new Set([6133, 6196, 6198]);

const findEnclosingFunctionName = (node: ts.Node): string => {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text;
    if (ts.isFunctionExpression(current) && current.name) return current.name.text;
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      current.initializer &&
      (ts.isArrowFunction(current.initializer) || ts.isFunctionExpression(current.initializer))
    ) {
      return current.name.text;
    }
    current = current.parent;
  }
  return "<anonymous>";
};

export const detectUnusedParameters = (
  graph: DependencyGraph,
  _config: DeslopConfig,
  context: SemanticContext,
): UnusedParameter[] => {
  const tracked = new Set<string>();
  for (const module of graph.modules) {
    if (!module.isReachable) continue;
    if (module.isDeclarationFile) continue;
    tracked.add(module.fileId.path.split("\\").join("/"));
  }

  const findings: UnusedParameter[] = [];
  const compilerOptions = context.program.getCompilerOptions();
  const customOptions: ts.CompilerOptions = {
    ...compilerOptions,
    noUnusedParameters: true,
    noEmit: true,
  };

  let runtimeProgram: ts.Program;
  try {
    runtimeProgram = ts.createProgram({
      rootNames: context.program.getRootFileNames(),
      options: customOptions,
      oldProgram: context.program,
    });
  } catch {
    return [];
  }

  const diagnostics = runtimeProgram.getSemanticDiagnostics();
  for (const diagnostic of diagnostics) {
    if (!NOUNUSED_DIAGNOSTIC_CODES.has(diagnostic.code)) continue;
    const file = diagnostic.file;
    if (!file) continue;
    if (file.isDeclarationFile) continue;
    if (typeof diagnostic.start !== "number") continue;
    if (typeof diagnostic.length !== "number") continue;

    const normalizedPath = file.fileName.split("\\").join("/");
    if (!tracked.has(normalizedPath)) continue;

    const lookupModule = lookupSourceFile(context, normalizedPath);
    if (!lookupModule) continue;

    const node = findParameterNode(file, diagnostic.start, diagnostic.length);
    if (!node) continue;

    const parameterName = ts.isIdentifier(node.name) ? node.name.text : node.name.getText(file);
    if (parameterName.startsWith("_")) continue;

    const lineAndChar = file.getLineAndCharacterOfPosition(node.getStart(file));
    const functionName = findEnclosingFunctionName(node);

    findings.push({
      path: normalizedPath,
      functionName,
      parameterName,
      line: lineAndChar.line + 1,
      column: lineAndChar.character,
      confidence: "medium",
      reason: `parameter \`${parameterName}\` of \`${functionName}\` is never used`,
      trace: [
        `${normalizedPath}: ${functionName}(${parameterName})`,
        `TS diagnostic ${diagnostic.code}: ${typeof diagnostic.messageText === "string" ? diagnostic.messageText : diagnostic.messageText.messageText}`,
        "rename to \\`_" + parameterName + "\\` to suppress",
      ].slice(0, SEMANTIC_TRACE_MAX_ENTRIES),
    });
  }

  return findings;
};

const findParameterNode = (
  file: ts.SourceFile,
  start: number,
  length: number,
): ts.ParameterDeclaration | undefined => {
  let result: ts.ParameterDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (result) return;
    if (ts.isParameter(node)) {
      const nodeStart = node.getStart(file);
      if (nodeStart >= start && nodeStart < start + length + 1) {
        result = node;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return result;
};
