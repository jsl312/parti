import { GoogleGenerativeAI } from "@google/generative-ai";
import { GeminiConfig } from "@/lib/types/settings";
import {
  CompletionRequest,
  CompletionResponse,
  LlmError,
} from "@/lib/types/llm";
import { extractJson } from "@/lib/llm/jsonExtract";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Transient server-side conditions worth retrying: overload (503), rate limit
 * (429), and the occasional 500. Gemini surfaces these in the error message
 * (e.g. "[503 Service Unavailable] This model is currently experiencing high
 * demand") and sometimes on a numeric `status`.
 */
function isTransient(e: unknown): boolean {
  const err = e as { status?: number; message?: string };
  if (err.status === 503 || err.status === 429 || err.status === 500)
    return true;
  const m = (err.message ?? "").toLowerCase();
  return (
    m.includes("503") ||
    m.includes("429") ||
    m.includes("500") ||
    m.includes("service unavailable") ||
    m.includes("unavailable") ||
    m.includes("overload") ||
    m.includes("high demand") ||
    m.includes("rate limit") ||
    m.includes("try again later") ||
    m.includes("resource_exhausted")
  );
}

export async function geminiComplete(
  config: GeminiConfig,
  req: CompletionRequest,
): Promise<CompletionResponse> {
  const genAI = new GoogleGenerativeAI(config.apiKey);

  const generationConfig: Record<string, unknown> = {
    temperature: req.temperature ?? 0.3,
    maxOutputTokens: req.maxTokens ?? 16384,
  };
  if (req.jsonSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = req.jsonSchema;
  }

  const model = genAI.getGenerativeModel({
    model: config.model,
    systemInstruction: req.system,
    generationConfig,
  });

  const history = req.messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const last = req.messages[req.messages.length - 1];

  try {
    // Retry transient overload / rate-limit / 5xx with exponential backoff.
    const MAX_ATTEMPTS = 4;
    let result!: Awaited<
      ReturnType<ReturnType<typeof model.startChat>["sendMessage"]>
    >;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const chat = model.startChat({ history });
        result = await chat.sendMessage(last?.content ?? "");
        break;
      } catch (e) {
        attempt++;
        if (attempt >= MAX_ATTEMPTS || !isTransient(e)) throw e;
        // 1s, 2s, 4s (+ jitter) — high-demand spikes are usually brief.
        const backoff = 1000 * 2 ** (attempt - 1) + Math.random() * 400;
        await sleep(backoff);
      }
    }
    const text = result.response.text();
    const finishReason = result.response.candidates?.[0]?.finishReason;

    let parsedJson: unknown = undefined;
    if (req.jsonSchema) {
      try {
        parsedJson = extractJson(text);
      } catch (e) {
        const reasonNote =
          finishReason && finishReason !== "STOP"
            ? ` (finishReason: ${finishReason}${finishReason === "MAX_TOKENS" ? " — maxOutputTokens 한도 도달, 응답이 잘렸습니다" : ""})`
            : "";
        throw new LlmError(
          `Gemini가 유효한 JSON을 반환하지 않았습니다${reasonNote}. ${(e as Error).message}`,
          "json_parse",
          e,
        );
      }
    }

    return { text, parsedJson, raw: result };
  } catch (e) {
    if (e instanceof LlmError) throw e;
    const err = e as { message?: string; status?: number };
    if (err.message?.includes("API key")) {
      throw new LlmError("Gemini API 키가 유효하지 않습니다.", "auth", e);
    }
    if (isTransient(e)) {
      throw new LlmError(
        "Gemini 모델이 일시적으로 과부하 상태입니다 (재시도했지만 실패). 잠시 후 다시 시도하거나, 설정에서 다른 모델/제공자로 전환해 주세요.",
        "rate_limit",
        e,
      );
    }
    throw new LlmError(
      `Gemini 오류: ${err.message ?? "알 수 없음"}`,
      "unknown",
      e,
    );
  }
}

export async function geminiPing(
  config: GeminiConfig,
): Promise<{ ok: boolean; message: string }> {
  try {
    const genAI = new GoogleGenerativeAI(config.apiKey);
    const model = genAI.getGenerativeModel({ model: config.model });
    await model.generateContent("ping");
    return { ok: true, message: `연결 성공 (${config.model}).` };
  } catch (e) {
    const err = e as { message?: string };
    return { ok: false, message: err.message ?? "연결 실패" };
  }
}
