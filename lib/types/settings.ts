export type LlmProvider = "ollama" | "anthropic" | "gemini";

export type OllamaConfig = {
  provider: "ollama";
  baseUrl: string;
  model: string;
};

export type AnthropicConfig = {
  provider: "anthropic";
  apiKey: string;
  model: string;
};

export type GeminiConfig = {
  provider: "gemini";
  apiKey: string;
  model: string;
};

export type ProviderConfig = OllamaConfig | AnthropicConfig | GeminiConfig;

// ─── Image generation providers (separate from text LLM) ─────────────────

export type ImageProvider = "comfyui" | "openai" | "gemini_image";

export type ComfyUIModelType = "checkpoint" | "flux" | "zimage";

export type ComfyUIConfig = {
  provider: "comfyui";
  baseUrl: string;
  /**
   * For "checkpoint": .safetensors in models/checkpoints.
   * For "flux": .safetensors in models/unet.
   * For "zimage": .safetensors in models/diffusion_models (e.g.
   * "z-image-turbo-fp8-e4m3fn.safetensors").
   */
  model: string;
  /** Defaults to "checkpoint" for back-compat with prior settings. */
  modelType?: ComfyUIModelType;
  /** Flux only — CLIP-L file in models/clip (e.g. "clip_l.safetensors"). */
  clipL?: string;
  /** Flux only — T5 CLIP file in models/clip (e.g. "t5xxl_fp16.safetensors"). */
  clipT5?: string;
  /** Flux & Z-Image — VAE file in models/vae (e.g. "ae.safetensors"). */
  vae?: string;
  /** Z-Image only — Qwen text encoder in models/text_encoders (e.g. "qwen_3_4b.safetensors"). */
  textEncoder?: string;
};

export type OpenAIImageConfig = {
  provider: "openai";
  apiKey: string;
  model: string;
};

export type GeminiImageConfig = {
  provider: "gemini_image";
  apiKey: string;
  model: string;
};

export type ImageProviderConfig =
  | ComfyUIConfig
  | OpenAIImageConfig
  | GeminiImageConfig;

export type ImageSettings = {
  active: ImageProvider;
  comfyui: ComfyUIConfig;
  openai: OpenAIImageConfig;
  gemini_image: GeminiImageConfig;
};

// ─── V-World (주변 대지 분석) ──────────────────────────────────────────────

export type VworldConfig = {
  /** V-World API key (vworld.kr). Domain-registered. */
  apiKey: string;
  /** Domain registered with the key (sent server-side as the `domain` param). */
  domain?: string;
};

// ─── Batch generation (P4→P5 일괄 생성) ────────────────────────────────────

export type BatchConfig = {
  /** Base output directory (relative to the server's cwd or absolute). */
  outputDir: string;
};

// ─── Web search (라이브 웹 검색 보강) ──────────────────────────────────────

export type WebSearchConfig = {
  /** Search backend. Currently only Tavily. */
  provider: "tavily";
  /** Tavily API key (tvly-...). Stored in browser localStorage only. */
  apiKey: string;
  /**
   * When true, 자동 조사 first runs the prompt through live web search and
   * feeds the gathered sources to the local model (RAG), instead of relying on
   * the model's own knowledge.
   */
  enabled: boolean;
  /** Max sources to gather per run (1–10). */
  maxResults: number;
};

export type AppSettings = {
  active: LlmProvider;
  ollama: OllamaConfig;
  anthropic: AnthropicConfig;
  gemini: GeminiConfig;
  /** Optional — older saved settings may not have this; loadSettings backfills. */
  image?: ImageSettings;
  /** Optional — V-World key for surrounding-site analysis. */
  vworld?: VworldConfig;
  /** Optional — batch generation output directory. */
  batch?: BatchConfig;
  /** Optional — live web search (Tavily) for 자동 조사. */
  webSearch?: WebSearchConfig;
};

export const DEFAULT_IMAGE_SETTINGS: ImageSettings = {
  active: "comfyui",
  comfyui: {
    provider: "comfyui",
    baseUrl: "http://localhost:8188",
    model: "",
    modelType: "flux",
    clipL: "clip_l.safetensors",
    clipT5: "t5xxl_fp16.safetensors",
    vae: "ae.safetensors",
    textEncoder: "qwen_3_4b.safetensors",
  },
  openai: {
    provider: "openai",
    apiKey: "",
    model: "gpt-image-1",
  },
  gemini_image: {
    provider: "gemini_image",
    apiKey: "",
    model: "imagen-3.0-generate-002",
  },
};

export const DEFAULT_SETTINGS: AppSettings = {
  active: "ollama",
  ollama: {
    provider: "ollama",
    baseUrl: "http://localhost:11434",
    model: "qwen2.5:14b",
  },
  anthropic: {
    provider: "anthropic",
    apiKey: "",
    model: "claude-sonnet-4-6",
  },
  gemini: {
    provider: "gemini",
    apiKey: "",
    model: "gemini-2.5-pro",
  },
  image: DEFAULT_IMAGE_SETTINGS,
  vworld: { apiKey: "", domain: "" },
  batch: { outputDir: "./parti-output" },
  webSearch: {
    provider: "tavily",
    apiKey: "",
    enabled: false,
    maxResults: 5,
  },
};

export function activeConfig(settings: AppSettings): ProviderConfig {
  return settings[settings.active];
}

export function activeImageConfig(settings: AppSettings): ImageProviderConfig {
  const image = settings.image ?? DEFAULT_IMAGE_SETTINGS;
  return image[image.active];
}
