import type { InternalShape } from "./internal";

export const createInternal = (value: string): InternalShape => ({ secretValue: value });
