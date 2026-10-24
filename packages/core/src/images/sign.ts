// The URLs of relayed images carry a signature of the original URL, so that the relay serves only the images
// the API named and is no proxy for anyone who finds the server. Signatures do not expire: a URL stays valid
// until the key is made anew.
import { createHmac, timingSafeEqual } from "node:crypto";
import { IMAGE_PROXY_PATH } from "../api.ts";

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function sign(key: Uint8Array, url: string): Buffer {
  return createHmac("sha256", key).update(url, "utf8").digest();
}

/** The path under which the server relays the image at `url`. */
export function imageProxyPath(key: Uint8Array, url: string): string {
  return `${IMAGE_PROXY_PATH}${sign(key, url).toString("base64url")}/${Buffer.from(url, "utf8").toString("base64url")}`;
}

/** The original URL of a relay path's two parts, or null when the signature does not match or a part is malformed. */
export function verifyImageProxyPath(key: Uint8Array, signature: string, encoded: string): string | null {
  if (!BASE64URL.test(signature) || !BASE64URL.test(encoded)) return null;
  const given = Buffer.from(signature, "base64url");
  const bytes = Buffer.from(encoded, "base64url");
  // Only the canonical spelling is accepted: one URL has one relay path.
  if (given.toString("base64url") !== signature || bytes.toString("base64url") !== encoded) return null;
  const url = bytes.toString("utf8");
  const expected = sign(key, url);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return url;
}
