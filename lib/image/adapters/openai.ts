import { OpenAIImageConfig } from "@/lib/types/settings";
import {
  ImageGenError,
  ImageGenRequest,
  ImageGenResult,
  ImageProviderPing,
} from "@/lib/image/types";

function sizeFromAspect(ar?: ImageGenRequest["aspectRatio"]): string {
  // gpt-image-1 accepts: 1024x1024, 1024x1536, 1536x1024, auto
  switch (ar) {
    case "16:9":
    case "3:2":
      return "1536x1024";
    case "9:16":
    case "2:3":
      return "1024x1536";
    case "1:1":
    default:
      return "1024x1024";
  }
}

export async function openaiGenerate(
  config: OpenAIImageConfig,
  req: ImageGenRequest,
): Promise<ImageGenResult> {
  if (!config.apiKey) {
    throw new ImageGenError("OpenAI API 키가 비어 있습니다.", "config");
  }
  const body = {
    model: config.model || "gpt-image-1",
    prompt: req.prompt,
    n: Math.max(1, Math.min(4, req.count)),
    size: sizeFromAspect(req.aspectRatio),
  };
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new ImageGenError(
      `OpenAI 연결 실패: ${(e as Error).message}`,
      "network",
      e,
    );
  }
  if (res.status === 401) {
    throw new ImageGenError("OpenAI API 키 인증 실패.", "auth");
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new ImageGenError(
      `OpenAI ${res.status}: ${t.slice(0, 500)}`,
      "bad_response",
    );
  }
  const data = (await res.json()) as {
    data?: { b64_json?: string; url?: string }[];
  };
  const images: { dataUrl: string; mime: string }[] = [];
  for (const item of data.data ?? []) {
    if (item.b64_json) {
      images.push({
        dataUrl: `data:image/png;base64,${item.b64_json}`,
        mime: "image/png",
      });
    } else if (item.url) {
      // Fetch and embed
      try {
        const r = await fetch(item.url);
        const blob = await r.blob();
        const buf = await blob.arrayBuffer();
        const b64 = bufferToBase64(buf);
        const mime = blob.type || "image/png";
        images.push({ dataUrl: `data:${mime};base64,${b64}`, mime });
      } catch {
        /* skip */
      }
    }
  }
  if (images.length === 0) {
    throw new ImageGenError(
      "OpenAI 가 이미지를 반환하지 않았습니다.",
      "bad_response",
    );
  }
  return { images };
}

export async function openaiPing(
  config: OpenAIImageConfig,
): Promise<ImageProviderPing> {
  if (!config.apiKey) {
    return { ok: false, message: "API 키가 비어 있습니다." };
  }
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { authorization: `Bearer ${config.apiKey}` },
    });
    if (res.status === 401) {
      return { ok: false, message: "API 키 인증 실패." };
    }
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status}` };
    }
    return { ok: true, message: `연결 성공. 모델 ${config.model} 사용.` };
  } catch (e) {
    return { ok: false, message: `연결 실패: ${(e as Error).message}` };
  }
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return typeof btoa !== "undefined"
    ? btoa(bin)
    : Buffer.from(bin, "binary").toString("base64");
}
