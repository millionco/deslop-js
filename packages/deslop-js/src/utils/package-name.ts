export const extractPackageName = (specifier: string): string | undefined => {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return undefined;
  if (specifier.startsWith("node:")) return undefined;

  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined;
  }

  return specifier.split("/")[0];
};
