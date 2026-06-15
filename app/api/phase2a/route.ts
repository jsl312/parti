import { NextRequest, NextResponse } from "next/server";
import { ProviderConfig } from "@/lib/types/settings";
import { Language, ProjectInputs } from "@/lib/types/project";
import { LlmError } from "@/lib/types/llm";
import { complete } from "@/lib/llm/router";
import { AREAS } from "@/lib/skill/phase1";
import {
  PHASE2A_AREA_SCHEMA,
  PHASE2A_JSON_SCHEMA,
  buildPhase2AAreaSystem,
  buildPhase2AAreaUser,
  buildPhase2ASystem,
  buildPhase2AUser,
  extractAreaSection,
  extractSupplementSection,
  getAreaTitle,
} from "@/lib/skill/phase2a";

type Body = {
  provider: ProviderConfig;
  inputs: ProjectInputs;
  language: Language;
  uploadedResearch: string;
};

type RiskItem = { finding: string; reason: string; verifyAt: string };
type GapItem = { area: string; description: string };
type TagRow = {
  area: string;
  primary: number;
  secondary: number;
  unverified: number;
  note?: string;
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
    !body.uploadedResearch
  ) {
    return NextResponse.json(
      {
        error:
          "provider, inputs, language, uploadedResearch 필드가 모두 필요합니다.",
      },
      { status: 400 },
    );
  }
  if (body.uploadedResearch.trim().length < 50) {
    return NextResponse.json(
      { error: "업로드된 리서치 내용이 너무 짧습니다." },
      { status: 400 },
    );
  }

  try {
    const result =
      body.provider.provider === "ollama"
        ? await runPerArea(body.provider, body.inputs, body.language, body.uploadedResearch)
        : await runBulk(body.provider, body.inputs, body.language, body.uploadedResearch);
    return NextResponse.json({ result });
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

const isObjectArray = (v: unknown): v is Record<string, unknown>[] =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.every((x) => typeof x === "object" && x !== null && !Array.isArray(x));

// ─── Bulk path: Anthropic / Gemini ─────────────────────────────────────────
async function runBulk(
  provider: ProviderConfig,
  inputs: ProjectInputs,
  language: Language,
  uploadedResearch: string,
): Promise<{ tagPreview: TagRow[]; headlineRisks: RiskItem[]; contentGaps: GapItem[] }> {
  const system = buildPhase2ASystem();
  const user = buildPhase2AUser(inputs, language, uploadedResearch);

  async function callOnce(extraUser?: string) {
    return complete(provider, {
      system,
      messages: [
        { role: "user", content: extraUser ? `${user}\n\n${extraUser}` : user },
      ],
      jsonSchema: PHASE2A_JSON_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.2,
      maxTokens: 16384,
    });
  }

  let res = await callOnce();
  if (!res.parsedJson) {
    throw new RouteError("LLM 응답에서 JSON 을 추출하지 못했습니다.", 502, res.text);
  }
  let result = res.parsedJson as Record<string, unknown>;
  const shapeOk = (r: Record<string, unknown>) =>
    isObjectArray(r.tagPreview) &&
    isObjectArray(r.headlineRisks) &&
    isObjectArray(r.contentGaps);
  if (!shapeOk(result)) {
    const corrective = `IMPORTANT — your previous response did NOT follow the schema. Each of tagPreview/headlineRisks/contentGaps MUST be an array of OBJECTS, not strings. Regenerate with correct shapes.`;
    res = await callOnce(corrective);
    if (res.parsedJson) result = res.parsedJson as Record<string, unknown>;
  }
  if (!shapeOk(result)) {
    throw new RouteError(
      "LLM 응답이 예상한 객체 배열 형태가 아닙니다.",
      502,
      JSON.stringify(result).slice(0, 1000),
    );
  }
  return {
    tagPreview: result.tagPreview as TagRow[],
    headlineRisks: result.headlineRisks as RiskItem[],
    contentGaps: result.contentGaps as GapItem[],
  };
}

// ─── Per-area path: Ollama ─────────────────────────────────────────────────
async function runPerArea(
  provider: ProviderConfig,
  inputs: ProjectInputs,
  language: Language,
  uploadedResearch: string,
): Promise<{ tagPreview: TagRow[]; headlineRisks: RiskItem[]; contentGaps: GapItem[] }> {
  const system = buildPhase2AAreaSystem();
  const supplement = extractSupplementSection(uploadedResearch);

  type AreaScan = {
    area: string;
    primary: number;
    secondary: number;
    unverified: number;
    note: string;
    risks: RiskItem[];
    gaps: GapItem[];
  };

  const scans: AreaScan[] = [];

  for (const a of AREAS) {
    const areaTitle = getAreaTitle(a.code, language);
    const areaContent = extractAreaSection(uploadedResearch, areaTitle);
    const user = buildPhase2AAreaUser(
      inputs,
      language,
      a.code,
      areaTitle,
      areaContent || (language === "ko" ? "답변 없음" : "No answer"),
      supplement,
    );
    const res = await complete(provider, {
      system,
      messages: [{ role: "user", content: user }],
      jsonSchema: PHASE2A_AREA_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.2,
      maxTokens: 4096,
    });
    if (!res.parsedJson) {
      throw new RouteError(
        `LLM 응답에서 JSON 을 추출하지 못했습니다 (영역: ${a.code}).`,
        502,
        res.text,
      );
    }
    const parsed = res.parsedJson as {
      primary?: number;
      secondary?: number;
      unverified?: number;
      note?: string;
      risks?: Array<{ finding?: string; reason?: string; verifyAt?: string }>;
      gaps?: Array<{ description?: string }>;
    };

    const risks: RiskItem[] = Array.isArray(parsed.risks)
      ? parsed.risks
          .filter((r) => r && r.finding && r.reason && r.verifyAt)
          .map((r) => ({
            finding: r.finding!,
            reason: r.reason!,
            verifyAt: r.verifyAt!,
          }))
      : [];
    const gaps: GapItem[] = Array.isArray(parsed.gaps)
      ? parsed.gaps
          .filter((g) => g && g.description)
          .map((g) => ({ area: a.code, description: g.description! }))
      : [];

    scans.push({
      area: a.code,
      primary: Math.max(0, Math.floor(parsed.primary ?? 0)),
      secondary: Math.max(0, Math.floor(parsed.secondary ?? 0)),
      unverified: Math.max(0, Math.floor(parsed.unverified ?? 0)),
      note: parsed.note ?? "",
      risks,
      gaps,
    });
  }

  // Aggregate. Sort areas to canonical order (already iterated in order).
  const tagPreview: TagRow[] = scans.map((s) => ({
    area: s.area,
    primary: s.primary,
    secondary: s.secondary,
    unverified: s.unverified,
    note: s.note,
  }));

  // Rank candidates: areas with more uncertainty (secondary + unverified) first.
  const rank = new Map(
    scans.map((s) => [s.area, s.secondary + s.unverified] as const),
  );
  const allRisks: RiskItem[] = scans.flatMap((s) =>
    s.risks.map((r) => ({ ...r, _rank: rank.get(s.area) ?? 0 })),
  );
  const allGaps: GapItem[] = scans.flatMap((s) =>
    s.gaps.map((g) => ({ ...g, _rank: rank.get(s.area) ?? 0 })),
  );

  type Ranked<T> = T & { _rank?: number };
  const sortByRank = <T>(arr: Ranked<T>[]): T[] =>
    arr
      .sort((a, b) => (b._rank ?? 0) - (a._rank ?? 0))
      .map(({ _rank: _, ...rest }) => rest as T);

  const headlineRisks = sortByRank(allRisks as Ranked<RiskItem>[]).slice(0, 3);
  const contentGaps = sortByRank(allGaps as Ranked<GapItem>[]).slice(0, 3);

  return { tagPreview, headlineRisks, contentGaps };
}
