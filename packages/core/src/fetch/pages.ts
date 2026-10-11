import robotsParser from "robots-parser";
import type { Fetcher } from "./http.ts";

export type PageResult =
  | { ok: true; html: string; url: string }
  | { ok: false; reason: "robots" | "limit" }
  | { ok: false; reason: "http" | "error" | "not-html"; detail: string };

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
  readonly #robots = new Map<string, Promise<Robots | "deny">>();
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
    if (!(await this.#allowed(url))) return { ok: false, reason: "robots" };
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
        return { ok: false, reason: "http", detail: `HTTP status ${response.status}` };
      }
      if (response.contentType !== "" && !/html|xml/i.test(response.contentType)) {
        return { ok: false, reason: "not-html", detail: response.contentType };
      }
      return { ok: true, html: response.text, url: response.url };
    } catch (error) {
      return { ok: false, reason: "error", detail: (error as Error).message };
    }
  }

  async #allowed(url: string): Promise<boolean> {
    const origin = new URL(url).origin;
    let rules = this.#robots.get(origin);
    if (!rules) {
      rules = this.#loadRobots(origin);
      this.#robots.set(origin, rules);
    }
    const robots = await rules;
    return robots === "deny" ? false : robots.isAllowed(url, ROBOTS_AGENT) !== false;
  }

  /** No robots.txt (a 4xx answer) allows everything. A robots.txt that cannot be read forbids everything. */
  async #loadRobots(origin: string): Promise<Robots | "deny"> {
    const robotsUrl = `${origin}/robots.txt`;
    try {
      const response = await this.#fetcher.get(robotsUrl);
      if (response.status >= 400 && response.status < 500) return robotsParse(robotsUrl, "");
      if (response.status < 200 || response.status >= 300) return "deny";
      return robotsParse(robotsUrl, response.text);
    } catch {
      return "deny";
    }
  }
}
