// The relayed images kept on disk: one file per original URL, named by the SHA-256 of that URL. The time an
// image was kept is the file's modification time, and its format is told again from its bytes whenever it is
// read. No table holds any of it: an image that goes missing is simply fetched again.
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, rmSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Clock } from "../clock.ts";
import { sniffImageType, type ImageType } from "./format.ts";

const NAME = /^[0-9a-f]{64}$/;

export interface ImageCacheOptions {
  dir: string;
  /** The total the kept images may reach. Past it, the oldest are deleted. */
  maxBytes: number;
  /** How long an image is kept. An older one counts as absent. */
  maxAgeMs: number;
  clock: Clock;
}

interface Entry {
  size: number;
  keptAt: number;
}

export class ImageCache {
  readonly #options: ImageCacheOptions;
  /** The kept images by file name, oldest first. */
  readonly #entries = new Map<string, Entry>();
  #total = 0;

  /** Opens the directory, when there is one: adds up what it holds and removes what an interrupted write left. */
  constructor(options: ImageCacheOptions) {
    this.#options = options;
    let names: string[] = [];
    try {
      names = readdirSync(options.dir);
    } catch {
      // Made by the first write.
    }
    const found: Array<[string, Entry]> = [];
    for (const name of names) {
      const path = join(options.dir, name);
      if (name.endsWith(".tmp")) {
        rmSync(path, { force: true });
        continue;
      }
      if (!NAME.test(name)) continue;
      const stat = statSync(path, { throwIfNoEntry: false });
      if (stat?.isFile()) found.push([name, { size: stat.size, keptAt: stat.mtimeMs }]);
    }
    found.sort((a, b) => a[1].keptAt - b[1].keptAt);
    for (const [name, entry] of found) this.#add(name, entry);
    this.#evict();
  }

  /** How long an image is kept. */
  get maxAgeMs(): number {
    return this.#options.maxAgeMs;
  }

  /** The bytes of the kept images together. */
  get totalBytes(): number {
    return this.#total;
  }

  /** The kept image of an original URL, or null when there is none, it is past its period, or it is not an image. */
  async read(url: string): Promise<{ bytes: Uint8Array; type: ImageType } | null> {
    const name = nameOf(url);
    const entry = this.#entries.get(name);
    if (entry === undefined || this.#expired(entry)) return null;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(join(this.#options.dir, name)));
    } catch {
      this.#remove(name);
      return null;
    }
    const type = sniffImageType(bytes);
    return type === null ? null : { bytes, type };
  }

  /**
   * Keeps an image, in place of what was kept for the URL, and deletes the oldest images while the total is
   * past the limit. An image larger than the limit is not kept; the answer is then false.
   */
  async write(url: string, bytes: Uint8Array): Promise<boolean> {
    if (bytes.byteLength > this.#options.maxBytes) return false;
    const { dir, clock } = this.#options;
    const name = nameOf(url);
    const path = join(dir, name);
    const temporary = join(dir, `${name}.${randomUUID()}.tmp`);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporary, bytes, { mode: 0o600 });
      const now = clock();
      await utimes(temporary, now, now);
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    this.#remove(name, false);
    this.#add(name, { size: bytes.byteLength, keptAt: clock().getTime() });
    this.#evict();
    return true;
  }

  /** Deletes the images past their period. Answers how many. */
  purgeExpired(): number {
    let count = 0;
    for (const [name, entry] of [...this.#entries]) {
      if (!this.#expired(entry)) continue;
      this.#remove(name);
      count += 1;
    }
    return count;
  }

  #expired(entry: Entry): boolean {
    return this.#options.clock().getTime() - entry.keptAt >= this.#options.maxAgeMs;
  }

  #add(name: string, entry: Entry): void {
    this.#entries.set(name, entry);
    this.#total += entry.size;
  }

  /** Forgets an image, and deletes its file unless `deleteFile` is false. */
  #remove(name: string, deleteFile = true): void {
    const entry = this.#entries.get(name);
    if (entry === undefined) return;
    this.#entries.delete(name);
    this.#total -= entry.size;
    if (deleteFile) rmSync(join(this.#options.dir, name), { force: true });
  }

  #evict(): void {
    for (const name of this.#entries.keys()) {
      if (this.#total <= this.#options.maxBytes) return;
      this.#remove(name);
    }
  }
}

function nameOf(url: string): string {
  return createHash("sha256").update(url, "utf8").digest("hex");
}
