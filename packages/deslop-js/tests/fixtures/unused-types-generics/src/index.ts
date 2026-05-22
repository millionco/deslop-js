import type { Box } from "./types";

export const wrapPayload = (payload: { id: string }): Box<{ id: string }> => ({ payload });
