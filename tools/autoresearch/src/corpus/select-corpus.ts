import { readFileSync } from "node:fs";
import type { RepoEntry } from "../types.js";
import { REPOS_JSON_PATH } from "../constants.js";

export const loadRepoEntries = (): RepoEntry[] => {
  const text = readFileSync(REPOS_JSON_PATH, "utf-8");
  return JSON.parse(text) as RepoEntry[];
};

export const slugifyEntry = (entry: RepoEntry): string => {
  const shortRef = entry.ref.slice(0, 10);
  const safeRootDir = entry.rootDir.replace(/[/\\]/g, "__").replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${entry.org}__${entry.name}__${shortRef}__${safeRootDir}`;
};

export const repoSlug = (entry: RepoEntry): string => {
  const shortRef = entry.ref.slice(0, 10);
  return `${entry.org}__${entry.name}__${shortRef}`;
};

const FAST_TIER_PRIORITY = new Set([
  "pierrecomputer/pierre",
  "aidenybai/react-grab",
  "aidenybai/bippy",
  "millionco/expect",
  "aidenybai/react-scan",
  "RhysSullivan/executor",
  "dubinc/dub",
  "better-auth/better-auth",
  "shadcn-ui/ui",
  "tldraw/tldraw",
  "unkeyed/unkey",
  "langfuse/langfuse",
  "triggerdotdev/trigger.dev",
  "baptisteArno/typebot.io",
  "lobehub/lobe-chat",
  "onlook-dev/onlook",
  "formbricks/formbricks",
  "calcom/cal.com",
  "payloadcms/payload",
  "medusajs/medusa",
]);

const HUGE_REPOS_TO_DEPRIORITIZE = new Set([
  "PostHog/posthog",
  "getsentry/sentry",
  "supabase/supabase",
  "nodejs/nodejs.org",
  "RocketChat/Rocket.Chat",
  "appsmithorg/appsmith",
  "ToolJet/ToolJet",
  "excalidraw/excalidraw",
  "twentyhq/twenty",
  "makeplane/plane",
]);

const dedupeBy = <Item, Key>(items: Item[], keyOf: (item: Item) => Key): Item[] => {
  const seen = new Set<Key>();
  const output: Item[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
};

export interface CorpusSelection {
  tier: "fast" | "mid" | "full" | "all";
  entries: RepoEntry[];
}

export const selectCorpus = (
  tier: "fast" | "mid" | "full" | "all",
  allEntries: RepoEntry[],
): CorpusSelection => {
  if (tier === "all") {
    return { tier, entries: allEntries };
  }

  const seenRepoEntries = new Map<string, RepoEntry[]>();
  for (const entry of allEntries) {
    const repoKey = `${entry.org}/${entry.name}`;
    const list = seenRepoEntries.get(repoKey) ?? [];
    list.push(entry);
    seenRepoEntries.set(repoKey, list);
  }

  const fastTierEntries: RepoEntry[] = [];
  const midTierExtras: RepoEntry[] = [];
  const fullTierExtras: RepoEntry[] = [];

  for (const [repoKey, entries] of seenRepoEntries) {
    if (FAST_TIER_PRIORITY.has(repoKey)) {
      fastTierEntries.push(...entries.slice(0, 4));
      midTierExtras.push(...entries.slice(4, 12));
    } else if (HUGE_REPOS_TO_DEPRIORITIZE.has(repoKey)) {
      fullTierExtras.push(...entries.slice(0, 3));
    } else {
      midTierExtras.push(...entries.slice(0, 3));
    }
  }

  const fastEntries = dedupeBy(fastTierEntries, slugifyEntry).slice(0, 25);
  if (tier === "fast") return { tier, entries: fastEntries };

  const midEntries = dedupeBy([...fastEntries, ...midTierExtras], slugifyEntry).slice(0, 80);
  if (tier === "mid") return { tier, entries: midEntries };

  const fullEntries = dedupeBy(
    [...fastEntries, ...midTierExtras, ...fullTierExtras],
    slugifyEntry,
  ).slice(0, 200);
  return { tier, entries: fullEntries };
};
