import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenAiCompatibleAdapter } from "./openai-compatible.ts";

interface Seen {
  url: string;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

/** A local stand-in for an OpenAI-compatible server. */
async function server(respond: (seen: Seen) => { status: number; body: unknown } | "hang") {
  const seen: Seen[] = [];
  const http = createServer((req: IncomingMessage, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const entry = { url: req.url ?? "", authorization: req.headers.authorization, body: JSON.parse(raw) as Record<string, unknown> };
      seen.push(entry);
      const answer = respond(entry);
      if (answer === "hang") return;
      res.writeHead(answer.status, { "content-type": "application/json" });
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  close = () =>
    new Promise((resolve) => {
      http.closeAllConnections();
      http.close(() => resolve());
    });
  const baseUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}/v1`;
  return { baseUrl, seen };
}

const completion = (content: string) => ({ status: 200, body: { choices: [{ message: { role: "assistant", content } }] } });
const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
const request = (signal = new AbortController().signal) => ({
  system: "SYSTEM TEXT",
  prompt: "PROMPT TEXT",
  outputSchema: schema,
  webSearch: false,
  timeoutMs: 5000,
  signal,
});

describe("the OpenAI-compatible adapter", () => {
  it("posts the prompts with the schema and returns the parsed answer", async () => {
    const { baseUrl, seen } = await server(() => completion('{"ok": true}'));
    const adapter = createOpenAiCompatibleAdapter({ baseUrl, model: "some-model", apiKey: "k-123", structuredOutput: "json_schema" });

    await expect(adapter.complete(request())).resolves.toEqual({ ok: true });
    expect(seen[0]!.url).toBe("/v1/chat/completions");
    expect(seen[0]!.authorization).toBe("Bearer k-123");
    expect(seen[0]!.body).toMatchObject({
      model: "some-model",
      messages: [
        { role: "system", content: "SYSTEM TEXT" },
        { role: "user", content: "PROMPT TEXT" },
      ],
      response_format: { type: "json_schema", json_schema: { schema } },
    });
  });

  it("asks for JSON in the prompt instead when the server does not take a schema", async () => {
    const { baseUrl, seen } = await server(() => completion('```json\n{"ok": false}\n```'));
    const adapter = createOpenAiCompatibleAdapter({ baseUrl, model: "m", apiKey: null, structuredOutput: "prompt" });

    await expect(adapter.complete(request())).resolves.toEqual({ ok: false });
    expect(seen[0]!.body.response_format).toBeUndefined();
    expect(seen[0]!.authorization).toBeUndefined();
    const system = (seen[0]!.body.messages as Array<{ content: string }>)[0]!.content;
    expect(system).toContain("SYSTEM TEXT");
    expect(system).toContain('"additionalProperties":false');
  });

  it("reports an authentication failure without repeating the key", async () => {
    const { baseUrl } = await server((seen) => ({ status: 401, body: { error: { message: `bad key ${seen.authorization}` } } }));
    const adapter = createOpenAiCompatibleAdapter({ baseUrl, model: "m", apiKey: "k-secret-987", structuredOutput: "json_schema" });

    const error = await adapter.complete(request()).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("401");
    expect((error as Error).message).not.toContain("k-secret-987");
  });

  it("fails when the answer is not JSON", async () => {
    const { baseUrl } = await server(() => completion("I cannot help with that."));
    const adapter = createOpenAiCompatibleAdapter({ baseUrl, model: "m", apiKey: null, structuredOutput: "json_schema" });
    await expect(adapter.complete(request())).rejects.toThrow(/not JSON/);
  });

  it("stops waiting when the call is aborted", async () => {
    const { baseUrl } = await server(() => "hang");
    const adapter = createOpenAiCompatibleAdapter({ baseUrl, model: "m", apiKey: null, structuredOutput: "json_schema" });
    const controller = new AbortController();
    const pending = adapter.complete(request(controller.signal));
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toThrow();
  });

  it("says that it cannot search", () => {
    const adapter = createOpenAiCompatibleAdapter({ baseUrl: "http://127.0.0.1:1/v1", model: "m", apiKey: null, structuredOutput: "json_schema" });
    expect(adapter.capabilities.webSearch).toBe(false);
  });
});
