import { ImageProviderConfig } from "@/lib/types/settings";
import {
  ImageGenRequest,
  ImageGenResult,
  ImageProviderPing,
} from "@/lib/image/types";
import { comfyuiGenerate, comfyuiPing } from "./adapters/comfyui";
import { openaiGenerate, openaiPing } from "./adapters/openai";
import { geminiImageGenerate, geminiImagePing } from "./adapters/gemini";

export async function generateImage(
  config: ImageProviderConfig,
  req: ImageGenRequest,
): Promise<ImageGenResult> {
  switch (config.provider) {
    case "comfyui":
      return comfyuiGenerate(config, req);
    case "openai":
      return openaiGenerate(config, req);
    case "gemini_image":
      return geminiImageGenerate(config, req);
  }
}

export async function pingImage(
  config: ImageProviderConfig,
): Promise<ImageProviderPing> {
  switch (config.provider) {
    case "comfyui":
      return comfyuiPing(config);
    case "openai":
      return openaiPing(config);
    case "gemini_image":
      return geminiImagePing(config);
  }
}
