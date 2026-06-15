import { ProviderConfig } from "@/lib/types/settings";
import { CompletionRequest, CompletionResponse } from "@/lib/types/llm";
import { ollamaComplete, ollamaPing } from "./adapters/ollama";
import { anthropicComplete, anthropicPing } from "./adapters/anthropic";
import { geminiComplete, geminiPing } from "./adapters/gemini";

export async function complete(
  config: ProviderConfig,
  req: CompletionRequest,
): Promise<CompletionResponse> {
  switch (config.provider) {
    case "ollama":
      return ollamaComplete(config, req);
    case "anthropic":
      return anthropicComplete(config, req);
    case "gemini":
      return geminiComplete(config, req);
  }
}

export async function ping(
  config: ProviderConfig,
): Promise<{ ok: boolean; message: string; models?: string[] }> {
  switch (config.provider) {
    case "ollama":
      return ollamaPing(config);
    case "anthropic":
      return anthropicPing(config);
    case "gemini":
      return geminiPing(config);
  }
}
