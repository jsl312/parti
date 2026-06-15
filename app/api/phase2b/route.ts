import { NextRequest, NextResponse } from "next/server";
import { ProviderConfig } from "@/lib/types/settings";
import { Language, ProjectInputs } from "@/lib/types/project";
import { LlmError } from "@/lib/types/llm";
import { complete } from "@/lib/llm/router";
import { AREAS } from "@/lib/skill/phase1";
import {
  PHASE2B_AREA_SCHEMA,
  PHASE2B_CANDIDATES_SCHEMA,
  PHASE2B_JSON_SCHEMA,
  PHASE2B_PATTERNS_SCHEMA,
  buildPhase2BAreaSystem,
  buildPhase2BAreaUser,
  buildPhase2BCandidatesSystem,
  buildPhase2BCandidatesUser,
  buildPhase2BPatternsSystem,
  buildPhase2BPatternsUser,
  buildPhase2BSystem,
  buildPhase2BUser,
  getAreaTitle,
} from "@/lib/skill/phase2b";
import {
  extractAreaSection,
  extractSupplementSection,
} from "@/lib/skill/phase2a";

type Body = {
  provider: ProviderConfig;
  inputs: ProjectInputs;
  language: Language;
  uploadedResearch: string;
};

type FindingOut = {
  id: string;
  area: string;
  headline: string;
  detail: string;
  confidence: string;
  sources: { name: string; url?: string }[];
  patternIds: string[];
};
type PatternOut = {
  id: string;
  label: string;
  title: string;
  rationale: string;
  findingIds: string[];
};
type CandidateOut = { text: string; rationale: string };

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
    // Anthropic + Gemini run bulk in a single call so findings ↔ patterns are
    // co-authored with coherent linkage. Only Ollama uses the per-step
    // pipeline (small local models are unreliable on the deep nested bulk
    // schema).
    const result =
      body.provider.provider === "ollama"
        ? await runPipeline(
            body.provider,
            body.inputs,
            body.language,
            body.uploadedResearch,
          )
        : await runBulk(
            body.provider,
            body.inputs,
            body.language,
            body.uploadedResearch,
          );
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

// ─── Bulk path: Anthropic / Gemini ─────────────────────────────────────────

const VALID_AREAS = [
  "site_context",
  "users_community",
  "precedent_studies",
  "socio_cultural",
  "typology_limits",
] as const;
type AreaCodeS = (typeof VALID_AREAS)[number];

/**
 * Map an LLM-emitted "area" string to the canonical code. Tolerates Korean /
 * English labels, surrounding punctuation, circled numerals, and whitespace —
 * the UI groups findings by exact code, so a mismatched label = invisible
 * finding. Returns null if nothing matches (caller drops the finding).
 */
function normalizeAreaCode(v: unknown): AreaCodeS | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if ((VALID_AREAS as readonly string[]).includes(trimmed))
    return trimmed as AreaCodeS;
  const stripChars = /[\s·.,/\\①②③④⑤]/g;
  const norm = trimmed.replace(stripChars, "").toLowerCase();
  if (!norm) return null;
  for (const a of AREAS) {
    const ko = a.ko.replace(stripChars, "");
    const en = a.en.replace(stripChars, "").toLowerCase();
    if (
      (ko && (norm.includes(ko) || ko.includes(norm))) ||
      (en && (norm.includes(en) || en.includes(norm)))
    ) {
      return a.code as AreaCodeS;
    }
  }
  return null;
}

