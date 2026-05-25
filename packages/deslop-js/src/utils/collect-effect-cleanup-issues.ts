import { parseSync } from "oxc-parser";
import {
  BOUND_RESOURCE_RELEASE_METHOD_NAMES,
  CALLABLE_CLEANUP_SUBSCRIBE_METHOD_NAMES,
  EFFECT_HOOK_NAMES,
  GLOBAL_RELEASE_METHOD_NAMES,
  SUBSCRIBE_LIKE_METHOD_NAMES,
  TIMER_CALLEE_NAMES_REQUIRING_CLEANUP,
  TIMER_CLEANUP_CALLEE_NAMES,
} from "../constants.js";
import { getColumnFromOffset, getLineFromOffset } from "./line-column.js";
import { getIdentifierName, isOxcAstNode, type OxcAstNode } from "./oxc-ast-node.js";

export interface EffectCleanupIssueCapture {
  hookName: string;
  resourceName: string;
  resourceKind: "subscription" | "timer";
  startOffset: number;
  message: string;
}

export interface EffectCleanupIssue extends EffectCleanupIssueCapture {
  filePath: string;
  line: number;
  column: number;
}

interface ResourceUsage {
  resourceName: string;
  resourceKind: "subscription" | "timer";
}

interface ReleasableBindingNames {
  callableCleanupNames: Set<string>;
  boundResourceNames: Set<string>;
}

const isFunctionLikeNode = (node: OxcAstNode): boolean =>
  node.type === "ArrowFunctionExpression" ||
  node.type === "FunctionExpression" ||
  node.type === "FunctionDeclaration";

const getCallCallee = (node: OxcAstNode): OxcAstNode | undefined => {
  if (node.type !== "CallExpression") return undefined;
  const callee = node.callee;
  return isOxcAstNode(callee) ? callee : undefined;
};

const getStaticMemberObject = (node: OxcAstNode): OxcAstNode | undefined => {
  if (node.type !== "MemberExpression") return undefined;
  if ((node as { computed?: boolean }).computed) return undefined;
  const object = node.object;
  return isOxcAstNode(object) ? object : undefined;
};

const getStaticMemberName = (node: OxcAstNode): string | undefined => {
  if (node.type !== "MemberExpression") return undefined;
  if ((node as { computed?: boolean }).computed) return undefined;
  return getIdentifierName(node.property);
};

const getStaticMemberReceiverName = (node: OxcAstNode): string | undefined => {
  const object = getStaticMemberObject(node);
  if (!object) return undefined;
  return getIdentifierName(object);
};

const getCalleeName = (callee: OxcAstNode): string | undefined => {
  if (callee.type === "Identifier") return getIdentifierName(callee);
  return getStaticMemberName(callee);
};

const getNodeChildren = (node: OxcAstNode): OxcAstNode[] => {
  const children: OxcAstNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isOxcAstNode(item)) children.push(item);
      }
    } else if (isOxcAstNode(value)) {
      children.push(value);
    }
  }
  return children;
};

const walkAst = (node: OxcAstNode, visitor: (child: OxcAstNode) => boolean | void): void => {
  const shouldDescend = visitor(node);
  if (shouldDescend === false) return;
  for (const child of getNodeChildren(node)) {
    walkAst(child, visitor);
  }
};

const walkEffectScope = (
  node: OxcAstNode,
  visitor: (child: OxcAstNode) => boolean | void,
): void => {
  const shouldDescend = visitor(node);
  if (shouldDescend === false) return;
  for (const child of getNodeChildren(node)) {
    if (isFunctionLikeNode(child)) continue;
    if (node.type === "ReturnStatement" && child === node.argument) continue;
    walkEffectScope(child, visitor);
  }
};

const isSubscribeLikeCallExpression = (node: OxcAstNode): boolean => {
  const callee = getCallCallee(node);
  if (!callee) return false;
  const methodName = getStaticMemberName(callee);
  return methodName !== undefined && SUBSCRIBE_LIKE_METHOD_NAMES.has(methodName);
};

