import { CustomError, Disposable } from "./special";

export const make = (): CustomError => new CustomError();
export const cleanup = (): Disposable => new Disposable();
