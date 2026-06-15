import { NextRequest, NextResponse } from "next/server";
import { ImageProviderConfig } from "@/lib/types/settings";
import { pingImage } from "@/lib/image/router";

export async function POST(req: NextRequest) {
  let cfg: ImageProviderConfig;
  try {
    cfg = (await req.json()) as ImageProviderConfig;
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON body" });
  }
  if (!cfg || !("provider" in cfg)) {
    return NextResponse.json({
      ok: false,
      message: "provider 필드가 필요합니다.",
    });
  }
  const result = await pingImage(cfg);
  return NextResponse.json(result);
}
