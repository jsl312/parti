/**
 * ComfyUI API workflows for text→image.
 *
 * Two pipelines:
 *
 * 1) "checkpoint" — all-in-one .safetensors in models/checkpoints/
 *    CheckpointLoaderSimple → CLIP encode × 2 → KSampler → VAEDecode → SaveImage
 *
 * 2) "flux" — Flux dev/schnell .safetensors in models/unet/ with separate
 *    CLIP (clip_l + t5xxl in models/clip/) and VAE (models/vae/)
 *    UNETLoader → DualCLIPLoader → VAELoader →
 *    CLIPTextEncode (positive only, Flux ignores negative under cfg=1) →
 *    EmptyLatentImage → KSampler (cfg=1, euler/simple) → VAEDecode → SaveImage
 */

export type CheckpointWorkflowInput = {
  kind: "checkpoint";
  prompt: string;
  negativePrompt?: string;
  model: string;
  count: number;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  seed?: number;
  /** ComfyUI input-dir filename for img2img. If set → img2img pipeline. */
  initImageName?: string;
  /** img2img denoise (0–1). Lower keeps the reference structure more. */
  denoise?: number;
};

export type FluxWorkflowInput = {
  kind: "flux";
  prompt: string;
  /** unet filename, e.g. "flux1-dev.safetensors" */
  model: string;
  clipL: string;
  clipT5: string;
  vae: string;
  count: number;
  width?: number;
  height?: number;
  /** Flux dev ~20–30, Flux schnell 4. Default 20. */
  steps?: number;
  /** Flux uses cfg≈1 (negative ignored); FluxGuidance node shifts the guidance. Default 1. */
  cfg?: number;
  /**
   * Flux distilled-guidance value (FluxGuidance node). ComfyUI default is 3.5,
   * which over-saturates and gives the plasticky "AI" look. ~2.5 yields more
   * natural, photographic results while keeping prompt adherence. Default 2.5.
   */
  guidance?: number;
  sampler?: string;
  scheduler?: string;
  seed?: number;
  /** ComfyUI input-dir filename for img2img. If set → img2img pipeline. */
  initImageName?: string;
  /** img2img denoise (0–1). Lower keeps the reference structure more. */
  denoise?: number;
};

export type ZImageWorkflowInput = {
  kind: "zimage";
  prompt: string;
  /** diffusion_models filename, e.g. "z-image-turbo-fp8-e4m3fn.safetensors" */
  model: string;
  /** Qwen text encoder in models/text_encoders, e.g. "qwen_3_4b.safetensors" */
  textEncoder: string;
  /** VAE in models/vae, e.g. "ae.safetensors" */
  vae: string;
  count: number;
  width?: number;
  height?: number;
  /** Z-Image Turbo is distilled — 8 steps. Default 8. */
  steps?: number;
  /** Distilled model: cfg≈1 (no classifier-free guidance). Default 1. */
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  seed?: number;
  /** ComfyUI input-dir filename for img2img. If set → img2img pipeline. */
  initImageName?: string;
  /** img2img denoise (0–1). Lower keeps the reference structure more. */
  denoise?: number;
};

export type WorkflowInput =
  | CheckpointWorkflowInput
  | FluxWorkflowInput
  | ZImageWorkflowInput;

const DEFAULT_NEGATIVE =
  "blurry, low quality, watermark, text, logo, signature, distorted, deformed";

export function buildWorkflow(input: WorkflowInput): Record<string, unknown> {
  if (input.kind === "flux") return buildFluxWorkflow(input);
  if (input.kind === "zimage") return buildZImageWorkflow(input);
  return buildCheckpointWorkflow(input);
}

function buildCheckpointWorkflow(
  input: CheckpointWorkflowInput,
): Record<string, unknown> {
  const {
    prompt,
    negativePrompt = DEFAULT_NEGATIVE,
    model,
    count,
    width = 1024,
    height = 1024,
    steps = 25,
    cfg = 7,
    sampler = "euler",
    scheduler = "normal",
    seed = Math.floor(Math.random() * 2 ** 31),
  } = input;

  const batch = Math.max(1, Math.min(8, count));
  const base: Record<string, unknown> = {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: model },
    },
    "2": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["1", 1] },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: { text: negativePrompt, clip: ["1", 1] },
    },
  };

  const { nodes: latentNodes, latentRef } = latentSource(
    "4",
    width,
    height,
    batch,
    input.initImageName,
    ["1", 2], // checkpoint VAE output slot
  );
  Object.assign(base, latentNodes);

  base["5"] = {
    class_type: "KSampler",
    inputs: {
      seed,
      steps,
      cfg,
      sampler_name: sampler,
      scheduler,
      denoise: input.initImageName ? (input.denoise ?? 0.6) : 1.0,
      model: ["1", 0],
      positive: ["2", 0],
      negative: ["3", 0],
      latent_image: latentRef,
    },
  };
  base["6"] = {
    class_type: "VAEDecode",
    inputs: { samples: ["5", 0], vae: ["1", 2] },
  };
  base["7"] = {
    class_type: "SaveImage",
    inputs: { images: ["6", 0], filename_prefix: "concept" },
  };
  return base;
}

/**
 * Build the latent-source nodes. Text2img → EmptyLatentImage. img2img →
 * LoadImage → ImageScale → VAEEncode → RepeatLatentBatch(count). Node ids are
 * prefixed so they don't collide with the main graph.
 */
