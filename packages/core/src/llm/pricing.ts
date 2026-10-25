import type { PricingConfig } from "../config.ts";
import type { LlmUsage } from "./adapter.ts";

/** US dollars. Token prices are for a million tokens. */
export interface UnitPrices {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  /** Writes are priced at the 5-minute rate: the server asks for no longer cache. */
  cacheWritePerMTok: number;
  webSearchPerSearch: number;
}

export interface ModelPricing extends UnitPrices {
  /** Prices for a prompt (input, cache reads and cache writes) longer than `overTokens`. */
  longPrompt?: { overTokens: number; prices: Omit<UnitPrices, "webSearchPerSearch"> };
  /** Which versions of the web search and fetch tools the model takes. */
  tools: "dynamic" | "basic";
}

const WEB_SEARCH = 0.01;

// The public prices of the Claude API, read on 2026-10-25 from https://platform.claude.com/docs/en/about-claude/pricing.
// Web search costs $10 a thousand searches; fetching a page costs only its tokens.
const SHIPPED: Record<string, ModelPricing> = {
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5, webSearchPerSearch: WEB_SEARCH, tools: "dynamic" },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.1, cacheWritePerMTok: 2.5, webSearchPerSearch: WEB_SEARCH, tools: "dynamic" },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75, webSearchPerSearch: WEB_SEARCH, tools: "dynamic" },
  "claude-haiku-5-5": {
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cacheReadPerMTok: 0.01,
    cacheWritePerMTok: 0.125,
    webSearchPerSearch: WEB_SEARCH,
    longPrompt: { overTokens: 100_000, prices: { inputPerMTok: 0.5, outputPerMTok: 2.5, cacheReadPerMTok: 0.05, cacheWritePerMTok: 0.625 } },
    tools: "basic",
  },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25, webSearchPerSearch: WEB_SEARCH, tools: "basic" },
};

/**
 * The prices of a model: the shipped ones with the configured fields laid over them. A model that is not shipped
 * needs all four token prices configured; without them it has none, and the server refuses to start.
 */
export function resolvePricing(model: string, configured: PricingConfig = {}): ModelPricing | null {
  const shipped = SHIPPED[model];
  if (shipped) return { ...shipped, ...configured };
  const { inputPerMTok, outputPerMTok, cacheReadPerMTok, cacheWritePerMTok } = configured;
  if (inputPerMTok === undefined || outputPerMTok === undefined || cacheReadPerMTok === undefined || cacheWritePerMTok === undefined) {
    return null;
  }
  return { inputPerMTok, outputPerMTok, cacheReadPerMTok, cacheWritePerMTok, webSearchPerSearch: configured.webSearchPerSearch ?? WEB_SEARCH, tools: "basic" };
}

/** US dollars one call cost. */
export function costOf(pricing: ModelPricing, usage: LlmUsage): number {
  const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const prices = pricing.longPrompt && prompt > pricing.longPrompt.overTokens ? pricing.longPrompt.prices : pricing;
  const tokens =
    usage.inputTokens * prices.inputPerMTok +
    usage.outputTokens * prices.outputPerMTok +
    usage.cacheReadTokens * prices.cacheReadPerMTok +
    usage.cacheWriteTokens * prices.cacheWritePerMTok;
  return tokens / 1_000_000 + usage.webSearches * pricing.webSearchPerSearch;
}
