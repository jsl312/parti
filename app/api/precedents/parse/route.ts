import { NextRequest, NextResponse } from "next/server";
import { ProviderConfig } from "@/lib/types/settings";
import { Language } from "@/lib/types/project";
import { LlmError } from "@/lib/types/llm";
import { complete } from "@/lib/llm/router";
import {
  PRECEDENT_PARSE_SCHEMA,
  buildPrecedentParseSystem,
  buildPrecedentParseUser,
} from "@/lib/skill/precedents";

type Body = {
  provider: ProviderConfig;
  language: Language;
  text: string;
};

type ParsedItem = {
  name: string;
  architect?: string;
  year?: string;
  location?: string;
  strategy?: string;
  relevance?: string;
  sourceUrl?: string;
};

const str = (v: unknown): string =>
  typeof v === "string" ? v.trim() : "";

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.provider || !body.language || !body.text) {
    return NextResponse.json(
      { error: "provider, language, text 필드가 필요합니다." },
      { status: 400 },
    );
  }
  if (!body.text.trim()) {
    return NextResponse.json(
      { error: "정리할 조사 결과 텍스트를 입력해 주세요." },
      { status: 400 },
    );
  }

  try {
    const res = await complete(body.provider, {
      system: buildPrecedentParseSystem(body.language),
      messages: [
        { role: "user", content: buildPrecedentParseUser(body.text) },
      ],
      jsonSchema: PRECEDENT_PARSE_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.2,
      maxTokens: 8192,
    });
    if (!res.parsedJson) {
      return NextResponse.json(
        { error: "LLM 응답에서 JSON 을 추출하지 못했습니다.", raw: res.text },
        { status: 502 },
      );
    }
    const parsed = res.parsedJson as { items?: unknown[] };
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const items: ParsedItem[] = rawItems
      .map((it) => {
        const o = (it ?? {}) as Record<string, unknown>;
        return {
          name: str(o.name),
          architect: str(o.architect),
          year: str(o.year),
          location: str(o.location),
          strategy: str(o.strategy),
          relevance: str(o.relevance),
          sourceUrl: str(o.sourceUrl),
        };
      })
      .filter((it) => it.name);

    return NextResponse.json({ items });
  } catch (e) {
    if (e instanceof LlmError) {
      return NextResponse.json(
        { error: e.message, kind: e.kind },
        { status: e.kind === "auth" ? 401 : 502 },
      );
    }
    const err = e as Error;
    return NextResponse.json(
      { error: err.message || "알 수 없는 오류" },
      { status: 500 },
    );
  }
}
