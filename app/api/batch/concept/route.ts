import { NextRequest, NextResponse } from "next/server";
import { ProviderConfig } from "@/lib/types/settings";
import {
  ConceptStructure,
  Language,
  Pattern,
  ProjectInputs,
  SpatialStrategy,
} from "@/lib/types/project";
import { LlmError } from "@/lib/types/llm";
import { complete } from "@/lib/llm/router";
import {
  PHASE4_STEP_SCHEMA,
  Phase4StepKind,
  buildPhase4StepSystem,
  buildPhase4StepUser,
  splitCandidateList,
} from "@/lib/skill/phase4";
import { extractJson } from "@/lib/llm/jsonExtract";

/**
 * Sampling overrides for local models prone to degenerate repetition loops.
 * Mirostat (mode 2) actively holds output perplexity near `tau`, which breaks
 * the runaway loops that leave JSON strings unterminated. We also relax the
 * aggressive default repeat_penalty (1.2 → 1.1) since a too-strong penalty can
 * push the model OFF the closing tokens it needs.
 */
const STEADY_SAMPLING: Record<string, unknown> = {
  mirostat: 2,
  mirostat_tau: 4.0,
  mirostat_eta: 0.1,
  repeat_penalty: 1.1,
  repeat_last_n: 64,
};

/**
 * Generate ONE complete design concept by running the proven STEPWISE Phase 4
 * pipeline server-side (parti → keywords → strategy×patterns → materiality →
 * sceneAnchors). Each step asks for a small `{ candidates: string[] }` JSON —
 * robust for local models, which degenerate when asked for a big nested concept
 * JSON in a single call. A random candidate is picked per step for variety
 * across the batch; `avoidPartis` steers the parti away from earlier ones.
 */

