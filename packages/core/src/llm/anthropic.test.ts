import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LlmCallError, type LlmRequest } from "./adapter.ts";
import { createAnthropicAdapter, toApiSchema } from "./anthropic.ts";
import { resolvePricing } from "./pricing.ts";
import { tasks } from "./tasks.ts";

interface Seen {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A stand-in for the Messages API: answers each request with the next recorded response. */
function recorded(responses: Array<{ status?: number; body: unknown } | "hang">) {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const response = responses.shift();
    if (response === undefined) throw new Error("the test did not expect another request");
    if (response === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { "content-type": "application/json", "request-id": "req_1" },
    });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

const usage = (over: Record<string, unknown> = {}) => ({
  input_tokens: 1200,
  output_tokens: 300,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  server_tool_use: null,
  ...over,
});

const message = (text: string, over: Record<string, unknown> = {}) => ({
  body: {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: usage(),
    ...over,
  },
});

const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
const request = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  system: "SYSTEM TEXT",
  prompt: "PROMPT TEXT",
  outputSchema: schema,
  webSearch: false,
  timeoutMs: 5000,
  signal: new AbortController().signal,
  ...over,
});

function adapter(fetchImpl: typeof fetch, options: { model?: string; effort?: "low" | "medium" | "high"; maxWebSearches?: number } = {}) {
  const model = options.model ?? "claude-sonnet-5-5";
  return createAnthropicAdapter({
    apiKey: "sk-ant-secret-key",
    model,
    effort: options.effort,
    maxWebSearches: options.maxWebSearches ?? 5,
    pricing: resolvePricing(model)!,
    fetchImpl,
  });
}

