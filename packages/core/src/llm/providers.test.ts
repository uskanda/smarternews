import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../config.ts";
import { createTestDb, fakeClock } from "../testing/db.ts";
import { buildProviders } from "./providers.ts";
import { TaskRunner } from "./runner.ts";

const CONFIG = `
providers:
  cli: { adapter: claude-cli, model: sonnet }
  local: { adapter: openai-compatible, baseUrl: "http://127.0.0.1:1/v1", model: tiny, apiKeyEnv: LOCAL_KEY }
tasks: { default: cli }
`;

describe("buildProviders", () => {
  it("builds each configured provider under its own name", () => {
    const providers = buildProviders(parseConfig(CONFIG), { LOCAL_KEY: "k" });
    expect([...providers.keys()]).toEqual(["cli", "local"]);
    expect(providers.get("cli")).toMatchObject({ adapterKind: "claude-cli", model: "sonnet" });
    expect(providers.get("local")).toMatchObject({ adapterKind: "openai-compatible", model: "tiny" });
  });

  it("knows that only the claude command can search the web", () => {
    const providers = buildProviders(parseConfig(CONFIG), { LOCAL_KEY: "k" });
    expect(providers.get("cli")!.adapter.capabilities.webSearch).toBe(true);
    expect(providers.get("local")!.adapter.capabilities.webSearch).toBe(false);
  });

  it("refuses to start when the variable that should hold an API key is not set", () => {
    expect(() => buildProviders(parseConfig(CONFIG), {})).toThrow(ConfigError);
    expect(() => buildProviders(parseConfig(CONFIG), {})).toThrow(/LOCAL_KEY/);
  });
});

describe("buildProviders with the Anthropic API", () => {
  const API = `
providers:
  fast: { adapter: anthropic, model: claude-haiku-5-5 }
  smart: { adapter: anthropic, model: claude-sonnet-5-5, apiKeyEnv: SMART_KEY, pricing: { inputPerMTok: 1 } }
  cli: { adapter: claude-cli, model: sonnet }
tasks: { default: smart }
`;

  it("builds providers that search the web and cost money, at the shipped prices with the configured ones laid over", () => {
    const providers = buildProviders(parseConfig(API), { ANTHROPIC_API_KEY: "k1", SMART_KEY: "k2" });
    expect(providers.get("fast")).toMatchObject({ adapterKind: "anthropic", model: "claude-haiku-5-5", pricing: { inputPerMTok: 0.1 } });
    expect(providers.get("smart")!.pricing).toMatchObject({ inputPerMTok: 1, outputPerMTok: 10 });
    expect(providers.get("smart")!.adapter.capabilities.webSearch).toBe(true);
    expect(providers.get("cli")!.pricing).toBeNull();
  });

  it("refuses to start without the key, naming the provider and the variable but never the key", () => {
    const start = () => buildProviders(parseConfig(API), { ANTHROPIC_API_KEY: "the-fast-key", SMART_KEY: "  " });
    expect(start).toThrow(ConfigError);
    expect(start).toThrow(/"smart".*SMART_KEY/);
    expect(start).not.toThrow(/the-fast-key/);
  });

  it("refuses a model without prices, naming the provider and the model", () => {
    const text = "providers:\n  smart: { adapter: anthropic, model: claude-new-1, pricing: { inputPerMTok: 1, outputPerMTok: 2 } }\n";
    const start = () => buildProviders(parseConfig(text), { ANTHROPIC_API_KEY: "k" });
    expect(start).toThrow(ConfigError);
    expect(start).toThrow(/"smart".*claude-new-1/);
  });

  it("takes a model it does not ship when all four token prices are configured", () => {
    const text =
      "providers:\n  smart: { adapter: anthropic, model: claude-new-1, pricing: { inputPerMTok: 1, outputPerMTok: 2, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25 } }\n";
    expect(buildProviders(parseConfig(text), { ANTHROPIC_API_KEY: "k" }).get("smart")!.pricing).toMatchObject({ inputPerMTok: 1 });
  });
});

describe("the description of the providers", () => {
  it("tells the providers that cost money from those that do not", () => {
    const providers = buildProviders(parseConfig("providers:\n  fast: { adapter: anthropic, model: claude-haiku-5-5 }\n  cli: { adapter: claude-cli, model: sonnet }\ntasks: { default: cli }\n"), {
      ANTHROPIC_API_KEY: "k",
    });
    const assignment = { interpret: "cli", search: "cli", judge: "fast", cluster: "cli", write: "cli", summarize: "fast", translate: "fast" } as const;
    const runner = new TaskRunner({
      db: createTestDb(),
      clock: fakeClock("2026-10-25T00:00:00.000Z"),
      providers,
      assignment,
      limits: { llmCallsPerRun: 40, llmCallsPerDay: 300 },
      timeouts: { defaultMs: 1000, searchMs: 1000 },
      timeZone: () => "UTC",
    });
    expect(runner.describe().providers).toEqual([
      { name: "fast", adapter: "anthropic", model: "claude-haiku-5-5", webSearch: true, billable: true },
      { name: "cli", adapter: "claude-cli", model: "sonnet", webSearch: true, billable: false },
    ]);
  });
});
