import { NextRequest, NextResponse } from "next/server";
import { ProviderConfig } from "@/lib/types/settings";
import { Language, ProjectInputs } from "@/lib/types/project";
import { LlmError } from "@/lib/types/llm";
import { complete } from "@/lib/llm/router";
import {
  ConceptContext,
  PRECEDENT_ANGLES,
  PRECEDENT_ANGLE_SCHEMA,
  PRECEDENT_BULK_SCHEMA,
  buildPrecedentAngleSystem,
  buildPrecedentAngleUser,
  buildPrecedentBulkSystem,
  buildPrecedentBulkUser,
  precedentTitle,
} from "@/lib/skill/precedents";

type Body = {
  provider: ProviderConfig;
  inputs: ProjectInputs;
  language: Language;
  finalPS?: string;
  concept?: ConceptContext;
};

type PromptOut = { angle: string; title: string; body: string };

class RouteError extends Error {
  constructor(
    message: string,
    public status: number,
    public raw?: string,
  ) {
    super(message);
  }
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.provider || !body.inputs || !body.language) {
    return NextResponse.json(
      { error: "provider, inputs, language 필드가 필요합니다." },
      { status: 400 },
    );
  }
  if (!body.inputs.site || !body.inputs.typology) {
    return NextResponse.json(
      { error: "site 와 typology 는 필수입니다." },
      { status: 400 },
    );
  }

  try {
    const prompts =
      body.provider.provider === "ollama"
        ? await runPerAngle(body)
        : await runBulk(body);
    return NextResponse.json({ result: { prompts } });
  } catch (e) {
    if (e instanceof RouteError) {
      return NextResponse.json(
        { error: e.message, raw: e.raw },
        { status: e.status },
      );
    }
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

// Single-call path for Anthropic / Gemini.
async function runBulk(body: Body): Promise<PromptOut[]> {
  const res = await complete(body.provider, {
    system: buildPrecedentBulkSystem(body.language),
    messages: [
      {
        role: "user",
        content: buildPrecedentBulkUser(
          body.inputs,
          body.language,
          body.finalPS,
          body.concept,
        ),
      },
    ],
    jsonSchema: PRECEDENT_BULK_SCHEMA as unknown as Record<string, unknown>,
    temperature: 0.4,
    maxTokens: 16384,
  });
  if (!res.parsedJson) {
    throw new RouteError(
      "LLM 응답에서 JSON 을 추출하지 못했습니다.",
      502,
      res.text,
    );
  }
  const result = res.parsedJson as {
    prompts?:
      | Record<string, { body?: string }>
      | Array<{ angle?: string; body?: string }>;
  };
  const byAngle = new Map<string, { body?: string }>();
  if (Array.isArray(result.prompts)) {
    for (const p of result.prompts) byAngle.set(p.angle ?? "", p);
  } else if (result.prompts && typeof result.prompts === "object") {
    for (const [k, v] of Object.entries(result.prompts)) byAngle.set(k, v);
  } else {
    throw new RouteError("LLM 응답에 prompts 필드가 없습니다.", 502, res.text);
  }

  const out: PromptOut[] = PRECEDENT_ANGLES.map((a) => ({
    angle: a.code,
    title: precedentTitle(a.code, body.language),
    body: byAngle.get(a.code)?.body?.trim() ?? "",
  }));
  const empty = out.filter((p) => !p.body).map((p) => p.angle);
  if (empty.length) {
    throw new RouteError(
      `LLM 이 일부 각도의 본문을 비워 두었습니다: [${empty.join(", ")}]. 다시 시도하거나 다른 모델로 전환해 주세요.`,
      502,
      res.text,
    );
  }
  return out;
}

// Per-angle sequential path for Ollama.
async function runPerAngle(body: Body): Promise<PromptOut[]> {
  const system = buildPrecedentAngleSystem(body.language);
  const out: PromptOut[] = [];
  for (const angle of PRECEDENT_ANGLES) {
    const res = await complete(body.provider, {
      system,
      messages: [
        {
          role: "user",
          content: buildPrecedentAngleUser(
            body.inputs,
            body.language,
            body.finalPS,
            body.concept,
            angle,
          ),
        },
      ],
      jsonSchema: PRECEDENT_ANGLE_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.4,
      maxTokens: 4096,
    });
    if (!res.parsedJson) {
      throw new RouteError(
        `LLM 응답에서 JSON 을 추출하지 못했습니다 (각도: ${angle.code}).`,
        502,
        res.text,
      );
    }
    const promptBody = (res.parsedJson as { body?: string }).body?.trim() ?? "";
    if (!promptBody) {
      throw new RouteError(
        `LLM 이 ${angle.code} 각도의 본문을 생성하지 못했습니다. 다시 시도하거나 다른 모델로 전환해 주세요.`,
        502,
        res.text,
      );
    }
    out.push({
      angle: angle.code,
      title: precedentTitle(angle.code, body.language),
      body: promptBody,
    });
  }
  return out;
}
