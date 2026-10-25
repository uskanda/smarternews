// The media type of a relayed image comes from its first bytes, never from what the other site claims: a
// page or a script sent as an image must not reach a screen. SVG is not among the formats, since it can carry
// scripts and links.

export type ImageType = "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "image/avif";

const ascii = (bytes: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(start, start + length));

const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean =>
  bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);

/** The brands of an ISO media file's leading `ftyp` box: the major brand and the compatible ones. */
function brands(bytes: Uint8Array): string[] {
  if (bytes.length < 16 || ascii(bytes, 4, 4) !== "ftyp") return [];
  const size = Math.min(((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0, bytes.length);
  const found = [ascii(bytes, 8, 4)];
  for (let at = 16; at + 4 <= size; at += 4) found.push(ascii(bytes, at, 4));
  return found;
}

/** The format of an image by its first bytes: JPEG, PNG, GIF, WebP or AVIF. Null for anything else. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  const head = ascii(bytes, 0, 6);
  if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (brands(bytes).some((brand) => brand === "avif" || brand === "avis")) return "image/avif";
  return null;
}
