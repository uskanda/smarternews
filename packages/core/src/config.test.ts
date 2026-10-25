import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig, resolveAssignment, translationApiKey } from "./config.ts";

describe("parseConfig", () => {
  it("listens on the local host only and uses the claude command when nothing is configured", () => {
    const config = parseConfig(null);
    expect(config.listen).toBe("127.0.0.1:8787");
    expect(config.providers).toEqual({
      fast: { adapter: "claude-cli", model: "haiku", command: "claude", extraArgs: [] },
      smart: { adapter: "claude-cli", model: "sonnet", command: "claude", extraArgs: [] },
    });
    expect(resolveAssignment(config)).toEqual({
      interpret: "smart",
      search: "smart",
      judge: "fast",
      cluster: "fast",
      write: "smart",
      summarize: "fast",
      translate: "fast",
    });
  });

  it("falls back to the default provider for a task without an assignment", () => {
    const config = parseConfig(`
providers:
  a: { adapter: claude-cli, model: sonnet }
  b: { adapter: openai-compatible, baseUrl: "http://127.0.0.1:1/v1", model: m }
tasks: { default: a, judge: b }
`);
    expect(resolveAssignment(config)).toEqual({ interpret: "a", search: "a", judge: "b", cluster: "a", write: "a", summarize: "a", translate: "a" });
  });

  it("assigns every task to the only provider when no tasks are given", () => {
    const config = parseConfig("providers:\n  only: { adapter: claude-cli, model: sonnet }\n");
    expect(resolveAssignment(config).write).toBe("only");
  });

  it("names the task and the provider when an assignment points nowhere", () => {
    const config = parseConfig(`
providers:
  a: { adapter: claude-cli, model: sonnet }
tasks: { default: a, judge: missing }
`);
    expect(() => resolveAssignment(config)).toThrow(ConfigError);
    expect(() => resolveAssignment(config)).toThrow(/judge.*missing/);
  });

  it("refuses an API key written into the file", () => {
    const text = `
providers:
  a: { adapter: openai-compatible, baseUrl: "http://127.0.0.1:1/v1", model: m, apiKey: secret-value }
`;
    expect(() => parseConfig(text)).toThrow(ConfigError);
    expect(() => parseConfig(text)).not.toThrow(/secret-value/);
  });

  it("reports the path of an invalid value", () => {
    expect(() => parseConfig("limits:\n  llmCallsPerRun: many\n")).toThrow(/limits\.llmCallsPerRun/);
  });

  it("keeps the documented defaults for limits and fetching", () => {
    const config = parseConfig("listen: 0.0.0.0:9000\n");
    expect(config.listen).toBe("0.0.0.0:9000");
    expect(config.limits).toEqual({ llmCallsPerRun: 40, llmCallsPerDay: 300, summariesPerDay: 100, judgeBatchSize: 30, pagesPerRun: 20, runRetries: 2 });
    expect(config.fetch).toEqual({ userAgent: null, hostIntervalMs: 1000, timeoutMs: 15000, maxBytes: 2000000, allowPrivateHosts: [] });
  });

  it("takes the hosts on the own network that may be fetched", () => {
    const config = parseConfig("fetch:\n  allowPrivateHosts: [feeds.home.example, 192.168.0.10]\n");
    expect(config.fetch.allowPrivateHosts).toEqual(["feeds.home.example", "192.168.0.10"]);
  });

  it("refuses allowed hosts that are not a list of names", () => {
    expect(() => parseConfig("fetch:\n  allowPrivateHosts: true\n")).toThrow(/fetch\.allowPrivateHosts/);
    expect(() => parseConfig("fetch:\n  allowPrivateHosts: ['']\n")).toThrow(/fetch\.allowPrivateHosts/);
  });
});

describe("the example configuration", () => {
  it("is accepted as it is shipped", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const config = parseConfig(readFileSync(join(import.meta.dirname, "../../../examples/config.example.yaml"), "utf8"));
    expect(resolveAssignment(config)).toMatchObject({ judge: "fast", write: "smart" });
    expect(config.newsSearch).toEqual({ engines: ["google-news"], maxResultsPerQuery: 10 });
    expect(config.images).toEqual({ cacheDays: 7, cacheMaxBytes: 1_000_000_000 });
  });
});

describe("the images relayed by the server", () => {
  it("are kept 7 days and up to 1,000,000,000 bytes unless the file says otherwise", () => {
    expect(parseConfig(null).images).toEqual({ cacheDays: 7, cacheMaxBytes: 1_000_000_000 });
    expect(parseConfig("images:\n  cacheDays: 3\n  cacheMaxBytes: 3000000\n").images).toEqual({ cacheDays: 3, cacheMaxBytes: 3_000_000 });
  });

  it("refuse a period or a size below 1, and one that is not a whole number", () => {
    expect(() => parseConfig("images:\n  cacheDays: 0\n")).toThrow(/images\.cacheDays/);
    expect(() => parseConfig("images:\n  cacheMaxBytes: 0\n")).toThrow(/images\.cacheMaxBytes/);
    expect(() => parseConfig("images:\n  cacheDays: 1.5\n")).toThrow(/images\.cacheDays/);
  });

  it("have no switch to turn the relay off", () => {
    expect(() => parseConfig("images:\n  enabled: false\n")).toThrow(/images/);
  });
});

