import type { Point as PointA } from "./shape-a";
import type { Point as PointB } from "./shape-b";

export const sum = (a: PointA, b: PointB): number => a.x + a.y + b.x + b.y;
