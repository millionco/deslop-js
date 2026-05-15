import type { ModuleGraph, Edge } from "../types.js";
import { PLATFORM_SUFFIXES } from "../constants.js";

const PLATFORM_DIRECTORY_NAMES = new Set(["web", "native", "ios", "android", "desktop", "windows", "macos"]);

const stripPlatformSuffix = (filePath: string): string | undefined => {
  for (const suffix of PLATFORM_SUFFIXES) {
    const extensionIndex = filePath.lastIndexOf(".");
    if (extensionIndex === -1) continue;

    const withoutExtension = filePath.slice(0, extensionIndex);
    if (withoutExtension.endsWith(suffix)) {
      return withoutExtension.slice(0, -suffix.length) + filePath.slice(extensionIndex);
    }
  }
  return undefined;
};

const stripPlatformDirectory = (filePath: string): string | undefined => {
  const segments = filePath.split("/");
  for (let segmentIndex = segments.length - 2; segmentIndex >= 0; segmentIndex--) {
    if (PLATFORM_DIRECTORY_NAMES.has(segments[segmentIndex])) {
      const withoutPlatformDir = [...segments.slice(0, segmentIndex), ...segments.slice(segmentIndex + 1)].join("/");
      return withoutPlatformDir;
    }
  }
  return undefined;
};

interface ReachabilityQueueItem {
  moduleIndex: number;
  demandedSymbols: Set<string> | "all";
}

