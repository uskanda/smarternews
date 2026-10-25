import Anthropic from "@anthropic-ai/sdk";
import { LlmCallError, type LlmAdapter, type LlmRequest, type LlmUsage } from "./adapter.ts";
import { parseJsonAnswer } from "./json.ts";
import type { ModelPricing } from "./pricing.ts";

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  /** Left out, the model's own default applies. */
  effort?: "low" | "medium" | "high";
  /** Web searches, and page fetches, one call of the search task may make. */
  maxWebSearches: number;
  pricing: ModelPricing;
  fetchImpl?: typeof fetch;
}

/** Enough for the longest article body the write task asks for, with room for the model's thinking. */
const MAX_TOKENS = 16_000;
/** How often a turn the server paused, to run its tools further, is sent again. */
const MAX_RESUMES = 3;

// Constraints structured outputs refuse. The task runner still checks them against the task's own schema.
const UNSUPPORTED = new Set(["$schema", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems"]);

/** The schema as structured outputs take it: no constraints it refuses, and every object closed. */
export function toApiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const convert = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(convert);
    if (value === null || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (UNSUPPORTED.has(key)) continue;
      out[key] =
        key === "properties" ? Object.fromEntries(Object.entries(inner as object).map(([name, property]) => [name, convert(property)])) : convert(inner);
    }
    if (out.type === "object") out.additionalProperties = false;
    return out;
  };
  return convert(schema) as Record<string, unknown>;
}

function tools(options: AnthropicOptions): Anthropic.ToolUnion[] {
  const max_uses = options.maxWebSearches;
  return options.pricing.tools === "dynamic"
    ? [
        { type: "web_search_20260209", name: "web_search", max_uses },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses },
      ]
    : [
        { type: "web_search_20250305", name: "web_search", max_uses },
        { type: "web_fetch_20250910", name: "web_fetch", max_uses },
      ];
}

function add(total: LlmUsage, usage: Anthropic.Usage): LlmUsage {
  return {
    inputTokens: total.inputTokens + usage.input_tokens,
    outputTokens: total.outputTokens + usage.output_tokens,
    cacheReadTokens: total.cacheReadTokens + (usage.cache_read_input_tokens ?? 0),
    cacheWriteTokens: total.cacheWriteTokens + (usage.cache_creation_input_tokens ?? 0),
    webSearches: total.webSearches + (usage.server_tool_use?.web_search_requests ?? 0),
  };
}

/** The status and the API's own words. Neither holds the key, which only ever travels in a header. */
function describeFailure(error: unknown): Error {
  if (error instanceof Anthropic.APIError && error.status !== undefined) {
    return new Error(`the provider answered with HTTP status ${error.status}: ${error.message.slice(0, 300)}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** Calls the Messages API of Anthropic, and counts what each call used so that its cost can be kept. */
export function createAnthropicAdapter(options: AnthropicOptions): LlmAdapter {
  const client = new Anthropic({ apiKey: options.apiKey, ...(options.fetchImpl ? { fetch: options.fetchImpl } : {}) });
  return {
    capabilities: { webSearch: true },
    async complete(request: LlmRequest) {
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: request.prompt }];
      let used: LlmUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 };
      for (let resume = 0; ; resume += 1) {
        let response: Anthropic.Message;
        try {
          response = await client.messages.create(
            {
              model: options.model,
              max_tokens: MAX_TOKENS,
              system: request.system,
              messages,
              output_config: {
                format: { type: "json_schema", schema: toApiSchema(request.outputSchema) },
                ...(options.effort ? { effort: options.effort } : {}),
              },
              ...(request.webSearch ? { tools: tools(options) } : {}),
            },
            { signal: request.signal },
          );
        } catch (error) {
          throw describeFailure(error);
        }
        used = add(used, response.usage);
        if (response.stop_reason === "pause_turn") {
          if (resume >= MAX_RESUMES) throw new LlmCallError(`the turn was still paused after ${MAX_RESUMES} resumptions`, used);
          messages.push({ role: "assistant", content: response.content });
          continue;
        }
        if (response.stop_reason === "max_tokens") throw new LlmCallError(`the answer was cut off at ${MAX_TOKENS} tokens`, used);
        if (response.stop_reason === "refusal") throw new LlmCallError("the model declined to answer", used);
        const text = response.content.filter((block) => block.type === "text").at(-1)?.text ?? "";
        try {
          return { answer: parseJsonAnswer(text), usage: used };
        } catch (error) {
          throw new LlmCallError(error instanceof Error ? error.message : String(error), used);
        }
      }
    },
  };
}
