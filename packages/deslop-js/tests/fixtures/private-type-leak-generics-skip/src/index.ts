export const pickValue = <TValue extends { value: unknown }>(input: TValue): TValue["value"] =>
  input.value;

export const identity = <T>(value: T): T => value;
