export class AuditError extends Error {
  message = "audit failed";
  name = "AuditError";
}

export class CustomEvent extends Event {
  detail: string;
  constructor(type: string, detail: string) {
    super(type);
    this.detail = detail;
  }
}
