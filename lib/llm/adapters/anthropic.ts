import Anthropic from "@anthropic-ai/sdk";
import { AnthropicConfig } from "@/lib/types/settings";
import {
  CompletionRequest,
  CompletionResponse,
  LlmError,
} from "@/lib/types/llm";

function client(config: AnthropicConfig) {
  return new Anthropic({ apiKey: config.apiKey });
}

export async function anthropicComplete(
  config: AnthropicConfig,
  req: CompletionRequest,
): Promise<CompletionResponse> {
  const c = client(config);

  const messages = req.messages.map((m) => ({
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: m.content,
  }));

  try {
    if (req.jsonSchema) {
      const resp = await c.messages.create({
        model: config.model,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.3,
        system: req.system,
        messages,
        tools: [
          {
            name: "emit_result",
            description: "Return the structured result.",
            input_schema: req.jsonSchema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: "tool", name: "emit_result" },
      });
      const toolUse = resp.content.find((b) => b.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") {
        throw new LlmError(
          "Anthropic이 tool 응답을 반환하지 않았습니다.",
          "bad_response",
        );
      }
      return {
        text: JSON.stringify(toolUse.input),
        parsedJson: toolUse.input,
        usage: {
          inputTokens: resp.usage.input_tokens,
          outputTokens: resp.usage.output_tokens,
        },
        raw: resp,
      };
    }

    const resp = await c.messages.create({
      model: config.model,
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.3,
      system: req.system,
      messages,
    });
    const text = resp.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n");
    return {
      text,
      usage: {
        inputTokens: resp.usage.input_tokens,
        outputTokens: resp.usage.output_tokens,
      },
      raw: resp,
    };
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err.status === 401) {
      throw new LlmError("Anthropic API 키가 유효하지 않습니다.", "auth", e);
    }
    if (err.status === 429) {
      throw new LlmError("Anthropic 호출 한도 초과.", "rate_limit", e);
    }
    throw new LlmError(
      `Anthropic 오류: ${err.message ?? "알 수 없음"}`,
      "unknown",
      e,
    );
  }
}

export async function anthropicPing(
  config: AnthropicConfig,
): Promise<{ ok: boolean; message: string }> {
  try {
    const c = client(config);
    await c.messages.create({
      model: config.model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return { ok: true, message: `연결 성공 (${config.model}).` };
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err.status === 401) return { ok: false, message: "API 키 무효" };
    return { ok: false, message: err.message ?? "연결 실패" };
  }
}
