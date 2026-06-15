import { NextRequest, NextResponse } from "next/server";
import { ProviderConfig } from "@/lib/types/settings";
import { LlmError } from "@/lib/types/llm";
import { complete } from "@/lib/llm/router";

type Body = {
  provider: ProviderConfig;
  items: string[];
};

const SCHEMA = {
  type: "object",
  required: ["items"],
  properties: {
    items: { type: "array", items: { type: "string" } },
  },
} as const;

const SYSTEM = `You translate short Korean architectural terms or phrases to natural, concise English suitable for an image-generation prompt. If an item is already in English (or a name/number), leave it as-is. Output ONLY JSON: { "items": ["...", "...", ...] } with the SAME length and order as the input.`;

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.provider || !Array.isArray(body.items)) {
    return NextResponse.json(
      { error: "provider, items 필드가 필요합니다." },
      { status: 400 },
    );
  }
  // Short-circuit: nothing to translate.
  if (body.items.length === 0) {
    return NextResponse.json({ items: [] });
  }
  // If no Korean chars in any item, return as-is (skip the LLM call).
  const hasKr = body.items.some((s) => /[ㄱ-힣]/.test(s));
  if (!hasKr) {
    return NextResponse.json({ items: body.items });
  }

  const user = `Translate to English. Input array of ${body.items.length}:\n${JSON.stringify(body.items)}`;

  try {
    const res = await complete(body.provider, {
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
      jsonSchema: SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.1,
      maxTokens: 1024,
    });
    if (!res.parsedJson) {
      return NextResponse.json({ items: body.items });
    }
    const parsed = res.parsedJson as { items?: unknown[] };
    if (!Array.isArray(parsed.items)) {
      return NextResponse.json({ items: body.items });
    }
    const out = body.items.map((src, i) => {
      const v = parsed.items?.[i];
      return typeof v === "string" && v.trim() ? v.trim() : src;
    });
    return NextResponse.json({ items: out });
  } catch (e) {
    if (e instanceof LlmError) {
      // Fall back to original on auth/network errors — better than blocking.
      return NextResponse.json({ items: body.items });
    }
    return NextResponse.json({ items: body.items });
  }
}