describe("the Anthropic API adapter", () => {
  it("sends the prompts and the schema, and returns the parsed answer with what the call used", async () => {
    const { fetchImpl, seen } = recorded([message('{"ok": true}', { usage: usage({ cache_read_input_tokens: 5, cache_creation_input_tokens: 7 }) })]);

    await expect(adapter(fetchImpl).complete(request())).resolves.toEqual({
      answer: { ok: true },
      usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 5, cacheWriteTokens: 7, webSearches: 0 },
    });
    expect(seen[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen[0]!.headers.get("authorization")).toBe("Bearer sk-ant-secret-key");
    expect(seen[0]!.body).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 16000,
      system: "SYSTEM TEXT",
      messages: [{ role: "user", content: "PROMPT TEXT" }],
      output_config: { format: { type: "json_schema", schema } },
    });
  });

  it("gives no tools to a task other than the search, and no effort unless one is configured", async () => {
    const { fetchImpl, seen } = recorded([message('{"ok": true}'), message('{"ok": true}')]);

    await adapter(fetchImpl).complete(request());
    await adapter(fetchImpl, { effort: "low" }).complete(request());

    expect(seen[0]!.body.tools).toBeUndefined();
    expect(seen[0]!.body.output_config).not.toHaveProperty("effort");
    expect(seen[1]!.body.output_config).toMatchObject({ effort: "low" });
    expect(seen[1]!.body.tools).toBeUndefined();
  });

  it("says it can search the web", () => {
    expect(adapter(recorded([]).fetchImpl).capabilities.webSearch).toBe(true);
  });

  it("gives the search task web search, limited per call, and page fetching, in the versions the model takes", async () => {
    const { fetchImpl, seen } = recorded([message('{"ok": true}'), message('{"ok": true}')]);

    await adapter(fetchImpl, { maxWebSearches: 3 }).complete(request({ webSearch: true }));
    await adapter(fetchImpl, { model: "claude-haiku-5-5" }).complete(request({ webSearch: true }));

    expect(seen[0]!.body.tools).toEqual([
      { type: "web_search_20260209", name: "web_search", max_uses: 3 },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 },
    ]);
    expect(seen[1]!.body.tools).toEqual([
      { type: "web_search_20250305", name: "web_search", max_uses: 5 },
      { type: "web_fetch_20250910", name: "web_fetch", max_uses: 5 },
    ]);
  });

  it("counts the web searches of the call", async () => {
    const { fetchImpl } = recorded([message('{"ok": true}', { usage: usage({ server_tool_use: { web_search_requests: 3, web_fetch_requests: 2 } }) })]);

    const { usage: used } = await adapter(fetchImpl).complete(request({ webSearch: true }));

    expect(used).toMatchObject({ webSearches: 3 });
  });

  it("sends the turn again when the server paused it, and adds up what the requests used", async () => {
    const paused = message("", {
      stop_reason: "pause_turn",
      content: [{ type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "q" } }],
      usage: usage({ server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 } }),
    });
    const { fetchImpl, seen } = recorded([paused, message('{"ok": true}', { usage: usage({ server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } }) })]);

    const result = await adapter(fetchImpl).complete(request({ webSearch: true }));

    expect(result).toEqual({ answer: { ok: true }, usage: { inputTokens: 2400, outputTokens: 600, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 3 } });
    expect(seen[1]!.body.messages).toEqual([
      { role: "user", content: "PROMPT TEXT" },
      { role: "assistant", content: [{ type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "q" } }] },
    ]);
  });

  it("gives up after sending a paused turn again 3 times, keeping what the requests used", async () => {
    const paused = () => message("", { stop_reason: "pause_turn", content: [] });
    const { fetchImpl, seen } = recorded([paused(), paused(), paused(), paused()]);

    const error = await adapter(fetchImpl).complete(request({ webSearch: true })).catch((caught: unknown) => caught);

    expect(seen).toHaveLength(4);
    expect(error).toBeInstanceOf(LlmCallError);
    expect((error as LlmCallError).usage).toMatchObject({ inputTokens: 4800, outputTokens: 1200 });
  });

  it("fails with what the call used when the answer was cut off, refused or not JSON", async () => {
    for (const response of [
      message('{"ok": tr', { stop_reason: "max_tokens" }),
      message("", { stop_reason: "refusal", content: [] }),
      message("not json at all"),
    ]) {
      const { fetchImpl } = recorded([response]);
      const error = await adapter(fetchImpl).complete(request()).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(LlmCallError);
      expect((error as LlmCallError).usage).toMatchObject({ inputTokens: 1200, outputTokens: 300 });
    }
  });

  it("reports a refused key with its status and without the key", async () => {
    const { fetchImpl } = recorded([
      { status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } },
    ]);

    const error = (await adapter(fetchImpl).complete(request()).catch((caught: unknown) => caught)) as Error;

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(LlmCallError);
    expect(error.message).toMatch(/401/);
    expect(error.message).not.toContain("sk-ant-secret-key");
  });

  it("stops waiting when the call is aborted", async () => {
    const { fetchImpl } = recorded(["hang"]);
    const controller = new AbortController();

    const pending = adapter(fetchImpl).complete(request({ signal: controller.signal }));
    controller.abort();

    await expect(pending).rejects.toThrow();
  });
});

describe("toApiSchema", () => {
  const UNSUPPORTED = ["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems", "$schema"];

  function keys(value: unknown, found = new Set<string>()): Set<string> {
    if (Array.isArray(value)) value.forEach((item) => keys(item, found));
    else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        found.add(key);
        // A property may be called anything, even "minimum": only the keywords around it count.
        keys(key === "properties" ? Object.values(inner as object) : inner, found);
      }
    }
    return found;
  }

  it("leaves none of the constraints the API refuses in the schemas of the seven tasks", () => {
    for (const definition of Object.values(tasks)) {
      const converted = toApiSchema(z.toJSONSchema(definition.output) as Record<string, unknown>);
      const found = keys(converted);
      expect(UNSUPPORTED.filter((key) => found.has(key))).toEqual([]);
    }
  });

  it("closes every object, nested ones and those inside anyOf included", () => {
    const converted = toApiSchema({
      type: "object",
      properties: {
        a: { type: "object", properties: { b: { type: "string", maxLength: 3 } } },
        c: { anyOf: [{ type: "object", properties: {} }, { type: "null" }] },
      },
      required: ["a", "c"],
    });
    expect(converted).toEqual({
      type: "object",
      properties: {
        a: { type: "object", properties: { b: { type: "string" } }, additionalProperties: false },
        c: { anyOf: [{ type: "object", properties: {}, additionalProperties: false }, { type: "null" }] },
      },
      required: ["a", "c"],
      additionalProperties: false,
    });
  });
});
