import { transform as transformA } from "./transformer-a";
import { transform as transformB } from "./transformer-b";

export const apply = (value: number): number => transformB(transformA(value));
