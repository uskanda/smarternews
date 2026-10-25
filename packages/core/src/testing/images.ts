// Image bodies for tests of the relay: the first bytes of each format, padded to the size a test needs.

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46];

function padded(head: number[], size: number, fill: number): Uint8Array {
  const bytes = new Uint8Array(Math.max(size, head.length)).fill(fill);
  bytes.set(head);
  return bytes;
}

/** A body that starts like a PNG image, `size` bytes long. `fill` tells two bodies of one size apart. */
export function pngBytes(size = 64, fill = 0): Uint8Array {
  return padded(PNG, size, fill);
}

/** A body that starts like a JPEG image. */
export function jpegBytes(size = 64, fill = 0): Uint8Array {
  return padded(JPEG, size, fill);
}

/** A response with an image body, as another site answers. */
export function imageResponse(bytes: Uint8Array, contentType = "image/png"): Response {
  return new Response(bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { "content-type": contentType } });
}
