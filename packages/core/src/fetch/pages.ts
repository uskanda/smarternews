import robotsParser from "robots-parser";
import { FetchError, type Fetcher } from "./http.ts";

/**
 * A fetched page, or why there is none: robots.txt forbids it, the run's limit is reached, the destination is
 * refused, the site answered with an HTTP failure, did not answer in time, answered with something that is
 * not a document, or the request failed otherwise.
 */
export type PageResult =
  | { ok: true; html: string; url: string }
  | { ok: false; reason: "robots" | "limit" }
  | { ok: false; reason: "http"; status: number; detail: string }
  | { ok: false; reason: "blocked" | "timeout" | "error" | "not-html"; detail: string };

type Robots = { isAllowed(url: string, userAgent?: string): boolean | undefined };
const robotsParse = robotsParser as unknown as (url: string, text: string) => Robots;

/** The product token that robots.txt rules are matched against. */
const ROBOTS_AGENT = "smarternews";

/**
 * Fetches article pages for one run. It honours robots.txt, stops at the run's page limit, and remembers
 * what it fetched so that a page is requested once. With `remember: false` it keeps no page, for a user
 * that lives longer than a run and asks for every page once anyway.
 */
export class PageFetcher {
  readonly #fetcher: Fetcher;
  readonly #pagesPerRun: number;
  readonly #robots = new Map<string, Promise<Robots | "deny" | "blocked">>();
  readonly #pages = new Map<string, PageResult>();
  readonly #remember: boolean;
  #fetched = 0;

  constructor(fetcher: Fetcher, options: { pagesPerRun: number; remember?: boolean }) {
    this.#fetcher = fetcher;
    this.#pagesPerRun = options.pagesPerRun;
    this.#remember = options.remember ?? true;
  }

  async fetchPage(url: string): Promise<PageResult> {
    const cached = this.#pages.get(url);
    if (cached) return cached;
    const allowed = await this.#allowed(url);
    if (allowed === "blocked") return { ok: false, reason: "blocked", detail: `destination not allowed: ${url}` };
    if (allowed === "robots") return { ok: false, reason: "robots" };
    if (this.#fetched >= this.#pagesPerRun) return { ok: false, reason: "limit" };
    this.#fetched += 1;
    const result = await this.#request(url);
    if (this.#remember) this.#pages.set(url, result);
    return result;
  }

  async #request(url: string): Promise<PageResult> {
    try {
      const response = await this.#fetcher.get(url, { headers: { accept: "text/html,application/xhtml+xml" } });
      if (response.status < 200 || response.status >= 300) {
        return { ok: false, reason: "http", status: response.status, detail: `HTTP status ${response.status}` };
      }
      if (response.contentType !== "" && !/html|xml/i.test(response.contentType)) {
        return { ok: false, reason: "not-html", detail: response.contentType };
      }
      return { ok: true, html: response.text, url: response.url };
    } catch (error) {
      const kind = error instanceof FetchError ? error.kind : "error";
      return { ok: false, reason: kind, detail: (error as Error).message };
    }
  }

  /** Whether robots.txt lets the page be fetched; "blocked" when the site is a refused destination. */
  async #allowed(url: string): Promise<"yes" | "robots" | "blocked"> {
    const origin = new URL(url).origin;
    let rules = this.#robots.get(origin);
    if (!rules) {
      rules = this.#loadRobots(origin);
      this.#robots.set(origin, rules);
    }
    const robots = await rules;
    if (robots === "blocked" || robots === "deny") return robots === "blocked" ? "blocked" : "robots";
    return robots.isAllowed(url, ROBOTS_AGENT) !== false ? "yes" : "robots";
  }

  /**
   * No robots.txt (a 4xx answer) allows everything. A robots.txt that cannot be read forbids everything. A
   * site this server must not ask at all is told apart: no page of it is fetched either.
   */
  async #loadRobots(origin: string): Promise<Robots | "deny" | "blocked"> {
    const robotsUrl = `${origin}/robots.txt`;
    try {
      const response = await this.#fetcher.get(robotsUrl);
      if (response.status >= 400 && response.status < 500) return robotsParse(robotsUrl, "");
      if (response.status < 200 || response.status >= 300) return "deny";
      return robotsParse(robotsUrl, response.text);
    } catch (error) {
      if (error instanceof FetchError && error.kind === "blocked") return "blocked";
      return "deny";
    }
  }
}
