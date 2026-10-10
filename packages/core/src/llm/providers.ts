import { ConfigError, type Config } from "../config.ts";
import { createClaudeCliAdapter } from "./claude-cli.ts";
import { createOpenAiCompatibleAdapter } from "./openai-compatible.ts";
import type { Provider } from "./runner.ts";

/** Builds the adapters named in the configuration. API keys come from the environment. */
export function buildProviders(config: Config, env: Record<string, string | undefined>): Map<string, Provider> {
  const providers = new Map<string, Provider>();
  for (const [name, entry] of Object.entries(config.providers)) {
    if (entry.adapter === "claude-cli") {
      providers.set(name, {
        name,
        adapterKind: entry.adapter,
        model: entry.model,
        adapter: createClaudeCliAdapter({ command: entry.command, model: entry.model, extraArgs: entry.extraArgs }),
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
