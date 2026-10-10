import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../config.ts";
import { buildProviders } from "./providers.ts";

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
