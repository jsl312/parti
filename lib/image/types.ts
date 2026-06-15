export type ImageGenRequest = {
  prompt: string;
  /** Number of images. Providers cap differently — adapter clamps. */
  count: number;
  /** Optional aspect ratio hint. Adapters may ignore. */
  aspectRatio?: "1:1" | "3:2" | "2:3" | "16:9" | "9:16";
  /** Optional negative prompt (ComfyUI). */
  negativePrompt?: string;
  /**
   * Optional reference image as a data: URL. ComfyUI uses it as an img2img
   * base so the generated image keeps the site's overall shape/proportion.
   */
  initImage?: string;
  /**
   * img2img denoise strength (0–1). Lower = stay closer to the reference
   * (more structure kept), higher = more freedom. Only used with initImage.
   */
  denoise?: number;
};

export type ImageGenResult = {
  images: { dataUrl: string; mime: string }[];
};

export type ImageProviderPing = {
  ok: boolean;
  message: string;
  /** Models found (ComfyUI checkpoints, etc.) for the user to choose from. */
  models?: string[];
  /** ComfyUI only — UNET / diffusion model files (Flux lives here). */
  unetModels?: string[];
  /** ComfyUI only — CLIP files (clip_l, t5xxl, etc.) */
  clipFiles?: string[];
  /** ComfyUI only — VAE files. */
  vaeFiles?: string[];
};

export class ImageGenError extends Error {
  constructor(
    message: string,
    public kind:
      | "network"
      | "auth"
      | "bad_response"
      | "config"
      | "unknown" = "unknown",
    public cause?: unknown,
  ) {
    super(message);
    this.name = "ImageGenError";
  }
}
