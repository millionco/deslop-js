import type { ModuleGraph } from "../types.js";
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

export const markReachable = (graph: ModuleGraph): void => {
  const totalModules = graph.modules.length;
  const visited = new Uint8Array(totalModules);
  const queue: number[] = [];

  for (const module of graph.modules) {
    if (module.isEntryPoint) {
      const moduleIndex = module.fileId.index;
      if (moduleIndex < totalModules) {
        visited[moduleIndex] = 1;
        queue.push(moduleIndex);
      }
    }
  }

  const adjacencyList = new Map<number, Set<number>>();
  for (const edge of graph.edges) {
    const existingTargets = adjacencyList.get(edge.source);
    if (existingTargets) {
      existingTargets.add(edge.target);
    } else {
      adjacencyList.set(edge.source, new Set([edge.target]));
    }
  }

  let headPointer = 0;
  while (headPointer < queue.length) {
    const currentIndex = queue[headPointer++];
    const neighborTargets = adjacencyList.get(currentIndex);
    if (!neighborTargets) continue;

    for (const targetIndex of neighborTargets) {
      if (targetIndex < totalModules && !visited[targetIndex]) {
        visited[targetIndex] = 1;
        queue.push(targetIndex);
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

  const platformQueue: number[] = [];
  for (const siblingIndices of platformSiblingGroups.values()) {
    const hasReachableSibling = siblingIndices.some((index) => Boolean(visited[index]));
    if (hasReachableSibling) {
      for (const siblingIndex of siblingIndices) {
        if (!visited[siblingIndex]) {
          visited[siblingIndex] = 1;
          platformQueue.push(siblingIndex);
        }
      }
    }
  }

  let platformHeadPointer = 0;
  while (platformHeadPointer < platformQueue.length) {
    const currentIndex = platformQueue[platformHeadPointer++];
    const neighborTargets = adjacencyList.get(currentIndex);
    if (!neighborTargets) continue;

    for (const targetIndex of neighborTargets) {
      if (targetIndex < totalModules && !visited[targetIndex]) {
        visited[targetIndex] = 1;
        platformQueue.push(targetIndex);
      }
    }
  }

  for (let moduleIndex = 0; moduleIndex < totalModules; moduleIndex++) {
    graph.modules[moduleIndex].isReachable = Boolean(visited[moduleIndex]);
  }
};
