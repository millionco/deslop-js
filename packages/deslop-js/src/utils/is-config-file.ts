import { CONFIG_FILE_PREFIXES } from "../constants.js";

export const isConfigFile = (filePath: string): boolean => {
  const fileName = filePath.split("/").pop() ?? "";

  if (fileName.startsWith(".") && !fileName.startsWith("..")) {
    if (fileName.toLowerCase().includes("rc.")) {
      return true;
    }
  }

  return CONFIG_FILE_PREFIXES.some((prefix) => fileName.startsWith(prefix));
};
