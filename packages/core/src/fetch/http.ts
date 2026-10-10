// The one place that talks HTTP to other sites. It names the crawler, bounds time and size, and keeps a
// minimum interval between requests to the same host.
import { systemClock, type Clock } from "../clock.ts";

export const REPOSITORY_URL = "https://github.com/uskanda/smarternews";

export function defaultUserAgent(version: string): string {
  return `smarternews/${version} (+${REPOSITORY_URL})`;
}

export class FetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchError";
  }
}

export interface HttpResponse {
  status: number;
  /** The URL after redirects. */
  url: string;
  contentType: string;
  text: string;
}

export interface FetcherOptions {
  userAgent: string;
  hostIntervalMs: number;
  timeoutMs: number;
  maxBytes: number;
  fetchImpl?: typeof fetch;
  clock?: Clock;
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

function declaredCharset(contentType: string, head: Uint8Array): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader;
  const sniffed = new TextDecoder("latin1").decode(head.subarray(0, 2048));
  return (
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(sniffed)?.[1] ?? /<\?xml[^>]+encoding=["']([\w-]+)["']/i.exec(sniffed)?.[1] ?? "utf-8"
  );
}

function decode(bytes: Uint8Array, contentType: string): string {
  try {
    return new TextDecoder(declaredCharset(contentType, bytes)).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export class Fetcher {
  readonly #options: Required<FetcherOptions>;
  /** Per host: the earliest time the next request may start. */
  readonly #nextSlot = new Map<string, number>();

  constructor(options: FetcherOptions) {
    this.#options = {
      fetchImpl: fetch,
      clock: systemClock,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      ...options,
    };
  }

  get userAgent(): string {
    return this.#options.userAgent;
  }

  async get(url: string, request: RequestOptions = {}): Promise<HttpResponse> {
    await this.#waitForHost(new URL(url).host);
    const { fetchImpl, timeoutMs, maxBytes, userAgent } = this.#options;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: request.method ?? "GET",
        body: request.body,
        headers: { "user-agent": userAgent, accept: "*/*", ...request.headers },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = (error as Error).name;
      if (name === "TimeoutError" || name === "AbortError") throw new FetchError(`timed out after ${timeoutMs} ms: ${url}`);
      throw new FetchError(`request failed: ${url}: ${(error as Error).message}`);
    }
    const bytes = await this.#readBody(response, url, maxBytes);
    const contentType = response.headers.get("content-type") ?? "";
    return { status: response.status, url: response.url || url, contentType, text: decode(bytes, contentType) };
  }

  async #waitForHost(host: string): Promise<void> {
    const { clock, sleep, hostIntervalMs } = this.#options;
    const now = clock().getTime();
    const slot = Math.max(now, this.#nextSlot.get(host) ?? 0);
    this.#nextSlot.set(host, slot + hostIntervalMs);
    if (slot > now) await sleep(slot - now);
  }

  async #readBody(response: Response, url: string, maxBytes: number): Promise<Uint8Array> {
    const tooLarge = () => new FetchError(`response larger than ${maxBytes} bytes: ${url}`);
    if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
      await response.body?.cancel();
      throw tooLarge();
    }
    if (!response.body) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw tooLarge();
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof FetchError) throw error;
      const name = (error as Error).name;
      throw new FetchError(name === "TimeoutError" ? `timed out after ${this.#options.timeoutMs} ms: ${url}` : `reading failed: ${url}`);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
}
