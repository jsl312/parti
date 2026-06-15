import { NextRequest, NextResponse } from "next/server";
import { ProviderConfig } from "@/lib/types/settings";
import {
  ConceptParams,
  ConceptStructure,
  Language,
} from "@/lib/types/project";
import { LlmError } from "@/lib/types/llm";
import { complete } from "@/lib/llm/router";
import {
  PHASE5_FEEDBACK_SCHEMA,
  buildFeedbackSystem,
  buildFeedbackUser,
} from "@/lib/skill/phase5";

type Body = {
  provider: ProviderConfig;
  language: Language;
  concept?: Partial<ConceptStructure>;
  image: { prompt: string; params: ConceptParams };
  feedback: string;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.provider || !body.language || !body.image || !body.feedback) {
    return NextResponse.json(
      { error: "provider, language, image, feedback 필드가 필요합니다." },
      { status: 400 },
    );
  }
  if (!body.feedback.trim()) {
    return NextResponse.json(
      { error: "피드백 내용을 입력해 주세요." },
      { status: 400 },
    );
  }

  const system = buildFeedbackSystem(body.language);
  const user = buildFeedbackUser(
    body.language,
    body.concept,
    body.image,
    body.feedback,
  );

  try {
    const res = await complete(body.provider, {
      system,
      messages: [{ role: "user", content: user }],
      jsonSchema: PHASE5_FEEDBACK_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.5,
      maxTokens: 2048,
    });
    if (!res.parsedJson) {
      return NextResponse.json(
        { error: "LLM 응답에서 JSON 을 추출하지 못했습니다.", raw: res.text },
        { status: 502 },
      );
    }
    const parsed = res.parsedJson as {
      materiality?: unknown;
      sceneAnchors?: unknown;
      rationale?: unknown;
    };
    const sceneAnchors = Array.isArray(parsed.sceneAnchors)
      ? parsed.sceneAnchors.map((a) => String(a).trim()).filter(Boolean)
      : [];
    const materiality =
      typeof parsed.materiality === "string" ? parsed.materiality.trim() : "";
    const rationale =
      typeof parsed.rationale === "string" ? parsed.rationale.trim() : "";

    if (!materiality && sceneAnchors.length === 0) {
      return NextResponse.json(
        { error: "LLM 이 유효한 보정 제안을 반환하지 않았습니다.", raw: res.text },
        { status: 502 },
      );
    }
    return NextResponse.json({
      proposal: { materiality, sceneAnchors, rationale },
    });
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
