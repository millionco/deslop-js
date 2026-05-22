import type { ToolbarState } from "./types";
import { loadToolbarState } from "./state";

export const useToolbar = (): ToolbarState | null => loadToolbarState();
