// The relay of images: what a screen loads from the server instead of from the other site. An image is taken
// from disk when it is kept there, and fetched otherwise, under the limits of every fetch but without the
// interval per host and without robots.txt. Fetches to one host are at most four at a time.
import { FetchError, type Fetcher } from "../fetch/http.ts";
import type { ImageCache } from "./cache.ts";
import { sniffImageType, type ImageType } from "./format.ts";

/** The largest image the relay fetches, in bytes. */
export const IMAGE_MAX_BYTES = 10_000_000;
/** How many fetches to one host the relay keeps open at once. */
export const IMAGE_FETCHES_PER_HOST = 4;
/** The formats the relay accepts. SVG is not among them. */
const ACCEPT = "image/avif,image/webp,image/png,image/jpeg,image/gif";

/** An image could not be relayed: the destination is refused, the site failed, or the answer is no image. */
export class ImageFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageFetchError";
  }
}

export interface RelayedImage {
  bytes: Uint8Array;
  type: ImageType;
}

/** Fetches to one host: how many are open, and the ones that wait for a place, first come first. */
interface HostSlots {
  open: number;
  waiting: Array<() => void>;
}

export class ImageProxy {
  readonly #fetcher: Fetcher;
  readonly #cache: ImageCache;
  readonly #log: (message: string) => void;
  /** Per original URL, the fetch in progress, which later requests for the same image share. */
  readonly #running = new Map<string, Promise<RelayedImage>>();
  readonly #hosts = new Map<string, HostSlots>();

  constructor(options: { fetcher: Fetcher; cache: ImageCache; log?: (message: string) => void }) {
    this.#fetcher = options.fetcher;
    this.#cache = options.cache;
    this.#log = options.log ?? ((message) => console.error(message));
  }

  /** The image at an original URL. Throws an `ImageFetchError` when it cannot be had. */
  get(url: string): Promise<RelayedImage> {
    const running = this.#running.get(url);
    if (running) return running;
    const promise = this.#load(url).finally(() => this.#running.delete(url));
    this.#running.set(url, promise);
    return promise;
  }

  /** How long an image is kept on disk; a screen may keep it as long. */
  get maxAgeMs(): number {
    return this.#cache.maxAgeMs;
  }

  /** Deletes the kept images past their period. */
  purgeExpired(): number {
    return this.#cache.purgeExpired();
  }

  async #load(url: string): Promise<RelayedImage> {
    const kept = await this.#cache.read(url);
    if (kept) return kept;
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      throw new ImageFetchError("the original is not a URL");
    }
    const release = await this.#place(host);
    let image: RelayedImage;
    try {
      image = await this.#fetch(url);
    } finally {
      release();
    }
    try {
      await this.#cache.write(url, image.bytes);
    } catch (error) {
      // The image is shown all the same; it is fetched again next time.
      this.#log(`image relay: could not keep an image: ${(error as Error).message}`);
    }
    return image;
  }

  async #fetch(url: string): Promise<RelayedImage> {
    let bytes: Uint8Array;
    try {
      ({ bytes } = await this.#fetcher.getBytes(url, {
        maxBytes: IMAGE_MAX_BYTES,
        headers: { accept: ACCEPT },
        inspect: ({ status, contentType }) => {
          if (status < 200 || status > 299) throw new ImageFetchError(`the site answered HTTP status ${status}`);
          if (/^\s*image\/svg/i.test(contentType)) throw new ImageFetchError("the site answered with an SVG image");
        },
      }));
    } catch (error) {
      if (error instanceof ImageFetchError) throw error;
      if (error instanceof FetchError) throw new ImageFetchError(error.message);
      throw error;
    }
    const type = sniffImageType(bytes);
    if (type === null) throw new ImageFetchError("the answer is not an image in a known format");
    return { bytes, type };
  }

  /** Waits for a place among the fetches to a host. The answer gives the place back. */
  async #place(host: string): Promise<() => void> {
    let slots = this.#hosts.get(host);
    if (!slots) {
      slots = { open: 0, waiting: [] };
      this.#hosts.set(host, slots);
    }
    if (slots.open < IMAGE_FETCHES_PER_HOST) slots.open += 1;
    else await new Promise<void>((resolve) => slots.waiting.push(resolve));
    // A place that is handed on stays counted as open.
    return () => {
      const next = slots.waiting.shift();
      if (next) return next();
      slots.open -= 1;
      if (slots.open === 0) this.#hosts.delete(host);
    };
  }
}
