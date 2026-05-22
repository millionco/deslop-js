export interface IdentityWrapperDetection {
  wrappedExpression: string;
}

interface NodeLike {
  type: string;
  [key: string]: unknown;
}

const isNode = (value: unknown): value is NodeLike =>
  Boolean(value) && typeof value === "object" && typeof (value as NodeLike).type === "string";

const getIdentifierName = (node: NodeLike): string | undefined => {
  if (node.type !== "Identifier") return undefined;
  return node.name as string | undefined;
};

const getCalleeText = (calleeNode: NodeLike): string | undefined => {
  if (calleeNode.type === "Identifier") {
    return getIdentifierName(calleeNode);
  }
  if (calleeNode.type === "MemberExpression") {
    const computed = (calleeNode as { computed?: boolean }).computed;
    if (computed) return undefined;
    const objectNode = calleeNode.object as NodeLike | undefined;
    const propertyNode = calleeNode.property as NodeLike | undefined;
    if (!objectNode || !propertyNode) return undefined;
    const objectText = getCalleeText(objectNode);
    const propertyText = propertyNode.type === "Identifier" ? (propertyNode.name as string) : undefined;
    if (!objectText || !propertyText) return undefined;
    return `${objectText}.${propertyText}`;
  }
  return undefined;
};

const collectParameterNames = (
  parameters: unknown[],
): { names: string[]; hasRest: boolean; hasDefault: boolean; restName?: string } => {
  const names: string[] = [];
  let hasRest = false;
  let hasDefault = false;
  let restName: string | undefined;
  for (const parameter of parameters) {
    if (!isNode(parameter)) return { names, hasRest: true, hasDefault, restName };
    if (parameter.type === "RestElement") {
      const restArgument = parameter.argument as NodeLike | undefined;
      if (restArgument && restArgument.type === "Identifier") {
        hasRest = true;
        restName = restArgument.name as string;
        continue;
      }
      return { names, hasRest: true, hasDefault, restName };
    }
    if (parameter.type === "AssignmentPattern") {
      hasDefault = true;
      return { names, hasRest, hasDefault, restName };
    }
    if (parameter.type === "Identifier") {
      names.push(parameter.name as string);
      continue;
    }
    return { names: [], hasRest, hasDefault, restName };
  }
  return { names, hasRest, hasDefault, restName };
};

const argumentsMatchParameters = (
  callArguments: unknown[],
  parameterNames: string[],
  restName: string | undefined,
): boolean => {
  if (restName !== undefined) {
    if (callArguments.length !== 1) return false;
    const onlyArgument = callArguments[0];
    if (!isNode(onlyArgument)) return false;
    if (onlyArgument.type !== "SpreadElement") return false;
    const spreadArgumentNode = (onlyArgument as { argument?: NodeLike }).argument;
    return Boolean(spreadArgumentNode && spreadArgumentNode.type === "Identifier" && spreadArgumentNode.name === restName);
  }
  if (callArguments.length !== parameterNames.length) return false;
  for (let argumentIndex = 0; argumentIndex < callArguments.length; argumentIndex++) {
    const argumentNode = callArguments[argumentIndex];
    if (!isNode(argumentNode)) return false;
    if (argumentNode.type !== "Identifier") return false;
    if ((argumentNode as { name?: string }).name !== parameterNames[argumentIndex]) return false;
  }
  return true;
};

const extractCallExpressionFromBody = (bodyNode: NodeLike): NodeLike | undefined => {
  if (bodyNode.type === "CallExpression") return bodyNode;
  if (bodyNode.type === "BlockStatement") {
    const blockBody = (bodyNode as { body?: unknown[] }).body;
    if (!Array.isArray(blockBody) || blockBody.length !== 1) return undefined;
    const onlyStatement = blockBody[0];
    if (!isNode(onlyStatement)) return undefined;
    if (onlyStatement.type !== "ReturnStatement") return undefined;
    const returnedExpression = (onlyStatement as { argument?: NodeLike }).argument;
    if (!returnedExpression) return undefined;
    if (returnedExpression.type !== "CallExpression") return undefined;
    return returnedExpression;
  }
  return undefined;
};

export const detectIdentityWrapperFromInitializer = (
  initializerNode: unknown,
  wrapperName: string,
): IdentityWrapperDetection | undefined => {
  if (!isNode(initializerNode)) return undefined;
  if (
    initializerNode.type !== "ArrowFunctionExpression" &&
    initializerNode.type !== "FunctionExpression"
  ) {
    return undefined;
  }
  if ((initializerNode as { async?: boolean }).async) return undefined;
  if ((initializerNode as { generator?: boolean }).generator) return undefined;
  const parameters = (initializerNode as { params?: unknown[] }).params ?? [];
  const { names: parameterNames, hasRest, hasDefault, restName } = collectParameterNames(parameters);
  if (hasDefault) return undefined;

  const bodyNode = (initializerNode as { body?: NodeLike }).body;
  if (!bodyNode) return undefined;
  const callExpression = extractCallExpressionFromBody(bodyNode);
  if (!callExpression) return undefined;

  const calleeNode = (callExpression as { callee?: NodeLike }).callee;
  if (!calleeNode) return undefined;
  const calleeText = getCalleeText(calleeNode);
  if (!calleeText) return undefined;
  if (calleeText === wrapperName) return undefined;

  const callArguments = (callExpression as { arguments?: unknown[] }).arguments ?? [];
  if (!argumentsMatchParameters(callArguments, parameterNames, hasRest ? restName : undefined)) {
    return undefined;
  }

  return { wrappedExpression: calleeText };
};
