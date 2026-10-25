import { describe, expect, it } from "vitest";
import { costOf, resolvePricing } from "./pricing.ts";

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 };

describe("costOf", () => {
  it("multiplies the tokens by the prices a million tokens", () => {
    const prices = resolvePricing("claude-sonnet-5-5", { inputPerMTok: 2, outputPerMTok: 10 })!;
    expect(costOf(prices, { ...usage, inputTokens: 10_000, outputTokens: 1_000 })).toBeCloseTo(0.03, 10);
  });

  it("adds the web searches at their own price", () => {
    const prices = resolvePricing("claude-sonnet-5-5")!;
    // 2,000 input tokens at $2 and 1,600 output tokens at $10 make $0.02.
    expect(costOf(prices, { ...usage, inputTokens: 2_000, outputTokens: 1_600, webSearches: 3 })).toBeCloseTo(0.05, 10);
  });

  it("prices the cache reads and writes", () => {
    const prices = resolvePricing("claude-sonnet-5-5")!;
    expect(costOf(prices, { ...usage, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 })).toBeCloseTo(0.1 + 2.5, 10);
  });

  it("uses the higher prices of Haiku 5.5 for a prompt over 100,000 tokens, cache reads and writes included", () => {
    const prices = resolvePricing("claude-haiku-5-5")!;
    expect(costOf(prices, { ...usage, inputTokens: 100_000, outputTokens: 1_000_000 })).toBeCloseTo(0.01 + 0.5, 10);
    expect(costOf(prices, { ...usage, inputTokens: 100_000, cacheReadTokens: 1, outputTokens: 1_000_000 })).toBeCloseTo(
      0.05 + 0.00000005 + 2.5,
      10,
    );
  });
});

describe("resolvePricing", () => {
  it("knows the shipped models and the tools each one takes", () => {
    expect(resolvePricing("claude-sonnet-5-5")).toMatchObject({ inputPerMTok: 2, outputPerMTok: 10, webSearchPerSearch: 0.01, tools: "dynamic" });
    expect(resolvePricing("claude-opus-5-5")).toMatchObject({ inputPerMTok: 4, outputPerMTok: 20, tools: "dynamic" });
    expect(resolvePricing("claude-haiku-5-5")).toMatchObject({ inputPerMTok: 0.1, outputPerMTok: 0.5, tools: "basic" });
  });

  it("lays the configured prices over the shipped ones, field by field", () => {
    expect(resolvePricing("claude-sonnet-5-5", { inputPerMTok: 1 })).toMatchObject({ inputPerMTok: 1, outputPerMTok: 10 });
  });

  it("takes a model it does not know when all four token prices are configured, at $0.01 a search", () => {
    const prices = { inputPerMTok: 1, outputPerMTok: 2, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25 };
    expect(resolvePricing("claude-new-1", prices)).toEqual({ ...prices, webSearchPerSearch: 0.01, tools: "basic" });
  });

  it("gives nothing for a model it does not know when a token price is missing", () => {
    expect(resolvePricing("claude-new-1")).toBeNull();
    expect(resolvePricing("claude-new-1", { inputPerMTok: 1, outputPerMTok: 2, cacheReadPerMTok: 0.1 })).toBeNull();
  });
});