async function runBulk(
  provider: ProviderConfig,
  inputs: ProjectInputs,
  language: Language,
  uploadedResearch: string,
): Promise<{
  findings: FindingOut[];
  patterns: PatternOut[];
  candidates: CandidateOut[];
}> {
  const res = await complete(provider, {
    system: buildPhase2BSystem(),
    messages: [
      {
        role: "user",
        content: buildPhase2BUser(inputs, language, uploadedResearch),
      },
    ],
    jsonSchema: PHASE2B_JSON_SCHEMA as unknown as Record<string, unknown>,
    temperature: 0.3,
    maxTokens: 32768,
  });
  if (!res.parsedJson) {
    throw new RouteError(
      "LLM 응답에서 JSON 을 추출하지 못했습니다.",
      502,
      res.text,
    );
  }

  const raw = res.parsedJson as {
    findings?: Array<{
      id?: string;
      area?: string;
      headline?: string;
      detail?: string;
      confidence?: string;
      sources?: Array<{ name?: string; url?: string }>;
      patternIds?: string[];
    }>;
    patterns?: Array<{
      id?: string;
      label?: string;
      title?: string;
      rationale?: string;
      findingIds?: string[];
    }>;
    candidates?: Array<{ text?: string; rationale?: string }>;
  };

  // 1) Normalize + filter findings (drop those without a recognizable area).
  const PLABEL = ["A", "B", "C", "D"];
  const findings: FindingOut[] = [];
  let dropped = 0;
  for (const f of raw.findings ?? []) {
    const area = normalizeAreaCode(f?.area);
    const headline = f?.headline?.trim() ?? "";
    const detail = f?.detail?.trim() ?? "";
    if (!area || !headline || !detail) {
      dropped++;
      continue;
    }
    const id =
      typeof f?.id === "string" && f.id.trim()
        ? f.id.trim()
        : `f${findings.length + 1}`;
    const confidence =
      typeof f?.confidence === "string" && f.confidence.trim()
        ? f.confidence.trim()
        : "미확인";
    const sources = Array.isArray(f?.sources)
      ? f.sources
          .filter((s) => s && typeof s.name === "string" && s.name.trim())
          .map((s) => ({
            name: s.name!.trim(),
            url: typeof s.url === "string" ? s.url : undefined,
          }))
      : [];
    const patternIds = Array.isArray(f?.patternIds)
      ? f.patternIds.filter((p): p is string => typeof p === "string")
      : [];
    findings.push({
      id,
      area,
      headline,
      detail,
      confidence,
      sources,
      patternIds,
    });
  }

  if (findings.length === 0) {
    throw new RouteError(
      `LLM 응답에 유효한 findings 가 없습니다 (드롭 ${dropped}개). 모델을 바꾸거나 다시 시도해 주세요.`,
      502,
      res.text,
    );
  }

  // 2) Patterns — keep model ids/labels but make findingIds referential-safe.
  const validFindingIds = new Set(findings.map((f) => f.id));
  const patterns: PatternOut[] = [];
  const rawPatterns = Array.isArray(raw.patterns) ? raw.patterns : [];
  rawPatterns.slice(0, 4).forEach((p, i) => {
    if (!p?.title?.trim()) return;
    const id =
      typeof p.id === "string" && p.id.trim() ? p.id.trim() : `p${i + 1}`;
    const label =
      typeof p.label === "string" && p.label.trim()
        ? p.label.trim()
        : (PLABEL[i] ?? "");
    const findingIds = Array.isArray(p.findingIds)
      ? p.findingIds.filter(
          (fid): fid is string =>
            typeof fid === "string" && validFindingIds.has(fid),
        )
      : [];
    patterns.push({
      id,
      label,
      title: p.title.trim(),
      rationale: p.rationale?.trim() ?? "",
      findingIds,
    });
  });

  // 3) Filter findings.patternIds against valid pattern ids (referential).
  const validPatternIds = new Set(patterns.map((p) => p.id));
  for (const f of findings) {
    f.patternIds = f.patternIds.filter((p) => validPatternIds.has(p));
  }

  // 4) Candidates.
  const candidates: CandidateOut[] = (
    Array.isArray(raw.candidates) ? raw.candidates : []
  )
    .filter((c) => c && typeof c.text === "string" && c.text.trim())
    .slice(0, 2)
    .map((c) => ({
      text: c.text!.trim(),
      rationale: c.rationale?.trim() ?? "",
    }));

  return { findings, patterns, candidates };
}

