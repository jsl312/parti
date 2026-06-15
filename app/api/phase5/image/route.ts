import { NextRequest, NextResponse } from "next/server";
import { ImageProviderConfig } from "@/lib/types/settings";
import { generateImage } from "@/lib/image/router";
import { ImageGenError } from "@/lib/image/types";

type Body = {
  imageProvider: ImageProviderConfig;
  prompt: string;
  count?: number;
  aspectRatio?: "1:1" | "3:2" | "2:3" | "16:9" | "9:16";
  negativePrompt?: string;
  initImage?: string;
  denoise?: number;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.imageProvider || !body.prompt) {
    return NextResponse.json(
      { error: "imageProvider, prompt 필드가 필요합니다." },
      { status: 400 },
    );
  }
  const count = Math.max(1, Math.min(4, body.count ?? 4));

  try {
    const result = await generateImage(body.imageProvider, {
      prompt: body.prompt,
      count,
      aspectRatio: body.aspectRatio,
      negativePrompt: body.negativePrompt,
      initImage: body.initImage,
      denoise: body.denoise,
    });
    return NextResponse.json({ images: result.images });
  } catch (e) {
    if (e instanceof ImageGenError) {
      const status =
        e.kind === "auth" ? 401 : e.kind === "config" ? 400 : 502;
      return NextResponse.json({ error: e.message, kind: e.kind }, { status });
    }
    const err = e as Error;
    return NextResponse.json(
      { error: err.message || "알 수 없는 오류" },
      { status: 500 },
    );
  }
}

// Max duration for image generation can be very long (ComfyUI). Disable
// streaming/edge defaults — this route runs in node runtime.
export const runtime = "nodejs";
export const maxDuration = 600;
