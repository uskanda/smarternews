import { ConfigError, type Config } from "../config.ts";
import { createAnthropicAdapter } from "./anthropic.ts";
import { createClaudeCliAdapter } from "./claude-cli.ts";
import { createOpenAiCompatibleAdapter } from "./openai-compatible.ts";
import { resolvePricing } from "./pricing.ts";
import type { Provider } from "./runner.ts";

/** The key the variable holds, or null when it is missing or empty. */
function keyFrom(env: Record<string, string | undefined>, name: string): string | null {
  const key = (env[name] ?? "").trim();
  return key.length > 0 ? key : null;
}

/** Builds the adapters named in the configuration. API keys come from the environment. */
export function buildProviders(config: Config, env: Record<string, string | undefined>): Map<string, Provider> {
  const providers = new Map<string, Provider>();
  for (const [name, entry] of Object.entries(config.providers)) {
    if (entry.adapter === "claude-cli") {
      providers.set(name, {
        name,
        adapterKind: entry.adapter,
        model: entry.model,
        pricing: null,
        adapter: createClaudeCliAdapter({ command: entry.command, model: entry.model, extraArgs: entry.extraArgs }),
      });
      continue;
    }
    if (entry.adapter === "anthropic") {
      const apiKey = keyFrom(env, entry.apiKeyEnv);
      if (!apiKey) throw new ConfigError(`the provider "${name}" reads its API key from ${entry.apiKeyEnv}, which is not set`);
      const pricing = resolvePricing(entry.model, entry.pricing);
      if (!pricing) {
        throw new ConfigError(
          `the provider "${name}" uses the model "${entry.model}", whose prices are not known: give all four token prices under pricing`,
        );
      }
      providers.set(name, {
        name,
        adapterKind: entry.adapter,
        model: entry.model,
        pricing,
        adapter: createAnthropicAdapter({ apiKey, model: entry.model, effort: entry.effort, maxWebSearches: entry.maxWebSearches, pricing }),
      });
      continue;
    }
    const apiKey = entry.apiKeyEnv ? env[entry.apiKeyEnv] : null;
    if (entry.apiKeyEnv && !apiKey) {
      throw new ConfigError(`the provider "${name}" reads its API key from ${entry.apiKeyEnv}, which is not set`);
    }
    providers.set(name, {
      name,
      adapterKind: entry.adapter,
      model: entry.model,
      pricing: null,
      adapter: createOpenAiCompatibleAdapter({
        baseUrl: entry.baseUrl,
        model: entry.model,
        apiKey: apiKey ?? null,
        structuredOutput: entry.structuredOutput,
      }),
    });
  }
  return providers;
}
