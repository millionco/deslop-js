import type { Vector } from "./vector";
import type { Point } from "./point";

export const describe = (v: Vector, p: Point): string => v.magnitude + "@" + p.x + "," + p.y;
