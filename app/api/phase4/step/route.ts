import { NextRequest, NextResponse } from "next/server";
import { ProviderConfig } from "@/lib/types/settings";
import {
  ConceptStructure,
  Language,
  Pattern,
  ProjectInputs,
} from "@/lib/types/project";
import { LlmError } from "@/lib/types/llm";
import { complete } from "@/lib/llm/router";
import {
  PHASE4_STEP_SCHEMA,
  Phase4StepKind,
  buildPhase4StepSystem,
  buildPhase4StepUser,
} from "@/lib/skill/phase4";

type Body = {
  provider: ProviderConfig;
  inputs: ProjectInputs;
  language: Language;
  patterns: Pattern[];
  finalPS: string;
  step: Phase4StepKind;
  prior: Partial<ConceptStructure>;
  patternId?: string;
  count?: number;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    !body.provider ||
    !body.inputs ||
    !body.language ||
    !body.finalPS ||
    !body.step
  ) {
    return NextResponse.json(
      {
        error:
          "provider, inputs, language, finalPS, step 필드가 모두 필요합니다.",
      },
      { status: 400 },
    );
  }

  const patterns = body.patterns ?? [];
  const pattern =
    body.step === "strategy" && body.patternId
      ? patterns.find((p) => p.id === body.patternId)
      : undefined;
  const count = Math.max(2, Math.min(5, body.count ?? 3));

  const system = buildPhase4StepSystem(body.step);
  const user = buildPhase4StepUser(body.step, {
    inputs: body.inputs,
    language: body.language,
    patterns,
    finalPS: body.finalPS,
    prior: body.prior ?? {},
    pattern,
    count,
  });

  async function callOnce(extraUser?: string) {
    return complete(body.provider, {
      system,
      messages: [
        { role: "user", content: extraUser ? `${user}\n\n${extraUser}` : user },
      ],
      jsonSchema: PHASE4_STEP_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.8,
      maxTokens: 3072,
    });
  }

  const ok = (v: unknown): v is { candidates: string[] } =>
    !!v &&
    typeof v === "object" &&
    Array.isArray((v as { candidates?: unknown }).candidates) &&
    (v as { candidates: unknown[] }).candidates.length > 0;

  try {
    let res = await callOnce();
    if (!res.parsedJson) {
      return NextResponse.json(
        { error: "LLM 응답에서 JSON 을 추출하지 못했습니다.", raw: res.text },
        { status: 502 },
      );
    }
    let parsed = res.parsedJson as unknown;
    if (!ok(parsed)) {
      const corrective = `IMPORTANT — return ONLY { "candidates": ["...", "...", "..."] } with ${count} string items. No other keys, no prose.`;
      res = await callOnce(corrective);
      if (res.parsedJson) parsed = res.parsedJson as unknown;
    }
    if (!ok(parsed)) {
      return NextResponse.json(
        {
          error:
            "LLM 응답이 예상한 형태가 아닙니다 (candidates 문자열 배열). 다시 시도하거나 다른 모델로 전환해 주세요.",
          raw: JSON.stringify(parsed).slice(0, 800),
        },
        { status: 502 },
      );
    }

    const candidates = parsed.candidates
      .map((c) => String(c).trim())
      .filter(Boolean)
      .slice(0, count);

    return NextResponse.json({ candidates });
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
