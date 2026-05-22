import { AuditError, CustomEvent } from "./errors";

export const createError = (): AuditError => new AuditError();
export const createEvent = (type: string, detail: string): CustomEvent =>
  new CustomEvent(type, detail);