const isCallableCleanupSubscribeCallExpression = (node: OxcAstNode): boolean => {
  const callee = getCallCallee(node);
  if (!callee) return false;
  const methodName = getStaticMemberName(callee);
  return methodName !== undefined && CALLABLE_CLEANUP_SUBSCRIBE_METHOD_NAMES.has(methodName);
};

const collectReleasableBindingNames = (effectCallback: OxcAstNode): ReleasableBindingNames => {
  const bindingNames: ReleasableBindingNames = {
    callableCleanupNames: new Set<string>(),
    boundResourceNames: new Set<string>(),
  };
  const bodyNode = effectCallback.body;
  if (!isOxcAstNode(bodyNode)) return bindingNames;
  walkEffectScope(bodyNode, (child) => {
    if (child.type !== "VariableDeclarator") return;
    const bindingName = getIdentifierName(child.id);
    if (!bindingName) return;
    const initializer = child.init;
    if (!isOxcAstNode(initializer)) return;
    if (isSubscribeLikeCallExpression(initializer)) {
      bindingNames.boundResourceNames.add(bindingName);
      if (isCallableCleanupSubscribeCallExpression(initializer)) {
        bindingNames.callableCleanupNames.add(bindingName);
      }
    }
  });
  return bindingNames;
};

const findResourceUsages = (effectCallback: OxcAstNode): ResourceUsage[] => {
  const usages: ResourceUsage[] = [];
  const bodyNode = effectCallback.body;
  if (!isOxcAstNode(bodyNode)) return usages;
  const nodeToWalk = bodyNode.type === "BlockStatement" ? bodyNode : effectCallback;
  walkEffectScope(nodeToWalk, (child) => {
    if (child.type !== "CallExpression") return;
    const callee = getCallCallee(child);
    if (!callee) return;
    if (callee.type === "Identifier") {
      const calleeName = getIdentifierName(callee);
      if (calleeName && TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(calleeName)) {
        usages.push({ resourceName: calleeName, resourceKind: "timer" });
      }
      return;
    }
    const methodName = getStaticMemberName(callee);
    if (methodName && SUBSCRIBE_LIKE_METHOD_NAMES.has(methodName)) {
      usages.push({ resourceName: methodName, resourceKind: "subscription" });
    }
  });
  return usages;
};

const isReleaseLikeCall = (
  callNode: OxcAstNode,
  releasableBindingNames: ReleasableBindingNames,
): boolean => {
  const callee = getCallCallee(callNode);
  if (!callee) return false;
  if (callee.type === "Identifier") {
    const calleeName = getIdentifierName(callee);
    if (!calleeName) return false;
    return (
      TIMER_CLEANUP_CALLEE_NAMES.has(calleeName) ||
      GLOBAL_RELEASE_METHOD_NAMES.has(calleeName) ||
      releasableBindingNames.callableCleanupNames.has(calleeName)
    );
  }
  const methodName = getStaticMemberName(callee);
  if (!methodName) return false;
  if (GLOBAL_RELEASE_METHOD_NAMES.has(methodName)) return true;
  if (!BOUND_RESOURCE_RELEASE_METHOD_NAMES.has(methodName)) return false;
  const receiverName = getStaticMemberReceiverName(callee);
  return receiverName !== undefined && releasableBindingNames.boundResourceNames.has(receiverName);
};

const containsReleaseLikeCall = (
  node: OxcAstNode,
  releasableBindingNames: ReleasableBindingNames,
): boolean => {
  let didFindReleaseCall = false;
  walkEffectScope(node, (child) => {
    if (didFindReleaseCall) return false;
    if (child.type !== "CallExpression") return;
    if (isReleaseLikeCall(child, releasableBindingNames)) {
      didFindReleaseCall = true;
      return false;
    }
  });
  return didFindReleaseCall;
};

