import type { ScanResult } from "deslop-js";

const formatIssueCount = (count: number, singularLabel: string, pluralLabel: string): string => {
  const label = count === 1 ? singularLabel : pluralLabel;
  return `${count} unused ${label}`;
};

export const formatHumanReadableResult = (result: ScanResult): string => {
  const lines: string[] = [];

  lines.push(
    `Analyzed ${result.totalFiles} files (${result.totalExports} exports) in ${result.analysisTimeMs.toFixed(0)}ms`,
  );
  lines.push("");

  if (result.unusedFiles.length > 0) {
    lines.push(formatIssueCount(result.unusedFiles.length, "file", "files"));
    for (const unusedFile of result.unusedFiles) {
      lines.push(`  ${unusedFile.path}`);
    }
    lines.push("");
  }

  if (result.unusedExports.length > 0) {
    lines.push(formatIssueCount(result.unusedExports.length, "export", "exports"));
    for (const unusedExport of result.unusedExports) {
      lines.push(`  ${unusedExport.path}:${unusedExport.line}  ${unusedExport.name}`);
    }
    lines.push("");
  }

  if (result.unusedDependencies.length > 0) {
    lines.push(formatIssueCount(result.unusedDependencies.length, "dependency", "dependencies"));
    for (const unusedDependency of result.unusedDependencies) {
      const dependencyKind = unusedDependency.isDevDependency ? "dev" : "prod";
      lines.push(`  ${unusedDependency.name} (${dependencyKind})`);
    }
    lines.push("");
  }

  if (result.circularDependencies.length > 0) {
    const cycleLabel = result.circularDependencies.length === 1 ? "cycle" : "cycles";
    lines.push(`${result.circularDependencies.length} circular ${cycleLabel}`);
    for (const circularDependency of result.circularDependencies) {
      lines.push(`  ${circularDependency.files.join(" → ")}`);
    }
    lines.push("");
  }

  const totalIssues =
    result.unusedFiles.length +
    result.unusedExports.length +
    result.unusedDependencies.length +
    result.circularDependencies.length;

  if (totalIssues === 0) {
    lines.push("No unused files, exports, dependencies, or circular imports found.");
  }

  return lines.join("\n").trimEnd() + "\n";
};

export const hasUnusedIssues = (result: ScanResult): boolean =>
  result.unusedFiles.length > 0 ||
  result.unusedExports.length > 0 ||
  result.unusedDependencies.length > 0;

export const hasCircularIssues = (result: ScanResult): boolean => result.circularDependencies.length > 0;
