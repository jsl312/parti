export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type CompletionRequest = {
  messages: ChatMessage[];
  system?: string;
  jsonSchema?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  /**
   * Provider-specific sampling overrides. For Ollama these are merged into the
   * `options` object (e.g. { mirostat: 2, repeat_penalty: 1.1, stop: [...] }),
   * letting a caller soften anti-repetition settings or enable mirostat to
   * break degenerate loops. Ignored by hosted providers.
   */
  options?: Record<string, unknown>;
};

export type CompletionResponse = {
  text: string;
  parsedJson?: unknown;
  usage?: { inputTokens?: number; outputTokens?: number };
  raw?: unknown;
};

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | "auth"
      | "network"
      | "rate_limit"
      | "bad_response"
      | "json_parse"
      | "unknown",
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