const isCleanupReturn = (
  returnedValue: unknown,
  releasableBindingNames: ReleasableBindingNames,
): boolean => {
  if (!isOxcAstNode(returnedValue)) return false;
  if (returnedValue.type === "Identifier") {
    const returnedName = getIdentifierName(returnedValue);
    return (
      returnedName !== undefined && releasableBindingNames.callableCleanupNames.has(returnedName)
    );
  }
  if (isCallableCleanupSubscribeCallExpression(returnedValue)) return true;
  if (
    returnedValue.type !== "ArrowFunctionExpression" &&
    returnedValue.type !== "FunctionExpression"
  ) {
    return false;
  }
  const cleanupBody = returnedValue.body;
  if (!isOxcAstNode(cleanupBody)) return false;
  return containsReleaseLikeCall(cleanupBody, releasableBindingNames);
};

const effectHasCleanupRelease = (effectCallback: OxcAstNode): boolean => {
  const bodyNode = effectCallback.body;
  if (!isOxcAstNode(bodyNode)) return false;
  if (bodyNode.type !== "BlockStatement") return isCallableCleanupSubscribeCallExpression(bodyNode);
  const releasableBindingNames = collectReleasableBindingNames(effectCallback);
  let didFindCleanupReturn = false;
  walkEffectScope(bodyNode, (child) => {
    if (didFindCleanupReturn) return false;
    if (child.type !== "ReturnStatement") return;
    if (isCleanupReturn(child.argument, releasableBindingNames)) {
      didFindCleanupReturn = true;
      return false;
    }
  });
  return didFindCleanupReturn;
};

const getEffectCallback = (callNode: OxcAstNode): OxcAstNode | undefined => {
  const callArguments = callNode.arguments;
  if (!Array.isArray(callArguments)) return undefined;
  const callback = callArguments[0];
  if (!isOxcAstNode(callback)) return undefined;
  if (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression") {
    return undefined;
  }
  return callback;
};

const isEffectHookCall = (node: OxcAstNode): boolean => {
  const callee = getCallCallee(node);
  if (!callee) return false;
  const calleeName = getCalleeName(callee);
  return calleeName !== undefined && EFFECT_HOOK_NAMES.has(calleeName);
};

const createMessage = (usage: ResourceUsage): string => {
  if (usage.resourceKind === "timer") {
    const clearName = usage.resourceName === "setInterval" ? "clearInterval" : "clearTimeout";
    return `useEffect schedules \`${usage.resourceName}(...)\` but never returns a cleanup. Return a cleanup function that calls \`${clearName}(...)\`.`;
  }
  return `useEffect subscribes via \`${usage.resourceName}(...)\` but never returns a cleanup. Return a cleanup function that releases the subscription.`;
};

export const collectEffectCleanupIssues = (programBody: unknown[]): EffectCleanupIssueCapture[] => {
  const issues: EffectCleanupIssueCapture[] = [];
  for (const statement of programBody) {
    if (!isOxcAstNode(statement)) continue;
    walkAst(statement, (child) => {
      if (child.type !== "CallExpression") return;
      if (!isEffectHookCall(child)) return;
      const callback = getEffectCallback(child);
      if (!callback) return;
      const usages = findResourceUsages(callback);
      if (usages.length === 0) return;
      if (effectHasCleanupRelease(callback)) return;
      const firstUsage = usages[0];
      issues.push({
        hookName: getCalleeName(getCallCallee(child) ?? child) ?? "useEffect",
        resourceName: firstUsage.resourceName,
        resourceKind: firstUsage.resourceKind,
        startOffset: child.start ?? 0,
        message: createMessage(firstUsage),
      });
    });
  }
  return issues;
};

export const detectEffectCleanupIssues = (
  sourceText: string,
  filePath = "input.tsx",
): EffectCleanupIssue[] => {
  let parseResult: ReturnType<typeof parseSync>;
  try {
    parseResult = parseSync(filePath, sourceText, { sourceType: "module" });
  } catch {
    return [];
  }
  if (parseResult.errors.length > 0) return [];
  return collectEffectCleanupIssues(parseResult.program.body).map((issue) => ({
    ...issue,
    filePath,
    line: getLineFromOffset(sourceText, issue.startOffset),
    column: getColumnFromOffset(sourceText, issue.startOffset),
  }));
};
