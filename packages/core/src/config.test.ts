import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig, resolveAssignment } from "./config.ts";

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
    });
  });

  it("falls back to the default provider for a task without an assignment", () => {
    const config = parseConfig(`
providers:
  a: { adapter: claude-cli, model: sonnet }
  b: { adapter: openai-compatible, baseUrl: "http://127.0.0.1:1/v1", model: m }
tasks: { default: a, judge: b }
`);
    expect(resolveAssignment(config)).toEqual({ interpret: "a", search: "a", judge: "b", cluster: "a", write: "a" });
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
    expect(config.limits).toEqual({ llmCallsPerRun: 40, llmCallsPerDay: 300, judgeBatchSize: 30, pagesPerRun: 20 });
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
    expect(config.newsSearch).toEqual({ engine: "google-news", maxResultsPerQuery: 10 });
  });
});
