import type { Vector } from "./types";

/**
 * @param {Vector} vector incoming vector
 * @returns {number}
 */
export const magnitude = (vector: Vector): number =>
  Math.sqrt(vector.x * vector.x + vector.y * vector.y);
