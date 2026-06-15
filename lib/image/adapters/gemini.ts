import { GeminiImageConfig } from "@/lib/types/settings";
import {
  ImageGenError,
  ImageGenRequest,
  ImageGenResult,
  ImageProviderPing,
} from "@/lib/image/types";

function aspectForImagen(ar?: ImageGenRequest["aspectRatio"]): string {
  switch (ar) {
    case "16:9":
      return "16:9";
    case "9:16":
      return "9:16";
    case "3:2":
      return "4:3";
    case "2:3":
      return "3:4";
    case "1:1":
    default:
      return "1:1";
  }
}

export async function geminiImageGenerate(
  config: GeminiImageConfig,
  req: ImageGenRequest,
): Promise<ImageGenResult> {
  if (!config.apiKey) {
    throw new ImageGenError("Gemini API 키가 비어 있습니다.", "config");
  }
  const model = config.model || "imagen-3.0-generate-002";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:predict?key=${encodeURIComponent(config.apiKey)}`;
  const body = {
    instances: [{ prompt: req.prompt }],
    parameters: {
      sampleCount: Math.max(1, Math.min(4, req.count)),
      aspectRatio: aspectForImagen(req.aspectRatio),
    },
  };
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new ImageGenError(
      `Gemini 연결 실패: ${(e as Error).message}`,
      "network",
      e,
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new ImageGenError("Gemini API 키 인증 실패.", "auth");
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new ImageGenError(
      `Gemini ${res.status}: ${t.slice(0, 500)}`,
      "bad_response",
    );
  }
  const data = (await res.json()) as {
    predictions?: {
      bytesBase64Encoded?: string;
      mimeType?: string;
    }[];
  };
  const images: { dataUrl: string; mime: string }[] = [];
  for (const p of data.predictions ?? []) {
    if (!p.bytesBase64Encoded) continue;
    const mime = p.mimeType || "image/png";
    images.push({
      dataUrl: `data:${mime};base64,${p.bytesBase64Encoded}`,
      mime,
    });
  }
  if (images.length === 0) {
    throw new ImageGenError(
      "Gemini 가 이미지를 반환하지 않았습니다 (이용 권한·할당량 확인).",
      "bad_response",
    );
  }
  return { images };
}

export async function geminiImagePing(
  config: GeminiImageConfig,
): Promise<ImageProviderPing> {
  if (!config.apiKey) {
    return { ok: false, message: "API 키가 비어 있습니다." };
  }
  // No cheap "list" for Imagen — do a minimal models GET to validate the key.
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(config.apiKey)}`;
    const res = await fetch(url);
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: "API 키 인증 실패." };
    }
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status}` };
    }
    return {
      ok: true,
      message: `연결 성공. 모델 ${config.model} 사용 가능 (Imagen 이용 권한 별도 확인 필요).`,
    };
  } catch (e) {
    return { ok: false, message: `연결 실패: ${(e as Error).message}` };
  }
}
