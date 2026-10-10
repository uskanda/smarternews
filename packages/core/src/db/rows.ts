// node:sqlite hands back loosely typed rows. These helpers narrow one column at a time.
export type Row = Record<string, unknown>;

export function num(value: unknown): number {
  return typeof value === "bigint" ? Number(value) : (value as number);
}

export function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : num(value);
}

export function str(value: unknown): string {
  return value as string;
}

export function strOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : (value as string);
}

export function bool(value: unknown): boolean {
  return num(value) !== 0;
}

export function json<T>(value: unknown): T {
  return JSON.parse(value as string) as T;
}