// ─── Sequential pipeline path: Ollama ──────────────────────────────────────
async function runPipeline(
  provider: ProviderConfig,
  inputs: ProjectInputs,
  language: Language,
  uploadedResearch: string,
): Promise<{
  findings: FindingOut[];
  patterns: PatternOut[];
  candidates: CandidateOut[];
}> {
  const supplement = extractSupplementSection(uploadedResearch);

  // Step 1: per-area findings (5 calls)
  const findings: FindingOut[] = [];
  let nextId = 1;
  const areaSystem = buildPhase2BAreaSystem();

  for (const a of AREAS) {
    const areaTitle = getAreaTitle(a.code, language);
    const areaContent = extractAreaSection(uploadedResearch, areaTitle);
    const user = buildPhase2BAreaUser(
      inputs,
      language,
      a.code,
      areaTitle,
      areaContent || (language === "ko" ? "답변 없음" : "No answer"),
      supplement,
    );
    const res = await complete(provider, {
      system: areaSystem,
      messages: [{ role: "user", content: user }],
      jsonSchema: PHASE2B_AREA_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.3,
      maxTokens: 16384,
    });
    if (!res.parsedJson) {
      throw new RouteError(
        `LLM 응답에서 JSON 을 추출하지 못했습니다 (영역: ${a.code}).`,
        502,
        res.text,
      );
    }
    const parsed = res.parsedJson as {
      findings?: Array<{
        headline?: string;
        detail?: string;
        confidence?: string;
        sources?: Array<{ name?: string; url?: string }>;
      }>;
    };
    const list = Array.isArray(parsed.findings) ? parsed.findings : [];
    for (const f of list) {
      if (!f || !f.headline || !f.detail) continue;
      const sources = Array.isArray(f.sources)
        ? f.sources
            .filter((s) => s && s.name)
            .map((s) => ({ name: s.name!, url: s.url }))
        : [];
      findings.push({
        id: `f${nextId++}`,
        area: a.code,
        headline: f.headline,
        detail: f.detail,
        confidence: f.confidence ?? "미확인",
        sources,
        patternIds: [], // wired in step 4
      });
    }
  }

  if (findings.length === 0) {
    throw new RouteError(
      "Findings 가 하나도 추출되지 않았습니다. 업로드한 자료가 너무 짧거나 비어 있을 수 있습니다.",
      502,
    );
  }

  // Step 2: patterns
  const findingsSummary = findings
    .map(
      (f) =>
        `${f.id} [${f.area}] (${f.confidence}): ${f.headline} — ${f.detail}`,
    )
    .join("\n");

  const patternsRes = await complete(provider, {
    system: buildPhase2BPatternsSystem(),
    messages: [
      {
        role: "user",
        content: buildPhase2BPatternsUser(inputs, language, findingsSummary),
      },
    ],
    jsonSchema: PHASE2B_PATTERNS_SCHEMA as unknown as Record<string, unknown>,
    temperature: 0.3,
    maxTokens: 4096,
  });
  if (!patternsRes.parsedJson) {
    throw new RouteError(
      "LLM 응답에서 JSON 을 추출하지 못했습니다 (patterns).",
      502,
      patternsRes.text,
    );
  }
  const patternsParsed = patternsRes.parsedJson as {
    patterns?: Array<{
      id?: string;
      label?: string;
      title?: string;
      rationale?: string;
      findingIds?: string[];
    }>;
  };
  const PLABEL = ["A", "B", "C", "D"];
  const validIds = new Set(findings.map((f) => f.id));
  const patterns: PatternOut[] = [];
  const rawPatterns = Array.isArray(patternsParsed.patterns)
    ? patternsParsed.patterns
    : [];
  rawPatterns.slice(0, 4).forEach((p, i) => {
    if (!p || !p.title) return;
    const id = `p${i + 1}`;
    const findingIds = Array.isArray(p.findingIds)
      ? p.findingIds.filter((fid) => typeof fid === "string" && validIds.has(fid))
      : [];
    patterns.push({
      id,
      label: PLABEL[i],
      title: p.title,
      rationale: p.rationale ?? "",
      findingIds,
    });
  });

  // Step 3: candidates
  const patternsSummary = patterns
    .map(
      (p) =>
        `${p.id} (${p.label}) "${p.title}" — ${p.rationale} [findings: ${p.findingIds.join(", ")}]`,
    )
    .join("\n");

  const candRes = await complete(provider, {
    system: buildPhase2BCandidatesSystem(),
    messages: [
      {
        role: "user",
        content: buildPhase2BCandidatesUser(
          inputs,
          language,
          findingsSummary,
          patternsSummary || "(no cross-cutting patterns identified)",
        ),
      },
    ],
    jsonSchema: PHASE2B_CANDIDATES_SCHEMA as unknown as Record<string, unknown>,
    temperature: 0.4,
    maxTokens: 2048,
  });
  if (!candRes.parsedJson) {
    throw new RouteError(
      "LLM 응답에서 JSON 을 추출하지 못했습니다 (candidates).",
      502,
      candRes.text,
    );
  }
  const candParsed = candRes.parsedJson as {
    candidates?: Array<{ text?: string; rationale?: string }>;
  };
  const candidates: CandidateOut[] = (
    Array.isArray(candParsed.candidates) ? candParsed.candidates : []
  )
    .filter((c) => c && c.text)
    .slice(0, 2)
    .map((c) => ({ text: c.text!, rationale: c.rationale ?? "" }));

  // Step 4: wire patternIds onto findings (referential integrity)
  const findingPatternMap = new Map<string, string[]>();
  for (const p of patterns) {
    for (const fid of p.findingIds) {
      const arr = findingPatternMap.get(fid) ?? [];
      arr.push(p.id);
      findingPatternMap.set(fid, arr);
    }
  }
  for (const f of findings) {
    f.patternIds = findingPatternMap.get(f.id) ?? [];
  }

  return { findings, patterns, candidates };
}
