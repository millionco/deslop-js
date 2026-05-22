export type { PublicShape } from "./types";
import type { PublicShape } from "./types";

export const buildPublic = (value: string): PublicShape => ({ value });
export const concat = (left: string, right: string): string => left + right;
