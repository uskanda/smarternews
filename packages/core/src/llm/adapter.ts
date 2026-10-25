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

/** What one call used, as the provider counted it. */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
}

/** One answer: the parsed JSON, and what the call used. Usage is null for adapters that report none. */
export interface LlmCompletion {
  answer: unknown;
  usage: LlmUsage | null;
}

export interface LlmAdapter {
  readonly capabilities: { webSearch: boolean };
  /** Resolves with the parsed JSON answer. Rejects when the provider cannot be reached or fails. */
  complete(request: LlmRequest): Promise<LlmCompletion>;
}

/** The provider answered, but not with something usable. It carries what the call used, so its cost is kept. */
export class LlmCallError extends Error {
  readonly usage: LlmUsage | null;

  constructor(message: string, usage: LlmUsage | null) {
    super(message);
    this.name = "LlmCallError";
    this.usage = usage;
  }
}
