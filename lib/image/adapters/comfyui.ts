import { ComfyUIConfig } from "@/lib/types/settings";
import {
  ImageGenError,
  ImageGenRequest,
  ImageGenResult,
  ImageProviderPing,
} from "@/lib/image/types";
import { buildWorkflow } from "@/lib/image/comfyuiWorkflow";

function aspectToSize(ar?: ImageGenRequest["aspectRatio"]): {
  width: number;
  height: number;
} {
  switch (ar) {
    case "16:9":
      return { width: 1344, height: 768 };
    case "9:16":
      return { width: 768, height: 1344 };
    case "3:2":
      return { width: 1216, height: 832 };
    case "2:3":
      return { width: 832, height: 1216 };
    case "1:1":
    default:
      return { width: 1024, height: 1024 };
  }
}

function trim(url: string): string {
  return url.replace(/\/$/, "");
}

export async function comfyuiGenerate(
  config: ComfyUIConfig,
  req: ImageGenRequest,
): Promise<ImageGenResult> {
  if (!config.baseUrl) {
    throw new ImageGenError("ComfyUI base URL 이 비어 있습니다.", "config");
  }
  const modelType = config.modelType ?? "checkpoint";

  if (!config.model) {
    const what =
      modelType === "flux"
        ? "UNET (Flux)"
        : modelType === "zimage"
          ? "Z-Image diffusion"
          : "체크포인트";
    throw new ImageGenError(
      `ComfyUI ${what} 모델이 설정되지 않았습니다. 설정 → 이미지 Provider 에서 모델을 선택하세요.`,
      "config",
    );
  }
  if (modelType === "zimage") {
    const missing: string[] = [];
    if (!config.textEncoder) missing.push("텍스트 인코더(qwen_3_4b)");
    if (!config.vae) missing.push("VAE(ae)");
    if (missing.length) {
      throw new ImageGenError(
        `Z-Image 워크플로우에 ${missing.join(", ")} 파일명이 필요합니다. 설정 → 이미지 Provider 에서 입력하세요.`,
        "config",
      );
    }
  }
  if (modelType === "flux") {
    const missing: string[] = [];
    if (!config.clipL) missing.push("CLIP-L");
    if (!config.clipT5) missing.push("T5 CLIP");
    if (!config.vae) missing.push("VAE");
    if (missing.length) {
      throw new ImageGenError(
        `Flux 워크플로우에 ${missing.join(", ")} 파일명이 필요합니다. 설정 → 이미지 Provider 에서 입력하세요.`,
        "config",
      );
    }
  }

  const base = trim(config.baseUrl);
  const { width, height } = aspectToSize(req.aspectRatio);

  // If a reference image was supplied, upload it to ComfyUI's input dir so
  // LoadImage can use it for the img2img pipeline.
  let initImageName: string | undefined;
  if (req.initImage) {
    try {
      initImageName = await uploadInputImage(base, req.initImage);
    } catch (e) {
      throw new ImageGenError(
        `ComfyUI 레퍼런스 이미지 업로드 실패: ${(e as Error).message}`,
        "network",
        e,
      );
    }
  }
  const denoise =
    typeof req.denoise === "number"
      ? Math.max(0.05, Math.min(0.95, req.denoise))
      : 0.6;

  let workflow: Record<string, unknown>;
  if (modelType === "flux") {
    workflow = buildWorkflow({
      kind: "flux",
      prompt: req.prompt,
      model: config.model,
      clipL: config.clipL!,
      clipT5: config.clipT5!,
      vae: config.vae!,
      count: req.count,
      width,
      height,
      initImageName,
      denoise,
    });
  } else if (modelType === "zimage") {
    workflow = buildWorkflow({
      kind: "zimage",
      prompt: req.prompt,
      model: config.model,
      textEncoder: config.textEncoder!,
      vae: config.vae!,
      count: req.count,
      width,
      height,
      initImageName,
      denoise,
    });
  } else {
    workflow = buildWorkflow({
      kind: "checkpoint",
      prompt: req.prompt,
      negativePrompt: req.negativePrompt,
      model: config.model,
      count: req.count,
      width,
      height,
      initImageName,
      denoise,
    });
  }

  const clientId = `rba_${Date.now().toString(36)}`;

  // 1) Queue the prompt
  let queueRes: Response;
  try {
    queueRes = await fetch(`${base}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    });
  } catch (e) {
    throw new ImageGenError(
      `ComfyUI 연결 실패 (${base}). 서버 실행 여부 확인.`,
      "network",
      e,
    );
  }
  if (!queueRes.ok) {
    const t = await queueRes.text().catch(() => "");
    throw new ImageGenError(
      `ComfyUI /prompt 오류 ${queueRes.status}: ${t}`,
      "bad_response",
    );
  }
  const queued = (await queueRes.json()) as { prompt_id?: string };
  const promptId = queued.prompt_id;
  if (!promptId) {
    throw new ImageGenError(
      "ComfyUI 가 prompt_id 를 반환하지 않았습니다.",
      "bad_response",
    );
  }

  // 2) Poll /history until the prompt finishes
  const POLL_INTERVAL_MS = 1500;
  const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
  const started = Date.now();
  let history: HistoryEntry | undefined;
  while (Date.now() - started < TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const r = await fetch(`${base}/history/${promptId}`);
      if (!r.ok) continue;
      const data = (await r.json()) as Record<string, HistoryEntry>;
      const entry = data[promptId];
      if (entry && entry.status?.completed) {
        history = entry;
        break;
      }
      // If status.status_str === "error", surface
      if (entry?.status?.status_str === "error") {
        throw new ImageGenError(
          `ComfyUI 실행 오류: ${JSON.stringify(entry.status).slice(0, 500)}`,
          "bad_response",
        );
      }
    } catch (e) {
      if (e instanceof ImageGenError) throw e;
      // transient — keep polling
    }
  }
  if (!history) {
    throw new ImageGenError(
      "ComfyUI 생성 타임아웃 (10분 초과). 큐가 막혔거나 모델이 응답하지 않습니다.",
      "network",
    );
  }

  // 3) Fetch each output image as a blob, encode to data URL
  const images: { dataUrl: string; mime: string }[] = [];
  for (const nodeId of Object.keys(history.outputs ?? {})) {
    const node = history.outputs?.[nodeId];
    if (!node?.images) continue;
    for (const img of node.images) {
      const url = new URL(`${base}/view`);
      url.searchParams.set("filename", img.filename);
      if (img.subfolder) url.searchParams.set("subfolder", img.subfolder);
      url.searchParams.set("type", img.type ?? "output");
      let r: Response;
      try {
        r = await fetch(url.toString());
      } catch (e) {
        throw new ImageGenError(
          `ComfyUI /view 연결 실패: ${(e as Error).message}`,
          "network",
          e,
        );
      }
      if (!r.ok) continue;
      const blob = await r.blob();
      const dataUrl = await blobToDataUrl(blob);
      const mime = blob.type || "image/png";
      images.push({ dataUrl, mime });
    }
  }
  if (images.length === 0) {
    throw new ImageGenError(
      "ComfyUI 가 이미지 출력을 반환하지 않았습니다.",
      "bad_response",
    );
  }
  return { images };
}

export async function comfyuiPing(
  config: ComfyUIConfig,
): Promise<ImageProviderPing> {
  if (!config.baseUrl) {
    return { ok: false, message: "Base URL 이 비어 있습니다." };
  }
  const base = trim(config.baseUrl);
  try {
    const r = await fetch(`${base}/system_stats`);
    if (!r.ok) {
      return { ok: false, message: `HTTP ${r.status}` };
    }
    // /object_info lists every node and its enum inputs — pull out the file
    // lists for the loaders we care about: checkpoint, UNET (Flux), CLIP, VAE.
    let models: string[] | undefined;
    let unetModels: string[] | undefined;
    let clipFiles: string[] | undefined;
    let vaeFiles: string[] | undefined;
    try {
      const oi = await fetch(`${base}/object_info`);
      if (oi.ok) {
        const data = (await oi.json()) as Record<string, ObjectInfoNode>;
        models = extractEnum(data, "CheckpointLoaderSimple", "ckpt_name");
        unetModels = extractEnum(data, "UNETLoader", "unet_name");
        clipFiles =
          extractEnum(data, "DualCLIPLoader", "clip_name1") ??
          extractEnum(data, "CLIPLoader", "clip_name");
        vaeFiles = extractEnum(data, "VAELoader", "vae_name");
      }
    } catch {
      /* ignore */
    }

    const modelType = config.modelType ?? "checkpoint";
    const list =
      modelType === "flux" || modelType === "zimage" ? unetModels : models;
    const hasModel = config.model ? list?.includes(config.model) : true;
    const kindLabel =
      modelType === "flux"
        ? "UNET (Flux)"
        : modelType === "zimage"
          ? "Z-Image diffusion"
          : "체크포인트";
    return {
      ok: true,
      message: !config.model
        ? `연결 성공. ${kindLabel} ${list?.length ?? 0}개 발견 — 사용할 모델을 선택하세요.`
        : hasModel
          ? `연결 성공. ${config.model} 사용 가능 (${kindLabel}).`
          : `연결 성공. 단, ${config.model} 이(가) ${kindLabel} 폴더에 없습니다.`,
      models,
      unetModels,
      clipFiles,
      vaeFiles,
    };
  } catch (e) {
    return {
      ok: false,
      message: `연결 실패: ${(e as Error).message}`,
    };
  }
}

type HistoryEntry = {
  status?: {
    completed?: boolean;
    status_str?: string;
  };
  outputs?: Record<
    string,
    {
      images?: { filename: string; subfolder?: string; type?: string }[];
    }
  >;
};

type ObjectInfoNode = {
  input?: { required?: Record<string, unknown> };
};

/**
 * ComfyUI represents enum inputs as `[[<list of values>], { ...meta }]`.
 * Pull out the string array for a given node + field if present.
 */
function extractEnum(
  data: Record<string, ObjectInfoNode>,
  nodeName: string,
  fieldName: string,
): string[] | undefined {
  const node = data[nodeName];
  const slot = node?.input?.required?.[fieldName];
  if (Array.isArray(slot) && Array.isArray(slot[0])) {
    return slot[0] as string[];
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Upload a data: URL image to ComfyUI's input dir via POST /upload/image.
 * Returns the LoadImage-usable name (prefixed with subfolder if any).
 */
async function uploadInputImage(
  base: string,
  dataUrl: string,
): Promise<string> {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("잘못된 이미지 데이터");
  const mime = m[1];
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = (mime.split("/")[1] || "png").replace("jpeg", "jpg");
  const file = new File([bytes], `ref_${Date.now().toString(36)}.${ext}`, {
    type: mime,
  });
  const form = new FormData();
  form.append("image", file);
  form.append("overwrite", "true");
  form.append("type", "input");
  const res = await fetch(`${base}/upload/image`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    name?: string;
    subfolder?: string;
  };
  if (!data.name) throw new Error("업로드 응답에 name 이 없습니다.");
  return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 =
    typeof btoa !== "undefined"
      ? btoa(bin)
      : Buffer.from(bin, "binary").toString("base64");
  const mime = blob.type || "image/png";
  return `data:${mime};base64,${b64}`;
}