function latentSource(
  baseId: string,
  width: number,
  height: number,
  batch: number,
  initImageName: string | undefined,
  vaeRef: [string, number],
): { nodes: Record<string, unknown>; latentRef: [string, number] } {
  if (!initImageName) {
    return {
      nodes: {
        [baseId]: {
          class_type: "EmptyLatentImage",
          inputs: { width, height, batch_size: batch },
        },
      },
      latentRef: [baseId, 0],
    };
  }
  const load = `${baseId}_load`;
  const scale = `${baseId}_scale`;
  const enc = `${baseId}_enc`;
  const rep = `${baseId}_rep`;
  return {
    nodes: {
      [load]: {
        class_type: "LoadImage",
        inputs: { image: initImageName },
      },
      [scale]: {
        class_type: "ImageScale",
        inputs: {
          image: [load, 0],
          upscale_method: "lanczos",
          width,
          height,
          crop: "center",
        },
      },
      [enc]: {
        class_type: "VAEEncode",
        inputs: { pixels: [scale, 0], vae: vaeRef },
      },
      [rep]: {
        class_type: "RepeatLatentBatch",
        inputs: { samples: [enc, 0], amount: batch },
      },
    },
    latentRef: [rep, 0],
  };
}

function buildFluxWorkflow(input: FluxWorkflowInput): Record<string, unknown> {
  const {
    prompt,
    model,
    clipL,
    clipT5,
    vae,
    count,
    width = 1024,
    height = 1024,
    steps = 20,
    cfg = 1,
    guidance = 2.5,
    sampler = "euler",
    scheduler = "simple",
    seed = Math.floor(Math.random() * 2 ** 31),
  } = input;

  const graph = {
    "1": {
      class_type: "UNETLoader",
      inputs: { unet_name: model, weight_dtype: "default" },
    },
    "2": {
      class_type: "DualCLIPLoader",
      inputs: {
        clip_name1: clipL,
        clip_name2: clipT5,
        type: "flux",
      },
    },
    "3": {
      class_type: "VAELoader",
      inputs: { vae_name: vae },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["2", 0] },
    },
    // Lower distilled guidance than ComfyUI's 3.5 default → less "AI sheen",
    // more natural photographic tonality.
    "4g": {
      class_type: "FluxGuidance",
      inputs: { conditioning: ["4", 0], guidance },
    },
    "5": {
      // Negative prompt is required by KSampler shape but ignored at cfg=1.
      class_type: "CLIPTextEncode",
      inputs: { text: "", clip: ["2", 0] },
    },
  } as Record<string, unknown>;

  const batch = Math.max(1, Math.min(8, count));
  const { nodes: latentNodes, latentRef } = latentSource(
    "6",
    width,
    height,
    batch,
    input.initImageName,
    ["3", 0], // Flux VAELoader output slot
  );
  Object.assign(graph, latentNodes);

  graph["7"] = {
    class_type: "KSampler",
    inputs: {
      seed,
      steps,
      cfg,
      sampler_name: sampler,
      scheduler,
      denoise: input.initImageName ? (input.denoise ?? 0.6) : 1.0,
      model: ["1", 0],
      positive: ["4g", 0],
      negative: ["5", 0],
      latent_image: latentRef,
    },
  };
  graph["8"] = {
    class_type: "VAEDecode",
    inputs: { samples: ["7", 0], vae: ["3", 0] },
  };
  graph["9"] = {
    class_type: "SaveImage",
    inputs: { images: ["8", 0], filename_prefix: "concept" },
  };
  return graph;
}

/**
 * Z-Image Turbo (Alibaba Tongyi, 6B). Like Flux it loads a diffusion model +
 * text encoder + VAE separately, but uses a SINGLE CLIPLoader with type
 * "lumina2" (the Qwen text encoder), no FluxGuidance node, and the distilled
 * Turbo defaults: 8 steps, cfg 1 (negative ignored).
 */
function buildZImageWorkflow(
  input: ZImageWorkflowInput,
): Record<string, unknown> {
  const {
    prompt,
    model,
    textEncoder,
    vae,
    count,
    width = 1024,
    height = 1024,
    steps = 8,
    cfg = 1,
    sampler = "euler",
    scheduler = "simple",
    seed = Math.floor(Math.random() * 2 ** 31),
  } = input;

  const graph = {
    "1": {
      class_type: "UNETLoader",
      inputs: { unet_name: model, weight_dtype: "default" },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: { clip_name: textEncoder, type: "lumina2" },
    },
    "3": {
      class_type: "VAELoader",
      inputs: { vae_name: vae },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["2", 0] },
    },
    "5": {
      // Negative prompt required by KSampler shape but ignored at cfg=1.
      class_type: "CLIPTextEncode",
      inputs: { text: "", clip: ["2", 0] },
    },
  } as Record<string, unknown>;

  const batch = Math.max(1, Math.min(8, count));
  const { nodes: latentNodes, latentRef } = latentSource(
    "6",
    width,
    height,
    batch,
    input.initImageName,
    ["3", 0], // VAELoader output slot
  );
  Object.assign(graph, latentNodes);

  graph["7"] = {
    class_type: "KSampler",
    inputs: {
      seed,
      steps,
      cfg,
      sampler_name: sampler,
      scheduler,
      denoise: input.initImageName ? (input.denoise ?? 0.6) : 1.0,
      model: ["1", 0],
      positive: ["4", 0],
      negative: ["5", 0],
      latent_image: latentRef,
    },
  };
  graph["8"] = {
    class_type: "VAEDecode",
    inputs: { samples: ["7", 0], vae: ["3", 0] },
  };
  graph["9"] = {
    class_type: "SaveImage",
    inputs: { images: ["8", 0], filename_prefix: "concept" },
  };
  return graph;
}
