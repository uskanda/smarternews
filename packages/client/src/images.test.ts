import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { relayedImageUrl } from "./images.ts";

const PATH = "/api/v1/image-proxy/c2lnbmF0dXJl/aHR0cHM6Ly9pbWcuZXhhbXBsZS5vcmcvYS5wbmc";

describe("relayedImageUrl", () => {
  it("resolves a path of the relay against the server's URL, with or without a slash at its end", () => {
    expect(relayedImageUrl("http://127.0.0.1:8787", PATH)).toBe(`http://127.0.0.1:8787${PATH}`);
    expect(relayedImageUrl("https://reader.example/", PATH)).toBe(`https://reader.example${PATH}`);
  });

  it("refuses every image that is not on the relay, so that no other site is asked", () => {
    for (const src of [
      "https://img.example.org/a.png",
      "http://img.example.org/a.png",
      "//img.example.org/api/v1/image-proxy/a/b",
      "/api/v1/articles",
      "data:image/png;base64,AAAA",
      "",
    ]) {
      expect(relayedImageUrl("https://reader.example", src), src).toBeNull();
    }
  });

  it("uses neither the DOM nor Node, so that the web app and the Android app can both use it", () => {
    const source = readFileSync(join(import.meta.dirname, "images.ts"), "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(imports).toEqual(["@smarternews/core/api"]);
    expect(source).not.toMatch(/\b(window|document|location|Buffer|process)\b/);
  });
});
