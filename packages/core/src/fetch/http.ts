// The one place that talks HTTP to other sites. It names the crawler, bounds time and size, keeps a minimum
// interval between requests to the same host, and refuses destinations on this machine or its own network.
import { systemClock, type Clock } from "../clock.ts";
import { allowSet, checkUrl, createGuardedFetch, DESTINATION_CODE } from "./guard.ts";

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
  /** The response headers, with their names in lower case. */
  headers: Record<string, string>;
  text: string;
}

export interface FetcherOptions {
  userAgent: string;
  hostIntervalMs: number;
  timeoutMs: number;
  maxBytes: number;
  /** Hosts that may be fetched although they are, or resolve to, loopback, private, link-local or shared-space addresses. */
  allowPrivateHosts?: readonly string[];
  /** Replaces the network in tests. Without it, every connection also checks the address the name resolved to. */
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

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function notAllowed(url: string, reason: string): FetchError {
  return new FetchError(`destination not allowed: ${url} (${reason}); to fetch it, list the host under fetch.allowPrivateHosts in config.yaml`);
}

export class Fetcher {
  readonly #options: Required<FetcherOptions>;
  readonly #allowed: ReadonlySet<string>;
  /** Per host: the earliest time the next request may start. */
  readonly #nextSlot = new Map<string, number>();

  constructor(options: FetcherOptions) {
    this.#allowed = allowSet(options.allowPrivateHosts ?? []);
    this.#options = {
      allowPrivateHosts: [],
      fetchImpl: createGuardedFetch(this.#allowed),
      clock: systemClock,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      ...options,
    };
  }

  get userAgent(): string {
    return this.#options.userAgent;
  }

  async get(url: string, request: RequestOptions = {}): Promise<HttpResponse> {
    const { fetchImpl, timeoutMs, maxBytes, userAgent } = this.#options;
    const signal = AbortSignal.timeout(timeoutMs);
    let current = url;
    let method = request.method ?? "GET";
    let body = request.body;
    let headers: Record<string, string> = { "user-agent": userAgent, accept: "*/*", ...request.headers };
    let response: Response;
    // Redirects are followed here and not by fetch, so that each target is checked before it is asked.
    for (let followed = 0; ; followed++) {
      const refusal = checkUrl(current, this.#allowed);
      if (refusal) throw notAllowed(current, refusal);
      await this.#waitForHost(new URL(current).host);
      try {
        response = await fetchImpl(current, { method, body, headers, redirect: "manual", signal });
      } catch (error) {
        const name = (error as Error).name;
        if (name === "TimeoutError" || name === "AbortError") throw new FetchError(`timed out after ${timeoutMs} ms: ${url}`);
        const cause = (error as { cause?: { code?: string; message?: string } }).cause;
        if (cause?.code === DESTINATION_CODE) throw notAllowed(current, cause.message ?? "refused address");
        throw new FetchError(`request failed: ${current}: ${(error as Error).message}`);
      }
      const location = REDIRECT_STATUSES.has(response.status) ? response.headers.get("location") : null;
      if (location === null) break;
      await response.body?.cancel();
      if (followed >= MAX_REDIRECTS) throw new FetchError(`more than ${MAX_REDIRECTS} redirects: ${url}`);
      const from = new URL(current).origin;
      try {
        current = new URL(location, current).toString();
      } catch {
        throw new FetchError(`redirect to something that is not a URL: ${url}`);
      }
      // What the caller sent was meant for the site it asked: a key or a validator does not follow to another one.
      if (new URL(current).origin !== from) headers = { "user-agent": userAgent, accept: "*/*" };
      if (response.status !== 307 && response.status !== 308 && method !== "GET") {
        method = "GET";
        body = undefined;
        headers = Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== "content-type"));
      }
    }
    const bytes = await this.#readBody(response, current, maxBytes);
    const contentType = response.headers.get("content-type") ?? "";
    const responseHeaders = Object.fromEntries(response.headers.entries());
    return { status: response.status, url: current, contentType, headers: responseHeaders, text: decode(bytes, contentType) };
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
