const POSITION_KEYS = new Set(["start", "end", "loc", "range"]);

const NOISY_KEYS = new Set([
  "decorators",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "directive",
  "optional",
  "computed",
  "static",
  "accessibility",
  "declare",
  "readonly",
]);

const NAME_KEYS_TO_STRIP = new Set(["id"]);

export const normalizeTypeAstHash = (typeAnnotation: unknown): string => {
  const replacer = (key: string, value: unknown): unknown => {
    if (POSITION_KEYS.has(key)) return undefined;
    if (NOISY_KEYS.has(key)) return undefined;
    if (NAME_KEYS_TO_STRIP.has(key)) return undefined;
    return value;
  };
  return JSON.stringify(typeAnnotation, replacer);
};
