export const blockArrowSimple = (input: string) => {
  return input.toUpperCase();
};

export const blockArrowComplex = (input: string) => {
  const upper = input.toUpperCase();
  return upper;
};

export const expressionArrow = (input: string) => input.toUpperCase();

export const fetchDataRedundant = async (): Promise<number> => {
  const value = await Promise.resolve(42);
  return value;
};

export const fetchDataDirect = async (): Promise<number> => {
  return Promise.resolve(42);
};

export const fetchDataMultiAwait = async (): Promise<number> => {
  const partial = await Promise.resolve(1);
  const remaining = await Promise.resolve(partial + 1);
  return remaining;
};

export const uselessAsync = async (input: number): Promise<number> => {
  return input * 2;
};

export const legitAsync = async (input: number): Promise<number> => {
  const doubled = await Promise.resolve(input * 2);
  return doubled + 1;
};

console.log(
  blockArrowSimple("a"),
  blockArrowComplex("b"),
  expressionArrow("c"),
  fetchDataRedundant(),
  fetchDataDirect(),
  fetchDataMultiAwait(),
  uselessAsync(2),
  legitAsync(3),
);
