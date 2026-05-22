import type { UsedInterface, UsedAlias } from "./types";

export const makeRecord = (id: number, value: number): UsedInterface & UsedAlias => ({
  id,
  value,
});
