export type DomainErrorCode = "invalid" | "not_found" | "conflict" | "unavailable";

/**
 * What kind of refusal a field met, for an app to word in its own language. `message` stays English, for the
 * CLI and the logs; a field without a code is worded by the apps as a value that cannot be saved.
 */
export const FIELD_ERROR_CODES = [
  // From the schema.
  "required",
  "too_small",
  "too_big",
  "format",
  "invalid_value",
  "custom",
  // From the checks the server makes itself.
  "unknown_time_zone",
  "no_such_item",
  "not_allowed",
  "unreachable",
  "no_items",
] as const;
export type FieldErrorCode = (typeof FIELD_ERROR_CODES)[number];

/** What a bound of `too_small` or `too_big` counts: characters of a text, a number, or items of a list. */
export const FIELD_ERROR_UNITS = ["chars", "number", "items"] as const;
export type FieldErrorUnit = (typeof FIELD_ERROR_UNITS)[number];

export interface FieldError {
  path: string;
  message: string;
  code?: FieldErrorCode;
  minimum?: number;
  maximum?: number;
  unit?: FieldErrorUnit;
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
