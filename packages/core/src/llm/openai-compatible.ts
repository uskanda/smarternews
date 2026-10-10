import type { LlmAdapter } from "./adapter.ts";
import { parseJsonAnswer } from "./json.ts";

export interface OpenAiCompatibleOptions {
  /** Base URL up to and including the version segment, for example http://127.0.0.1:11434/v1 */
  baseUrl: string;
  model: string;
  apiKey: string | null;
  /** "json_schema" sends the schema as response_format; "prompt" asks for JSON in the system message. */
  structuredOutput: "json_schema" | "prompt";
  fetchImpl?: typeof fetch;
}

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string | null } }>;
}

/** Calls a server that implements the OpenAI chat completions API: Ollama, LM Studio, OpenRouter and others. */
export function createOpenAiCompatibleAdapter(options: OpenAiCompatibleOptions): LlmAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return {
    capabilities: { webSearch: false },
    async complete(request) {
      const useSchema = options.structuredOutput === "json_schema";
      const system = useSchema
        ? request.system
        : `${request.system}\nAnswer with one JSON object and nothing else. It must match this JSON Schema:\n${JSON.stringify(request.outputSchema)}`;
      const response = await fetchImpl(url, {
        method: "POST",
        signal: request.signal,
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: request.prompt },
          ],
          ...(useSchema
            ? { response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema: request.outputSchema } } }
            : {}),
        }),
      });
      if (!response.ok) {
        // The body is not quoted: some servers echo the credentials they were given.
        throw new Error(`the provider answered with HTTP status ${response.status}`);
      }
      const completion = (await response.json()) as ChatCompletion;
      const content = completion.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("the provider answered without a message");
      return parseJsonAnswer(content);
    },
  };
}
