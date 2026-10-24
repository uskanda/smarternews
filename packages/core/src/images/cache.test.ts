import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fakeClock } from "../testing/db.ts";
import { pngBytes } from "../testing/images.ts";
import { ImageCache } from "./cache.ts";

const DAY = 86_400_000;
const sha = (url: string) => createHash("sha256").update(url).digest("hex");

function setup(options: { maxBytes?: number; days?: number; dir?: string } = {}) {
  const dir = options.dir ?? join(mkdtempSync(join(tmpdir(), "sn-images-")), "image-cache");
  const clock = fakeClock("2026-03-01T00:00:00.000Z");
  const open = () => new ImageCache({ dir, maxBytes: options.maxBytes ?? 1_000_000, maxAgeMs: (options.days ?? 7) * DAY, clock });
  return { dir, clock, open, cache: open() };
}

describe("ImageCache", () => {
  it("keeps an image under the SHA-256 of its original URL and gives it back with its format", async () => {
    const { dir, cache } = setup();
    expect(existsSync(dir)).toBe(false);
    expect(await cache.write("https://img.example.org/a.png", pngBytes(100))).toBe(true);
    expect(readdirSync(dir)).toEqual([sha("https://img.example.org/a.png")]);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const found = await cache.read("https://img.example.org/a.png");
    expect(found?.type).toBe("image/png");
    expect([...found!.bytes]).toEqual([...pngBytes(100)]);
    expect(await cache.read("https://img.example.org/b.png")).toBeNull();
  });

  it("writes through a temporary file, so no part of a file is left under the final name", async () => {
    const { dir, open, cache } = setup();
    await cache.write("https://img.example.org/a.png", pngBytes(100));
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    // What a stop in the middle of a write left behind is removed when the cache is opened.
    writeFileSync(join(dir, `${sha("https://img.example.org/b.png")}.1234.tmp`), "half");
    open();
    expect(readdirSync(dir)).toEqual([sha("https://img.example.org/a.png")]);
  });

  it("treats an image past its period as absent, and replaces it on the next write", async () => {
    const { clock, cache } = setup({ days: 7 });
    await cache.write("https://img.example.org/a.png", pngBytes(100, 1));
    clock.advance(6 * DAY);
    expect(await cache.read("https://img.example.org/a.png")).not.toBeNull();
    clock.advance(2 * DAY);
    expect(await cache.read("https://img.example.org/a.png")).toBeNull();
    await cache.write("https://img.example.org/a.png", pngBytes(100, 2));
    expect([...(await cache.read("https://img.example.org/a.png"))!.bytes]).toEqual([...pngBytes(100, 2)]);
    expect(cache.totalBytes).toBe(100);
  });

  it("deletes the oldest images once the total passes the limit", async () => {
    const { dir, clock, cache } = setup({ maxBytes: 3000 });
    for (const name of ["1", "2", "3", "4"]) {
      await cache.write(`https://img.example.org/${name}.png`, pngBytes(1000));
      clock.advance(1000);
    }
    expect(readdirSync(dir).sort()).toEqual(["2", "3", "4"].map((name) => sha(`https://img.example.org/${name}.png`)).sort());
    expect(cache.totalBytes).toBe(3000);
    expect(await cache.read("https://img.example.org/1.png")).toBeNull();
  });

  it("does not keep an image larger than the limit", async () => {
    const { dir, cache } = setup({ maxBytes: 500 });
    await cache.write("https://img.example.org/small.png", pngBytes(400));
    expect(await cache.write("https://img.example.org/big.png", pngBytes(600))).toBe(false);
    expect(readdirSync(dir)).toEqual([sha("https://img.example.org/small.png")]);
    expect(cache.totalBytes).toBe(400);
  });

  it("adds up the images on disk when it is opened, and counts their age from their modification time", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "sn-images-")), "image-cache");
    mkdirSync(dir);
    const old = sha("https://img.example.org/old.png");
    const recent = sha("https://img.example.org/recent.png");
    writeFileSync(join(dir, old), pngBytes(300));
    writeFileSync(join(dir, recent), pngBytes(200));
    writeFileSync(join(dir, "not-ours.txt"), "x");
    const start = new Date("2026-03-01T00:00:00.000Z").getTime() / 1000;
    utimesSync(join(dir, old), start - 8 * 86_400, start - 8 * 86_400);
    utimesSync(join(dir, recent), start - 86_400, start - 86_400);
    const { cache } = setup({ dir, days: 7 });
    expect(cache.totalBytes).toBe(500);
    expect(await cache.read("https://img.example.org/old.png")).toBeNull();
    expect(await cache.read("https://img.example.org/recent.png")).not.toBeNull();
  });

  it("deletes the images past their period when asked to purge", async () => {
    const { dir, clock, cache } = setup({ days: 7 });
    await cache.write("https://img.example.org/old.png", pngBytes(100));
    clock.advance(3 * DAY);
    await cache.write("https://img.example.org/new.png", pngBytes(100));
    clock.advance(5 * DAY);
    expect(cache.purgeExpired()).toBe(1);
    expect(readdirSync(dir)).toEqual([sha("https://img.example.org/new.png")]);
    expect(cache.totalBytes).toBe(100);
  });

  it("forgets an image whose file disappeared", async () => {
    const { dir, cache } = setup();
    await cache.write("https://img.example.org/a.png", pngBytes(100));
    rmSync(join(dir, sha("https://img.example.org/a.png")));
    expect(await cache.read("https://img.example.org/a.png")).toBeNull();
    expect(cache.totalBytes).toBe(0);
  });
});