type Body = {
  provider: ProviderConfig;
  inputs: ProjectInputs;
  language: Language;
  patterns: Pattern[];
  finalPS: string;
  avoidPartis?: string[];
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.provider || !body.inputs || !body.language || !body.finalPS) {
    return NextResponse.json(
      { error: "provider, inputs, language, finalPS 필드가 모두 필요합니다." },
      { status: 400 },
    );
  }

  const patterns = body.patterns ?? [];

  const okShape = (v: unknown): v is { candidates: string[] } =>
    !!v &&
    typeof v === "object" &&
    Array.isArray((v as { candidates?: unknown }).candidates) &&
    (v as { candidates: unknown[] }).candidates.length > 0;

  /**
   * Detect a degenerate candidate — local models sometimes loop on a phrase
   * inside a JSON string ("network-Man-made-baseds on structure, ..." ×N).
   * Such candidates are unusably long and/or have very low word diversity.
   */
  const isDegenerate = (s: string): boolean => {
    if (s.length > 800) return true;
    if (/(\b[\w가-힣]+\b)(\s+\1){4,}/i.test(s)) return true;
    const words = s.split(/\s+/).filter(Boolean);
    if (words.length >= 10) {
      const uniq = new Set(words.map((w) => w.toLowerCase())).size;
      if (uniq / words.length < 0.4) return true;
    }
    return false;
  };

  /** Parse candidates from either JSON ({candidates:[...]}) or plain lines. */
  const parseCandidates = (text: string): string[] => {
    try {
      const j = extractJson(text);
      if (okShape(j)) {
        return j.candidates.map((c) => String(c).trim()).filter(Boolean);
      }
    } catch {
      // not JSON — fall through to line parsing
    }
    return text
      .split(/\r?\n/)
      .map((l) =>
        l
          .replace(/^[\s\-*•\d.)\]]+/, "")
          .replace(/^["'`]|["'`]$/g, "")
          .trim(),
      )
      .filter(Boolean);
  };

  async function step(
    stepKind: Phase4StepKind,
    prior: Partial<ConceptStructure>,
    patternId?: string,
    extra?: string,
  ): Promise<string[]> {
    const pattern =
      stepKind === "strategy" && patternId
        ? patterns.find((p) => p.id === patternId)
        : undefined;
    const system = buildPhase4StepSystem(stepKind);
    let user = buildPhase4StepUser(stepKind, {
      inputs: body.inputs,
      language: body.language,
      patterns,
      finalPS: body.finalPS,
      prior,
      pattern,
      count: 3,
    });
    if (extra) user = `${user}\n\n${extra}`;

    // Phase A — constrained JSON (format:"json") with mirostat sampling.
    const corrective = `IMPORTANT — return ONLY { "candidates": ["...", "...", "..."] } with 3 SHORT string items (one or two sentences each). No other keys, no prose, do not repeat words.`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await complete(body.provider, {
          system,
          messages: [
            {
              role: "user",
              content: attempt > 0 ? `${user}\n\n${corrective}` : user,
            },
          ],
          jsonSchema: PHASE4_STEP_SCHEMA as unknown as Record<string, unknown>,
          temperature: 0.6,
          maxTokens: 1024,
          options: STEADY_SAMPLING,
        });
        const cands = parseCandidates(res.text).filter((c) => !isDegenerate(c));
        if (cands.length) return cands;
      } catch (e) {
        if (e instanceof LlmError && e.kind === "auth") throw e;
        // json_parse / degeneration / transient → retry with a fresh sample.
      }
    }

    // Phase B — UNCONSTRAINED plain text (no format:"json"). Removing the JSON
    // grammar lets the model actually TERMINATE; we parse newline-separated
    // candidates (and still accept JSON if it emits some).
    const ptUser = `${user}

OUTPUT FORMAT OVERRIDE: Ignore any earlier instruction to output JSON. Output EXACTLY 3 candidates, each on its OWN line. Plain text only — no numbering, no bullet symbols, no quotes, no JSON, no extra commentary.`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await complete(body.provider, {
          system,
          messages: [{ role: "user", content: ptUser }],
          // No jsonSchema → adapter does NOT send format:"json".
          temperature: 0.6,
          maxTokens: 1024,
          options: STEADY_SAMPLING,
        });
        const cands = parseCandidates(res.text).filter((c) => !isDegenerate(c));
        if (cands.length) return cands;
      } catch (e) {
        if (e instanceof LlmError && e.kind === "auth") throw e;
      }
    }
    return [];
  }

  const pick = (cands: string[]): string =>
    cands.length ? cands[Math.floor(Math.random() * cands.length)] : "";

  try {
    const prior: Partial<ConceptStructure> = {
      spatialStrategies: patterns.map((p) => ({
        patternId: p.id,
        patternTitle: p.title,
        strategy: "",
      })),
    };

    // 1) parti (essential)
    const avoid = (body.avoidPartis ?? []).filter(Boolean);
    const avoidExtra = avoid.length
      ? `Avoid repeating or closely paraphrasing these earlier partis — make this one a genuinely different design attitude:\n${avoid
          .map((p, i) => `${i + 1}. ${p}`)
          .join("\n")}`
      : undefined;
    const parti = pick(await step("parti", {}, undefined, avoidExtra));
    if (!parti) {
      return NextResponse.json(
        {
          error:
            "파르티 생성에 실패했습니다 — 로컬 모델이 반복 루프(degeneration)에 빠져 유효한 후보를 내지 못했습니다. mirostat·plain-text 폴백까지 시도했으나 회복하지 못했습니다. 다시 시도하거나, 더 큰/안정적인 모델(예: qwen2.5:32b)로 바꿔 주세요.",
        },
        { status: 502 },
      );
    }
    prior.parti = parti;

    // 2) keywords (best-effort)
    prior.keywords = splitCandidateList(pick(await step("keywords", prior)));

    // 3) one strategy per pattern (best-effort)
    const strategies: SpatialStrategy[] = [];
    for (const p of patterns) {
      const strat = pick(await step("strategy", prior, p.id));
      strategies.push({ patternId: p.id, patternTitle: p.title, strategy: strat });
      prior.spatialStrategies = strategies;
    }

    // 4) materiality (best-effort)
    prior.materiality = pick(await step("materiality", prior));

    // 5) scene anchors (best-effort)
    const sceneAnchors = splitCandidateList(
      pick(await step("sceneAnchors", prior)),
    );

    const concept: ConceptStructure = {
      parti,
      keywords: prior.keywords ?? [],
      spatialStrategies: strategies,
      materiality: prior.materiality ?? "",
      sceneAnchors,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json({ concept });
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

export const runtime = "nodejs";
export const maxDuration = 600;
