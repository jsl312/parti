import { NextRequest, NextResponse } from "next/server";
import { ProviderConfig } from "@/lib/types/settings";
import {
  ConceptParams,
  ConceptStructure,
  Language,
  Pattern,
  ProjectInputs,
} from "@/lib/types/project";
import { LlmError } from "@/lib/types/llm";
import { complete } from "@/lib/llm/router";
import {
  ImageModelHint,
  PHASE5_PROMPT_SCHEMA,
  buildPhase5PromptSystem,
  buildPhase5PromptUser,
} from "@/lib/skill/phase5";

type Body = {
  provider: ProviderConfig;
  inputs: ProjectInputs;
  language: Language;
  patterns: Pattern[];
  finalPS: string;
  params: ConceptParams;
  concept?: ConceptStructure;
  /** Which image model the prompt targets — picks the photoreal guidance. */
  imageModel?: ImageModelHint;
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
    !body.params ||
    !body.finalPS
  ) {
    return NextResponse.json(
      {
        error:
          "provider, inputs, language, params, finalPS 필드가 모두 필요합니다.",
      },
      { status: 400 },
    );
  }

  const system = buildPhase5PromptSystem(body.imageModel);
  const user = buildPhase5PromptUser(
    body.inputs,
    body.language,
    body.patterns ?? [],
    body.finalPS,
    body.params,
    body.concept,
  );

  try {
    const res = await complete(body.provider, {
      system,
      messages: [{ role: "user", content: user }],
      jsonSchema: PHASE5_PROMPT_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.7,
      maxTokens: 2048,
    });
    if (!res.parsedJson) {
      return NextResponse.json(
        {
          error: "LLM 응답에서 JSON 을 추출하지 못했습니다.",
          raw: res.text,
        },
        { status: 502 },
      );
    }
    const parsed = res.parsedJson as { prompt?: string };
    const prompt = (parsed.prompt ?? "").trim();
    if (!prompt) {
      return NextResponse.json(
        {
          error: "LLM 이 빈 프롬프트를 반환했습니다.",
          raw: res.text,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ prompt });
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
