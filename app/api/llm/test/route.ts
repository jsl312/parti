import { NextRequest, NextResponse } from "next/server";
import { ProviderConfig } from "@/lib/types/settings";
import { ping } from "@/lib/llm/router";

export async function POST(req: NextRequest) {
  let config: ProviderConfig;
  try {
    config = (await req.json()) as ProviderConfig;
  } catch {
    return NextResponse.json(
      { ok: false, message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!config.provider) {
    return NextResponse.json(
      { ok: false, message: "provider 필드가 필요합니다." },
      { status: 400 },
    );
  }

  const result = await ping(config);
  return NextResponse.json(result);
}
