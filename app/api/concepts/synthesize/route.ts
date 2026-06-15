import { NextRequest, NextResponse } from "next/server";
import { ProviderConfig } from "@/lib/types/settings";
import {
  ConceptStructure,
  Language,
  PatternId,
  SpatialStrategy,
} from "@/lib/types/project";
import { LlmError } from "@/lib/types/llm";
import { complete } from "@/lib/llm/router";
import { extractJson } from "@/lib/llm/jsonExtract";

/**
 * AI-compare TWO concepts and SYNTHESIZE a new one.
 *
 * Two calls:
 *  1) comparison — plain-text analysis (강점 · 차이 · 긴장 · 종합 방향).
 *  2) synthesis  — a brand-new ConceptStructure that fuses the strongest ideas
 *     from both while resolving their tensions, still answering the Problem
 *     Statement. Uses the SAME spatial-pattern set as the inputs so the result
 *     drops straight into the concept library / Phase 4·5.
 *
 * The synthesis uses a single structured JSON call (the task is well-grounded
 * by the two source concepts, so it's far less prone to the open-ended
 * degeneration we see in from-scratch generation). Mirostat sampling + a couple
 * of corrective retries keep local models honest; if it still fails we return
 * the comparison alone with a warning.
 */

const STEADY_SAMPLING: Record<string, unknown> = {
  mirostat: 2,
  mirostat_tau: 4.0,
  mirostat_eta: 0.1,
  repeat_penalty: 1.1,
  repeat_last_n: 64,
};

const CONCEPT_SCHEMA = {
  type: "object",
  properties: {
    parti: { type: "string" },
    keywords: { type: "array", items: { type: "string" } },
    spatialStrategies: {
      type: "array",
      items: {
        type: "object",
        properties: {
          patternId: { type: "string" },
          patternTitle: { type: "string" },
          strategy: { type: "string" },
        },
        required: ["patternId", "patternTitle", "strategy"],
      },
    },
    materiality: { type: "string" },
    sceneAnchors: { type: "array", items: { type: "string" } },
  },
  required: [
    "parti",
    "keywords",
    "spatialStrategies",
    "materiality",
    "sceneAnchors",
  ],
} as const;

type Body = {
  provider: ProviderConfig;
  language: Language;
  finalPS?: string;
  conceptA: ConceptStructure;
  conceptB: ConceptStructure;
  labelA?: string;
  labelB?: string;
};

function renderConcept(c: ConceptStructure): string {
  const strat = (c.spatialStrategies ?? [])
    .filter((s) => s.strategy?.trim())
    .map((s) => `  - [${s.patternTitle}] ${s.strategy}`)
    .join("\n");
  return [
    `파르티: ${c.parti || "(없음)"}`,
    `키워드: ${(c.keywords ?? []).join(", ") || "(없음)"}`,
    `공간 전략:\n${strat || "  (없음)"}`,
    `재료·분위기: ${c.materiality || "(없음)"}`,
    `장면 단서: ${(c.sceneAnchors ?? []).join(", ") || "(없음)"}`,
  ].join("\n");
}

