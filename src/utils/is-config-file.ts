import { CONFIG_FILE_PATTERNS } from "../constants.js";

export const isConfigFile = (filePath: string): boolean => {
  const fileName = filePath.split("/").pop() ?? "";
  return CONFIG_FILE_PATTERNS.some((pattern) => pattern.test(fileName));
};
