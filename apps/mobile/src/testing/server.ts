// A real API with an in-memory database for one test, reached over HTTP. The server runs in the test process
// that `global-setup.js` started; the functions here put data into it and move its clock.
import type { Category } from "@smarternews/core/api";
import { nodeFetch } from "./fetch";

const HOST = process.env.SMARTERNEWS_TEST_API ?? "";

async function control<T>(command: Record<string, unknown>): Promise<T> {
  const response = await nodeFetch(`${HOST}/__control`, { method: "POST", body: JSON.stringify(command) });
  const body = (await response.json()) as { result?: T; error?: string };
  if (!response.ok) throw new Error(`test server: ${body.error}`);
  return body.result as T;
}

export interface ArticleOverrides {
  kind?: "news" | "event";
  title?: string;
  summary?: string;
  body?: string;
  impact?: string | null;
  importance?: number;
  unconfirmed?: boolean;
  snippetOnly?: boolean;
  event?: Record<string, unknown> | null;
  refs?: string[];
}

export type TestServer = Awaited<ReturnType<typeof makeServer>>;

/** A server set to UTC, so that expected times can be read off the fixtures. */
export async function makeServer(start = "2026-03-01T12:00:00.000Z", options: { webSearch?: boolean } = {}) {
  const { id, url, apiToken } = await control<{ id: string; url: string; apiToken: string }>({ op: "create", start, ...options });
  let now = new Date(start).getTime();
  const call = <T>(op: string, extra: Record<string, unknown> = {}) => control<T>({ op, id, ...extra });
  /** Runs a function of the core package that takes the database first. Pass "$clock" for the clock. */
  const core = <T = unknown>(name: string, ...args: unknown[]) => call<T>("core", { name, args });
  await core("updateSettings", { timeZone: "UTC", outputLanguage: "ja" });
  return {
    /** What a user types as the server's URL. */
    url,
    token: apiToken,
    now: () => new Date(now),
    async advance(ms: number): Promise<void> {
      now += ms;
      await call("advance", { args: [ms] });
    },
    category: (name = "Security", kind: "news" | "event" = "news") => call<Category>("category", { args: [name, kind] }),
    article: (categoryId: number, overrides: ArticleOverrides = {}) => call<number>("article", { args: [categoryId, overrides] }),
    core,
    sql: <T = unknown>(query: string, ...args: unknown[]) => call<T>("sql", { query, args }),
  };
}
