export type DomainErrorCode = "invalid" | "not_found" | "conflict" | "unavailable";

export interface FieldError {
  path: string;
  message: string;
}

/** A refusal the caller can act on. The HTTP layer maps the code to a status. */
export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly fields: FieldError[];

  constructor(code: DomainErrorCode, message: string, fields: FieldError[] = []) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.fields = fields;
  }
}

export function notFound(what: string, id: number | string): DomainError {
  return new DomainError("not_found", `${what} ${id} does not exist`);
}