export const markReachable = (graph: ModuleGraph): void => {
  const totalModules = graph.modules.length;
  const visited = new Uint8Array(totalModules);
  const consumedExportsPerModule = new Map<number, Set<string>>();
  const queue: ReachabilityQueueItem[] = [];

  const outgoingEdgesMap = new Map<number, Edge[]>();
  for (const edge of graph.edges) {
    const existing = outgoingEdgesMap.get(edge.source);
    if (existing) {
      existing.push(edge);
    } else {
      outgoingEdgesMap.set(edge.source, [edge]);
    }
  }

  for (const module of graph.modules) {
    if (module.isEntryPoint) {
      const moduleIndex = module.fileId.index;
      if (moduleIndex < totalModules) {
        visited[moduleIndex] = 1;
        queue.push({ moduleIndex, demandedSymbols: "all" });
      }
    }
  }

  const markConsumedExports = (targetModuleIndex: number, symbols: Set<string> | "all"): void => {
    if (symbols === "all") {
      consumedExportsPerModule.set(targetModuleIndex, new Set(["*"]));
      return;
    }
    const existing = consumedExportsPerModule.get(targetModuleIndex);
    if (existing && existing.has("*")) return;
    if (existing) {
      for (const symbol of symbols) {
        existing.add(symbol);
      }
    } else {
      consumedExportsPerModule.set(targetModuleIndex, new Set(symbols));
    }
  };

  let headPointer = 0;
  while (headPointer < queue.length) {
    const { moduleIndex: currentIndex, demandedSymbols } = queue[headPointer++];
    const outgoingEdges = outgoingEdgesMap.get(currentIndex);
    if (!outgoingEdges) continue;

    for (const edge of outgoingEdges) {
      const targetIndex = edge.target;
      if (targetIndex >= totalModules) continue;

      if (edge.isReExportEdge) {
        const isWildcardReExport = edge.reExportedNames.includes("*");
        const consumedForCurrent = consumedExportsPerModule.get(currentIndex);
        const allConsumed = consumedForCurrent && consumedForCurrent.has("*");

        if (isWildcardReExport) {
          if (allConsumed || demandedSymbols === "all") {
            if (!visited[targetIndex]) {
              visited[targetIndex] = 1;
              queue.push({ moduleIndex: targetIndex, demandedSymbols: "all" });
              markConsumedExports(targetIndex, "all");
            } else {
              const targetConsumed = consumedExportsPerModule.get(targetIndex);
              if (!targetConsumed || !targetConsumed.has("*")) {
                markConsumedExports(targetIndex, "all");
                queue.push({ moduleIndex: targetIndex, demandedSymbols: "all" });
              }
            }
          } else if (consumedForCurrent && consumedForCurrent.size > 0) {
            const targetModule = graph.modules[targetIndex];
            const targetExportNames = new Set(targetModule.exports.map((exportInfo) => exportInfo.name));
            const matchingSymbols = new Set<string>();

            for (const consumed of consumedForCurrent) {
              if (consumed === "*") continue;
              if (targetExportNames.has(consumed)) {
                matchingSymbols.add(consumed);
              }
            }
            if (matchingSymbols.size > 0) {
              if (!visited[targetIndex]) {
                visited[targetIndex] = 1;
              }
              markConsumedExports(targetIndex, matchingSymbols);
              queue.push({ moduleIndex: targetIndex, demandedSymbols: matchingSymbols });
            }
          }
        } else {
          const reExportedNameSet = new Set(edge.reExportedNames);
          const exportedToOriginal = new Map<string, string>();
          for (const mapping of edge.reExportMappings) {
            exportedToOriginal.set(mapping.exportedName, mapping.originalName);
          }

          const translateToOriginalNames = (matchedExportedNames: Iterable<string>): Set<string> => {
            const originalNames = new Set<string>();
            for (const exportedName of matchedExportedNames) {
              const originalName = exportedToOriginal.get(exportedName) ?? exportedName;
              originalNames.add(originalName);
            }
            return originalNames;
          };

          if (allConsumed || demandedSymbols === "all") {
            const originalNames = translateToOriginalNames(reExportedNameSet);
            if (!visited[targetIndex]) {
              visited[targetIndex] = 1;
              markConsumedExports(targetIndex, originalNames);
              queue.push({ moduleIndex: targetIndex, demandedSymbols: originalNames });
            }
          } else if (consumedForCurrent) {
            const matchingExportedNames = new Set<string>();
            for (const consumed of consumedForCurrent) {
              if (consumed === "*") continue;
              if (reExportedNameSet.has(consumed)) {
                matchingExportedNames.add(consumed);
              }
            }

            if (matchingExportedNames.size > 0) {
              const originalNames = translateToOriginalNames(matchingExportedNames);
              if (!visited[targetIndex]) {
                visited[targetIndex] = 1;
              }
              markConsumedExports(targetIndex, originalNames);
              queue.push({ moduleIndex: targetIndex, demandedSymbols: originalNames });
            }
          }
        }
      } else {
        const importSymbolNames = new Set<string>();
        let isNamespaceOrSideEffect = edge.importedSymbols.length === 0;

        for (const symbol of edge.importedSymbols) {
          if (symbol.isNamespace) {
            isNamespaceOrSideEffect = true;
            break;
          }
          importSymbolNames.add(symbol.importedName);
          if (symbol.isDefault) {
            importSymbolNames.add("default");
          }
        }

        const symbolDemand: Set<string> | "all" = isNamespaceOrSideEffect ? "all" : importSymbolNames;

        if (!visited[targetIndex]) {
          visited[targetIndex] = 1;
          markConsumedExports(targetIndex, symbolDemand);
          queue.push({ moduleIndex: targetIndex, demandedSymbols: symbolDemand });
        } else {
          const existingConsumed = consumedExportsPerModule.get(targetIndex);
          if (symbolDemand !== "all" && existingConsumed && !existingConsumed.has("*")) {
            let hasNewSymbols = false;
            for (const symbol of symbolDemand) {
              if (!existingConsumed.has(symbol)) {
                hasNewSymbols = true;
                break;
              }
            }
            if (hasNewSymbols) {
              markConsumedExports(targetIndex, symbolDemand);
              queue.push({ moduleIndex: targetIndex, demandedSymbols: symbolDemand });
            }
          } else if (symbolDemand === "all" && (!existingConsumed || !existingConsumed.has("*"))) {
            markConsumedExports(targetIndex, "all");
            queue.push({ moduleIndex: targetIndex, demandedSymbols: "all" });
          }
        }
      }
    }
  }

  const platformSiblingGroups = new Map<string, number[]>();
  const addToSiblingGroup = (groupKey: string, moduleIndex: number): void => {
    const existingSiblings = platformSiblingGroups.get(groupKey);
    if (existingSiblings) {
      existingSiblings.push(moduleIndex);
    } else {
      platformSiblingGroups.set(groupKey, [moduleIndex]);
    }
  };

  for (let moduleIndex = 0; moduleIndex < totalModules; moduleIndex++) {
    const modulePath = graph.modules[moduleIndex].fileId.path;

    const basePathFromSuffix = stripPlatformSuffix(modulePath);
    if (basePathFromSuffix) {
      addToSiblingGroup(basePathFromSuffix, moduleIndex);
    }

    const basePathFromDirectory = stripPlatformDirectory(modulePath);
    if (basePathFromDirectory) {
      addToSiblingGroup("dir:" + basePathFromDirectory, moduleIndex);
    }
  }

  for (let moduleIndex = 0; moduleIndex < totalModules; moduleIndex++) {
    const modulePath = graph.modules[moduleIndex].fileId.path;
    if (platformSiblingGroups.has(modulePath)) {
      platformSiblingGroups.get(modulePath)!.push(moduleIndex);
    }
  }

  const platformQueue: ReachabilityQueueItem[] = [];
  for (const siblingIndices of platformSiblingGroups.values()) {
    const hasReachableSibling = siblingIndices.some((index) => Boolean(visited[index]));
    if (hasReachableSibling) {
      for (const siblingIndex of siblingIndices) {
        if (!visited[siblingIndex]) {
          visited[siblingIndex] = 1;
          platformQueue.push({ moduleIndex: siblingIndex, demandedSymbols: "all" });
        }
      }
    }
  }

  let platformHeadPointer = 0;
  while (platformHeadPointer < platformQueue.length) {
    const { moduleIndex: currentIndex } = platformQueue[platformHeadPointer++];
    const outgoingEdges = outgoingEdgesMap.get(currentIndex);
    if (!outgoingEdges) continue;

    for (const edge of outgoingEdges) {
      if (edge.target < totalModules && !visited[edge.target]) {
        visited[edge.target] = 1;
        platformQueue.push({ moduleIndex: edge.target, demandedSymbols: "all" });
      }
    }
  }

  for (let moduleIndex = 0; moduleIndex < totalModules; moduleIndex++) {
    graph.modules[moduleIndex].isReachable = Boolean(visited[moduleIndex]);
  }
};
