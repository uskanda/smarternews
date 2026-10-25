import { describe, expect, it } from "vitest";
import { jpegBytes, pngBytes } from "../testing/images.ts";
import { sniffImageType } from "./format.ts";

const bytes = (...parts: Array<string | number[]>) =>
  new Uint8Array(parts.flatMap((part) => (typeof part === "string" ? [...new TextEncoder().encode(part)] : part)));
const ftyp = (major: string, ...compatible: string[]) => {
  const body = bytes("ftyp", major, [0, 0, 0, 0], ...compatible);
  return bytes([0, 0, 0, body.length + 4], [...body]);
};

const SAMPLES = {
  jpeg: jpegBytes(),
  png: pngBytes(),
  gif: bytes("GIF89a", [1, 0, 1, 0]),
  webp: bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 "),
};

describe("sniffImageType", () => {
  it("tells JPEG, PNG, GIF and WebP by their first bytes", () => {
    expect(sniffImageType(SAMPLES.jpeg)).toBe("image/jpeg");
    expect(sniffImageType(SAMPLES.png)).toBe("image/png");
    expect(sniffImageType(bytes("GIF87a", [1, 0]))).toBe("image/gif");
    expect(sniffImageType(SAMPLES.gif)).toBe("image/gif");
    expect(sniffImageType(SAMPLES.webp)).toBe("image/webp");
  });

  it("tells AVIF by the brands of its file type box", () => {
    expect(sniffImageType(ftyp("avif", "mif1", "miaf"))).toBe("image/avif");
    expect(sniffImageType(ftyp("avis", "avif"))).toBe("image/avif");
    expect(sniffImageType(ftyp("mif1", "miaf", "avif"))).toBe("image/avif");
    // HEIC and MP4 have the same box, with other brands.
    expect(sniffImageType(ftyp("heic", "mif1", "heic"))).toBeNull();
    expect(sniffImageType(ftyp("isom", "mp41"))).toBeNull();
  });

  it("refuses HTML, SVG, other text and an empty body", () => {
    expect(sniffImageType(bytes("<!doctype html><html><body>hi</body></html>"))).toBeNull();
    expect(sniffImageType(bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImageType(bytes('<?xml version="1.0"?><svg/>'))).toBeNull();
    expect(sniffImageType(bytes("RIFF....WAVE"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
    expect(sniffImageType(bytes([0xff, 0xd8]))).toBeNull();
  });
});
