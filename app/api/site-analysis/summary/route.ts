import { NextRequest, NextResponse } from "next/server";
import { ProviderConfig } from "@/lib/types/settings";
import { Language, ProjectInputs, SiteAnalysisMetrics } from "@/lib/types/project";
import { LlmError } from "@/lib/types/llm";
import { complete } from "@/lib/llm/router";

type Body = {
  provider: ProviderConfig;
  language: Language;
  inputs: ProjectInputs;
  finalPS?: string;
  metrics: SiteAnalysisMetrics;
  roads?: string[];
};

const SCHEMA = {
  type: "object",
  required: ["note"],
  properties: { note: { type: "string" } },
} as const;

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.provider || !body.metrics) {
    return NextResponse.json(
      { error: "provider, metrics 필드가 필요합니다." },
      { status: 400 },
    );
  }

  const lang = body.language === "en" ? "English" : "Korean";
  const m = body.metrics;
  const useMix = (m.useMix ?? [])
    .map((u) => `${u.label}:${u.count}`)
    .join(", ");
  const t = m.nearestTransit;

  const system = `You are an interior-architecture planner. Using surrounding POI / transit / land-use data, give concrete design guidance on TWO themes:
1) 접근성·진입 동선 — From the dominant arrival point (nearest transit) and its direction, recommend where to place the MAIN ENTRANCE, lobby / reception, and the brand-facing facade or show-window so the approach is efficient and visually legible.
2) 타겟 고객·프로그램 조닝 — From the surrounding use mix and commercial density, infer the likely user type and recommend interior program & zoning (e.g. office-dense → take-out-efficient bar/counter flow; residential-dense → long-stay seating zoning).
Be specific and actionable, tie advice to the given numbers/direction. Write in ${lang}. Output ONLY JSON: { "note": "..." } with 4–7 bullet lines, each starting with "• ". Group the two themes.`;

  const user = `Project:
- Site: ${body.inputs?.site ?? "(unknown)"}
- Typology: ${body.inputs?.typology ?? "(unknown)"}
${body.finalPS ? `- Problem Statement: "${body.finalPS}"` : ""}

Surrounding context:
- Dominant arrival (nearest transit): ${
    t ? `${t.title} (${t.label}), ${t.dist}m, 도보 ${t.walkMin}분, 방향 ${t.compass}(${t.bearingDeg}°)` : "(none in radius)"
  }
- Recommended main-entrance facing (toward arrival): ${m.entranceCompass ?? "?"}
- Surrounding context type: ${m.contextType ?? "?"}
- Land-use mix: ${useMix || "(n/a)"}
- Commercial POIs nearby: ${m.commercialCount ?? "?"}
- Adjacent roads: ${body.roads?.length ? body.roads.join(", ") : "(n/a)"}

Write the entrance/flow + target-customer/zoning guidance. Return JSON { "note": "..." }.`;

  try {
    const res = await complete(body.provider, {
      system,
      messages: [{ role: "user", content: user }],
      jsonSchema: SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.5,
      maxTokens: 1500,
    });
    const note =
      (res.parsedJson as { note?: string } | undefined)?.note?.trim() ?? "";
    if (!note) {
      return NextResponse.json(
        { error: "LLM 이 빈 코멘트를 반환했습니다.", raw: res.text },
        { status: 502 },
      );
    }
    return NextResponse.json({ note });
  } catch (e) {
    if (e instanceof LlmError) {
      return NextResponse.json(
        { error: e.message, kind: e.kind },
        { status: e.kind === "auth" ? 401 : 502 },
      );
    }
    return NextResponse.json(
      { error: (e as Error).message || "알 수 없는 오류" },
      { status: 500 },
    );
  }
}
