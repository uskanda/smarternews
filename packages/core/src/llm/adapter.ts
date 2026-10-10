/** One call to a model. The adapter only knows how to reach the provider; validation happens above it. */
export interface LlmRequest {
  system: string;
  prompt: string;
  /** JSON Schema the answer must match. */
  outputSchema: Record<string, unknown>;
  /** True only for the search task: the model may search the web and fetch pages, and nothing else. */
  webSearch: boolean;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface LlmAdapter {
  readonly capabilities: { webSearch: boolean };
  /** Resolves with the parsed JSON answer. Rejects when the provider cannot be reached or fails. */
  complete(request: LlmRequest): Promise<unknown>;
}
