import type { StringId } from "./identifier-a";
import type { UserId } from "./identifier-b";

export const merge = (left: StringId, right: UserId): string => left.id + right.id;