/** Union of the two concepts' pattern sets, keyed by patternId. */
function patternSet(
  a: ConceptStructure,
  b: ConceptStructure,
): { id: PatternId; title: string }[] {
  const map = new Map<PatternId, string>();
  for (const s of [...(a.spatialStrategies ?? []), ...(b.spatialStrategies ?? [])]) {
    if (s.patternId && !map.has(s.patternId)) map.set(s.patternId, s.patternTitle);
  }
  return [...map.entries()].map(([id, title]) => ({ id, title }));
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.provider || !body.conceptA || !body.conceptB) {
    return NextResponse.json(
      { error: "provider, conceptA, conceptB 필드가 필요합니다." },
      { status: 400 },
    );
  }

  const lang = body.language === "en" ? "English" : "Korean";
  const labelA = body.labelA || "컨셉 A";
  const labelB = body.labelB || "컨셉 B";
  const psLine = body.finalPS
    ? `\n\nProblem Statement (두 컨셉이 답해야 하는 설계 과제):\n"${body.finalPS}"`
    : "";
  const blockA = `### ${labelA}\n${renderConcept(body.conceptA)}`;
  const blockB = `### ${labelB}\n${renderConcept(body.conceptB)}`;

  try {
    // ── 1) Comparison analysis (plain text) ──────────────────────────────
    const cmpSystem = `You are an architectural design critic. Compare TWO design concepts for the same project, writing IN ${lang}. Be concrete and concise (about 200–280 words). Structure your answer with these headers:
- 강점 — what each concept does best (1–2 lines each)
- 핵심 차이 — the main way they differ in design attitude
- 긴장/트레이드오프 — where they conflict or what each sacrifices
- 종합 방향 — how a stronger third concept could fuse the best of both and resolve the tension
Do not invent facts; reason only from the given concepts.`;
    const cmpUser = `${blockA}\n\n${blockB}${psLine}`;
    const cmpRes = await complete(body.provider, {
      system: cmpSystem,
      messages: [{ role: "user", content: cmpUser }],
      temperature: 0.5,
      maxTokens: 1200,
    });
    const comparison = (cmpRes.text ?? "").trim();

    // ── 2) Synthesis (structured concept) ────────────────────────────────
    const pats = patternSet(body.conceptA, body.conceptB);
    const patLines = pats.length
      ? pats.map((p) => `  - patternId="${p.id}" · ${p.title}`).join("\n")
      : "  (없음)";
    const synSystem = `You are an architectural concept designer. Create ONE brand-new design concept that creatively SYNTHESIZES the two given concepts: take the strongest idea from each, resolve their tension into a single coherent design attitude, and make sure it still answers the Problem Statement. It must be a genuinely NEW concept — not a copy of either, not a shallow concatenation. Write all content IN ${lang}.

Return ONLY JSON matching this shape:
{ "parti": string (1–2 sentence design thesis), "keywords": string[] (3–6 short items), "spatialStrategies": [{ "patternId": string, "patternTitle": string, "strategy": string }], "materiality": string (재료·빛·질감·분위기), "sceneAnchors": string[] (이미지로 보여줄 구체 장면 3–6개) }

For spatialStrategies, produce EXACTLY one entry per pattern below, reusing these exact patternId / patternTitle values:
${patLines}`;
    const synUser = `종합할 두 컨셉:\n\n${blockA}\n\n${blockB}${psLine}`;
    const corrective = `\n\nIMPORTANT — return ONLY the JSON object described, with all required keys. No prose, no markdown fences, do not repeat words in loops.`;

    let synthesized: ConceptStructure | null = null;
    for (let attempt = 0; attempt < 3 && !synthesized; attempt++) {
      try {
        const res = await complete(body.provider, {
          system: synSystem,
          messages: [
            {
              role: "user",
              content: attempt > 0 ? synUser + corrective : synUser,
            },
          ],
          jsonSchema: CONCEPT_SCHEMA as unknown as Record<string, unknown>,
          temperature: 0.7,
          maxTokens: 1600,
          options: STEADY_SAMPLING,
        });
        const j = extractJson(res.text) as Partial<ConceptStructure> | null;
        if (j && typeof j.parti === "string" && j.parti.trim()) {
          // Normalize spatialStrategies to the canonical pattern set.
          const byId = new Map<string, string>();
          for (const s of (j.spatialStrategies ?? []) as SpatialStrategy[]) {
            if (s?.patternId) byId.set(s.patternId, s.strategy ?? "");
          }
          const strategies: SpatialStrategy[] = pats.map((p) => ({
            patternId: p.id,
            patternTitle: p.title,
            strategy: (byId.get(p.id) ?? "").trim(),
          }));
          synthesized = {
            parti: j.parti.trim(),
            keywords: Array.isArray(j.keywords)
              ? j.keywords.map((k) => String(k).trim()).filter(Boolean)
              : [],
            spatialStrategies: strategies,
            materiality:
              typeof j.materiality === "string" ? j.materiality.trim() : "",
            sceneAnchors: Array.isArray(j.sceneAnchors)
              ? j.sceneAnchors.map((k) => String(k).trim()).filter(Boolean)
              : [],
            generatedAt: new Date().toISOString(),
          };
        }
      } catch (e) {
        if (e instanceof LlmError && e.kind === "auth") throw e;
        // json_parse / transient → retry
      }
    }

    if (!synthesized) {
      return NextResponse.json({
        comparison,
        concept: null,
        warning:
          "비교 분석은 완료했지만 새 컨셉 합성에 실패했습니다 (모델이 유효한 구조를 내지 못함). 다시 시도하거나 더 안정적인 모델로 바꿔 주세요.",
      });
    }

    return NextResponse.json({ comparison, concept: synthesized });
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

export const runtime = "nodejs";
export const maxDuration = 600;
