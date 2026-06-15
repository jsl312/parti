import { NextRequest, NextResponse } from "next/server";
import { ProviderConfig } from "@/lib/types/settings";
import { Language, ProjectInputs } from "@/lib/types/project";
import { LlmError } from "@/lib/types/llm";
import { complete } from "@/lib/llm/router";
import {
  AREAS,
  PHASE1_AREA_SCHEMA,
  PHASE1_BULK_SCHEMA,
  buildPhase1AreaSystem,
  buildPhase1AreaUser,
  buildPhase1BulkSystem,
  buildPhase1BulkUser,
  buildUploadScaffold,
  visibleTitle,
} from "@/lib/skill/phase1";

type Body = {
  provider: ProviderConfig;
  inputs: ProjectInputs;
  language: Language;
};

type PromptOut = { area: string; title: string; body: string };

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
        ? await runPerArea(body.provider, body.inputs, body.language)
        : await runBulk(body.provider, body.inputs, body.language);

    return NextResponse.json({
      result: {
        language: body.language,
        prompts,
        uploadScaffold: buildUploadScaffold(body.language),
      },
    });
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

class RouteError extends Error {
  constructor(
    message: string,
    public status: number,
    public raw?: string,
  ) {
    super(message);
  }
}

// Single-call path for Anthropic / Gemini.
async function runBulk(
  provider: ProviderConfig,
  inputs: ProjectInputs,
  language: Language,
): Promise<PromptOut[]> {
  const res = await complete(provider, {
    system: buildPhase1BulkSystem(),
    messages: [{ role: "user", content: buildPhase1BulkUser(inputs, language) }],
    jsonSchema: PHASE1_BULK_SCHEMA as unknown as Record<string, unknown>,
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
      | Record<string, { title?: string; body?: string }>
      | Array<{ area?: string; title?: string; body?: string }>;
  };
  const out: PromptOut[] = [];
  if (Array.isArray(result.prompts)) {
    const byArea = new Map(result.prompts.map((p) => [p.area ?? "", p]));
    for (const a of AREAS) {
      const src = byArea.get(a.code);
      out.push({
        area: a.code,
        title: visibleTitle(a.code, language), // forced canonical title
        body: src?.body?.trim() ?? "",
      });
    }
  } else if (result.prompts && typeof result.prompts === "object") {
    for (const a of AREAS) {
      const src = result.prompts[a.code];
      out.push({
        area: a.code,
        title: visibleTitle(a.code, language),
        body: src?.body?.trim() ?? "",
      });
    }
  } else {
    throw new RouteError(
      "LLM 응답에 prompts 필드가 없습니다.",
      502,
      res.text,
    );
  }
  const empty = out.filter((p) => !p.body).map((p) => p.area);
  if (empty.length) {
    throw new RouteError(
      `LLM 이 일부 영역의 본문을 비워 두었습니다: [${empty.join(", ")}]. 다시 시도하거나 다른 모델로 전환해 주세요.`,
      502,
      res.text,
    );
  }
  return out;
}

// Per-area sequential path for Ollama. Small/local models are unreliable when
// asked to produce all 5 prompts in one shot.
async function runPerArea(
  provider: ProviderConfig,
  inputs: ProjectInputs,
  language: Language,
): Promise<PromptOut[]> {
  const system = buildPhase1AreaSystem();
  const out: PromptOut[] = [];
  for (const area of AREAS) {
    const res = await complete(provider, {
      system,
      messages: [
        { role: "user", content: buildPhase1AreaUser(inputs, language, area) },
      ],
      jsonSchema: PHASE1_AREA_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.4,
      maxTokens: 4096,
    });
    if (!res.parsedJson) {
      throw new RouteError(
        `LLM 응답에서 JSON 을 추출하지 못했습니다 (영역: ${area.code}).`,
        502,
        res.text,
      );
    }
    const parsed = res.parsedJson as { body?: string };
    const promptBody = parsed.body?.trim() ?? "";
    if (!promptBody) {
      throw new RouteError(
        `LLM 이 ${area.code} 영역의 본문을 생성하지 못했습니다. 다시 시도하거나 다른 모델로 전환해 주세요.`,
        502,
        res.text,
      );
    }
    out.push({
      area: area.code,
      title: visibleTitle(area.code, language), // forced canonical title
      body: promptBody,
    });
  }
  return out;
}