describe("the summarize task and its limit", () => {
  const providers = (names: string[]) => `providers:\n${names.map((name) => `  ${name}: { adapter: claude-cli, model: m }\n`).join("")}`;

  it("goes to the fast provider when nothing is assigned, whatever the default is", () => {
    expect(resolveAssignment(parseConfig(null))).toMatchObject({ summarize: "fast", write: "smart" });
    const config = parseConfig(`${providers(["big", "fast"])}tasks:\n  default: big\n`);
    expect(resolveAssignment(config)).toMatchObject({ summarize: "fast", write: "big" });
  });

  it("goes to the assigned provider", () => {
    const config = parseConfig(`${providers(["big", "fast", "local"])}tasks:\n  default: big\n  summarize: local\n`);
    expect(resolveAssignment(config).summarize).toBe("local");
  });

  it("goes to the default provider when none is named fast", () => {
    expect(resolveAssignment(parseConfig(providers(["only"]))).summarize).toBe("only");
  });

  it("refuses an assignment to a provider that is not configured", () => {
    const config = parseConfig(`${providers(["big"])}tasks:\n  default: big\n  summarize: missing\n`);
    expect(() => resolveAssignment(config)).toThrow(/summarize.*missing/);
  });

  it("allows 100 summaries a day unless the file says otherwise", () => {
    expect(parseConfig(null).limits.summariesPerDay).toBe(100);
    expect(parseConfig("limits:\n  summariesPerDay: 20\n").limits.summariesPerDay).toBe(20);
    expect(() => parseConfig("limits:\n  summariesPerDay: 0\n")).toThrow(/limits\.summariesPerDay/);
  });
});

describe("the translation settings", () => {
  it("allow 450,000 characters a month and 20,000 an article, without a key, when nothing is configured", () => {
    const config = parseConfig(null);
    expect(config.translation).toEqual({ monthlyChars: 450_000, maxCharsPerArticle: 20_000 });
    expect(translationApiKey(config, { GOOGLE_TRANSLATE_API_KEY: "set-but-not-named" })).toBeNull();
  });

  it("read the key from the environment variable the file names", () => {
    const config = parseConfig("translation:\n  google:\n    apiKeyEnv: MY_KEY\n  monthlyChars: 1000\n");
    expect(config.translation.monthlyChars).toBe(1000);
    expect(translationApiKey(config, { MY_KEY: "the-key" })).toBe("the-key");
  });

  it("treat a variable that is missing or empty as no key", () => {
    const config = parseConfig("translation:\n  google:\n    apiKeyEnv: MY_KEY\n");
    expect(translationApiKey(config, {})).toBeNull();
    expect(translationApiKey(config, { MY_KEY: "" })).toBeNull();
    expect(translationApiKey(config, { MY_KEY: "  " })).toBeNull();
  });

  it("refuse a key written into the file", () => {
    expect(() => parseConfig("translation:\n  google:\n    apiKey: secret\n")).toThrow(ConfigError);
  });

  it("give the translate task to the provider named fast, unless the file assigns it", () => {
    const providers = (names: string[]) => `providers:\n${names.map((name) => `  ${name}: { adapter: claude-cli, model: m }\n`).join("")}`;
    expect(resolveAssignment(parseConfig(`${providers(["big", "fast"])}tasks:\n  default: big\n`)).translate).toBe("fast");
    expect(resolveAssignment(parseConfig(`${providers(["big", "fast"])}tasks:\n  default: big\n  translate: big\n`)).translate).toBe("big");
    expect(resolveAssignment(parseConfig(providers(["only"]))).translate).toBe("only");
  });
});

describe("the number of retries of a failed run", () => {
  it("is 2 unless the file says otherwise", () => {
    expect(parseConfig(null).limits.runRetries).toBe(2);
    expect(parseConfig("limits:\n  runRetries: 0\n").limits.runRetries).toBe(0);
    expect(parseConfig("limits:\n  runRetries: 3\n").limits.runRetries).toBe(3);
  });

  it("is refused outside 0 to 3, and when it is not a whole number", () => {
    expect(() => parseConfig("limits:\n  runRetries: 4\n")).toThrow(/limits\.runRetries/);
    expect(() => parseConfig("limits:\n  runRetries: -1\n")).toThrow(/limits\.runRetries/);
    expect(() => parseConfig("limits:\n  runRetries: 1.5\n")).toThrow(/limits\.runRetries/);
  });
});

describe("the news engines", () => {
  it("are Google News alone when the file names none", () => {
    expect(parseConfig(null).newsSearch).toEqual({ engines: ["google-news"], maxResultsPerQuery: 10 });
    expect(parseConfig("newsSearch:\n  maxResultsPerQuery: 5\n").newsSearch).toEqual({ engines: ["google-news"], maxResultsPerQuery: 5 });
  });

  it("are the listed ones, in the order of the list", () => {
    expect(parseConfig("newsSearch:\n  engines: [bing-news, google-news]\n").newsSearch.engines).toEqual(["bing-news", "google-news"]);
  });

  it("are the one engine of the older setting", () => {
    expect(parseConfig("newsSearch:\n  engine: bing-news\n").newsSearch).toEqual({ engines: ["bing-news"], maxResultsPerQuery: 10 });
  });

  it("are refused when both the older and the newer setting are written", () => {
    expect(() => parseConfig("newsSearch:\n  engine: google-news\n  engines: [bing-news]\n")).toThrow(/^config\.yaml is invalid:\n {2}newsSearch: /);
  });

  it("are refused as an empty list, a list that names an engine twice, and an unknown name", () => {
    expect(() => parseConfig("newsSearch:\n  engines: []\n")).toThrow(/newsSearch\.engines: /);
    expect(() => parseConfig("newsSearch:\n  engines: [bing-news, bing-news]\n")).toThrow(/newsSearch\.engines: /);
    expect(() => parseConfig("newsSearch:\n  engines: [google-news, duckduckgo]\n")).toThrow(/newsSearch\.engines/);
  });
});
