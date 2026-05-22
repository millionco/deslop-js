import { buildA } from "./api-a";
import { buildB } from "./api-b";

export const composed = (): string => buildA() + buildB();
