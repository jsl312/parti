import { OllamaConfig } from "@/lib/types/settings";
import {
  ChatMessage,
  CompletionRequest,
  CompletionResponse,
  LlmError,
} from "@/lib/types/llm";
import { extractJson } from "@/lib/llm/jsonExtract";

export async function ollamaComplete(
  config: OllamaConfig,
  req: CompletionRequest,
): Promise<CompletionResponse> {
  const messages: ChatMessage[] = req.system
    ? [{ role: "system", content: req.system }, ...req.messages]
    : req.messages;

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    // Stream the response. With stream:false Ollama withholds headers until
    // generation finishes, which trips Node's 60s headersTimeout for slower
    // local models. Streaming sends headers immediately and chunks arrive as
    // tokens are produced — no fetch timeout regardless of generation length.
    stream: true,
    options: {
      temperature: req.temperature ?? 0.3,
      num_predict: req.maxTokens ?? 16384,
      // Larger context — Ollama defaults to 2K-4K which is too small once
      // findings summaries or full skill prompts are passed in. 8192 fits
      // most calls without blowing up VRAM on mid-size local models.
      num_ctx: 8192,
      // Mild anti-repetition + standard nucleus sampling. Tuned for robust
      // instruct models (default qwen2.5:14b). Kept gentle (1.1 / 64) so the
      // penalty never suppresses the structural tokens JSON output needs;
      // callers that need stronger control can pass `options` (e.g. mirostat).
      repeat_penalty: 1.1,
      repeat_last_n: 64,
      top_p: 0.9,
      top_k: 40,
      // Per-request overrides (e.g. mirostat to break degenerate loops in the
      // batch concept pipeline). Merged LAST so callers can tune sampling.
      ...(req.options ?? {}),
    },
  };
  // We use `format: "json"` (loose JSON hint) rather than `format: <schema>`
  // (strict grammar enforcement). Strict schema enforcement causes weaker
  // local models to emit empty responses when the schema is deeply nested —
  // the constrained sampler can run out of viable next tokens. The loose hint
  // guarantees parseable JSON; route-side shape validation + retry handles
  // cases where the shape is wrong.
  if (req.jsonSchema) body.format = "json";

  let res: Response;
  try {
    res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new LlmError(
      `Ollama 연결 실패 (${config.baseUrl}). 서버가 실행 중인지 확인해 주세요.`,
      "network",
      e,
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new LlmError(
      `Ollama 응답 오류 ${res.status}: ${text}`,
      res.status === 404 ? "bad_response" : "unknown",
    );
  }

  // Read the streamed NDJSON response and accumulate the assistant message.
  if (!res.body) {
    throw new LlmError("Ollama 응답 본문이 없습니다.", "bad_response");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let lastChunk: Record<string, unknown> | undefined;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const obj = JSON.parse(line) as {
          message?: { content?: string };
          error?: string;
        };
        lastChunk = obj as Record<string, unknown>;
        if (obj.error) {
          throw new LlmError(`Ollama 오류: ${obj.error}`, "bad_response");
        }
        if (obj.message?.content) text += obj.message.content;
      } catch (e) {
        if (e instanceof LlmError) throw e;
        // Ignore malformed line; Ollama occasionally emits partial frames.
      }
    }
  }
  if (buffer.trim()) {
    try {
      const obj = JSON.parse(buffer.trim()) as {
        message?: { content?: string };
      };
      if (obj.message?.content) text += obj.message.content;
      lastChunk = obj as Record<string, unknown>;
    } catch {
      // ignore
    }
  }
  const data = lastChunk ?? {};

  let parsedJson: unknown = undefined;
  if (req.jsonSchema) {
    if (!text.trim()) {
      throw new LlmError(
        "Ollama 가 빈 응답을 반환했습니다. 모델이 schema 제약 안에서 토큰을 생성하지 못했을 수 있습니다 (repeat_penalty / temperature / num_ctx 조정 검토). 다시 시도하거나 다른 모델로 전환해 주세요.",
        "bad_response",
      );
    }
    try {
      parsedJson = extractJson(text);
    } catch (e) {
      throw new LlmError(
        `Ollama가 유효한 JSON을 반환하지 않았습니다. ${(e as Error).message}`,
        "json_parse",
        e,
      );
    }
  }

  return { text, parsedJson, raw: data };
}

export async function ollamaPing(config: OllamaConfig): Promise<{
  ok: boolean;
  message: string;
  models?: string[];
}> {
  try {
    const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/tags`, {
      method: "GET",
    });
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { models?: { name: string }[] };
    const models = data.models?.map((m) => m.name) ?? [];
    const hasModel = models.includes(config.model);
    return {
      ok: true,
      message: hasModel
        ? `연결 성공. ${config.model} 사용 가능.`
        : `연결 성공. 단, ${config.model} 이(가) 설치되지 않았습니다. \`ollama pull ${config.model}\` 실행 필요.`,
      models,
    };
  } catch (e) {
    return {
      ok: false,
      message: `연결 실패: ${(e as Error).message}`,
    };
  }
}
