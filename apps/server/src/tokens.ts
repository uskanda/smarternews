import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Reads the token stored at `path`, creating a random one readable only by its owner when there is none. */
export function ensureToken(path: string): { token: string; created: boolean } {
  if (existsSync(path)) {
    const token = readFileSync(path, "utf8").trim();
    if (token.length > 0) return { token, created: false };
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString("base64url");
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return { token, created: true };
}

/**
 * Reads the 32-byte key stored at `path`, creating a random one readable only by its owner when there is none.
 * The file holds the key in base64url, written the way a token is.
 */
export function ensureKey(path: string): { key: Buffer; created: boolean } {
  const { token, created } = ensureToken(path);
  return { key: Buffer.from(token, "base64url"), created };
}
