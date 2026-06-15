import { SKILL_MD } from "./index";
import { Language, ProjectInputs } from "@/lib/types/project";
import { AreaCode, AREAS } from "@/lib/skill/phase1";

// ─────────────────────────────────────────────────────────────────────────────
// Bulk schema/builders — used for Anthropic & Gemini.
// ─────────────────────────────────────────────────────────────────────────────

export const PHASE2B_JSON_SCHEMA = {
  type: "object",
  required: ["findings", "patterns", "candidates"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id",
          "area",
          "headline",
          "detail",
          "confidence",
          "sources",
          "patternIds",
        ],
        properties: {
          id: { type: "string" },
          area: {
            type: "string",
            enum: [
              "site_context",
              "users_community",
              "precedent_studies",
              "socio_cultural",
              "typology_limits",
            ],
          },
          headline: { type: "string" },
          detail: { type: "string" },
          confidence: { type: "string" },
          sources: {
            type: "array",
            items: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string" },
                url: { type: "string" },
              },
            },
          },
          patternIds: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    },
    patterns: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "label", "title", "rationale", "findingIds"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          title: { type: "string" },
          rationale: { type: "string" },
          findingIds: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    },
    candidates: {
      type: "array",
      items: {
        type: "object",
        required: ["text", "rationale"],
        properties: {
          text: { type: "string" },
          rationale: { type: "string" },
        },
      },
    },
  },
} as const;

export function buildPhase2BSystem(): string {
  return `${SKILL_MD}

---

You are now executing Phase 2-B — Main Synthesis of the architectural-research-brief skill.

The user has reviewed Phase 2-A and chosen to proceed. They have uploaded research material across the 5 areas (and possibly a "# 보완 자료 (사용자 검증)" section with primary-source verification).

Your task per the skill's Phase 2-B section:

1. **Findings** — for EACH of the 5 areas, extract 3–5 Key Findings.
   - Each finding: id (e.g. "f1"), area code, headline (≤30 chars), detail (1–2 concrete sentences), confidence tag, 1–3 source references, and patternIds array.
   - "area" MUST be EXACTLY one of these code strings (no Korean label, no spaces, no punctuation):
     • "site_context"        (= 사이트 맥락 / Site context)
     • "users_community"     (= 사용자 · 커뮤니티 / Users · community)
     • "precedent_studies"   (= 선례 분석 / Precedent studies)
     • "socio_cultural"      (= 사회·문화적 이슈 / Socio-cultural issues)
     • "typology_limits"     (= 유형의 한계 / Typology limits)
   - Tag confidence: "1차" / "2차" / "미확인" per the skill's definitions.
   - Content from the "# 보완 자료" section counts as [1차] by default.
   - Concrete > generic. "사람들이 카페를 좋아한다" is unacceptable; "성수동 평일 점심 유동인구의 70%가 인근 IT 오피스 직원, 좌석 회전율 1.4시간" is good.
   - Each finding's sources array must list 1–3 specific sources actually cited in the uploaded material (with URL when present). If only an area-level source exists, attribute it.
   - Each finding's patternIds links to the pattern(s) it contributes to. Most findings link to 1–2 patterns; a finding that contributes to 0 patterns is allowed (background context).

2. **Patterns** — identify 2–4 cross-cutting patterns.
   - Recurring tensions, contradictions, gaps, opportunities across multiple areas.
   - id: p1, p2, p3, p4 (positional). label: A, B, C, D (positional, matching id).
   - Each pattern's findingIds must reference at least 2 finding ids from at least 2 different areas.
   - Title is short (≤ 40 chars). Rationale is 1–2 sentences explaining why this pattern matters and which findings substantiate it.

3. **Candidates** — draft EXACTLY 2 candidate Problem Statements.
   - Each: ONE sentence naming the user/context, the tension, the design opportunity. No solution.
   - Template: "[사이트/맥락]에서 [사용자/주체]는 [현재의 한계/긴장]을 겪고 있으며, [공간 유형]은 [재정의/응답]이 필요하다."
   - Avoid prescribing a solution — the Problem Statement is the question the design will answer.
   - Rationale (one line): which patterns this candidate draws from.
   - Every concrete number in a candidate MUST trace to a [1차] or [2차] finding — never invent figures.

CRITICAL — referential integrity:
- Every patternId mentioned in a finding's patternIds must exist as a pattern.
- Every findingId mentioned in a pattern's findingIds must exist as a finding.
- candidates do NOT include findingIds or patternIds in their JSON (the rationale string mentions patterns prose-style).

Mirror the user's language. Return ONLY JSON conforming to the schema.`;
}

export function buildPhase2BUser(
  inputs: ProjectInputs,
  language: Language,
  uploadedMd: string,
): string {
  return `Project context:
- Site: ${inputs.site}
- Typology: ${inputs.typology}
- Language: ${language}

Uploaded research markdown (verbatim, includes "# 보완 자료" section if present):
"""
${uploadedMd}
"""

Run Phase 2-B main synthesis on the above. Return JSON with these strict shape rules:

- findings: array of 15–25 objects (3–5 per area × 5 areas).
- patterns: 2–4 objects.
- candidates: EXACTLY 2 objects { text, rationale }`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-step schema/builders — used for Ollama. Three-step sequential pipeline:
//   Step 1: per-area findings (5 calls) — small focused scope each
//   Step 2: cross-cutting patterns from aggregated findings (1 call)
//   Step 3: candidate Problem Statements from findings + patterns (1 call)
// ─────────────────────────────────────────────────────────────────────────────

// Step 1
export const PHASE2B_AREA_SCHEMA = {
  type: "object",
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["headline", "detail", "confidence", "sources"],
        properties: {
          headline: { type: "string" },
          detail: { type: "string" },
          confidence: { type: "string" },
          sources: {
            type: "array",
            items: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string" },
                url: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

export function buildPhase2BAreaSystem(): string {
  return `You are extracting Key Findings from architectural pre-design research material for ONE area.

HARD LIMITS (CRITICAL — violations will cause failures):
- Return EXACTLY 3 to 5 findings. NEVER more than 5.
- "headline": MAX 30 characters. Short and concrete.
- "detail": MAX 2 sentences. MAX 200 characters total. Be terse.
- "sources": MAX 3 items.
- TOTAL response under 3000 characters of JSON.

Per finding:
- headline: ≤ 30 characters, concrete (a number, named precedent, regulation, etc.)
- detail: 1–2 short sentences (≤ 200 chars). Generic statements ("사람들이 카페를 좋아한다") are FORBIDDEN.
- confidence: exactly one of "1차" / "2차" / "미확인":
  • "1차" = backed by primary source (통계청/SGIS, 토지이음, .go.kr, 한국부동산원 R-ONE, DOI/RISS/KCI, 설계사무소 공식, "보완 자료 (사용자 검증)" 섹션 내용 등)
  • "2차" = backed by secondary (ArchDaily/Dezeen, 일반 언론, 블로그 등)
  • "미확인" = no source citation visible
- sources: 1–3 objects { name, url? } — actually present in the area markdown. Do NOT invent sources.

Mirror the input language exactly. Return ONLY JSON: { "findings": [ ... 3–5 items ... ] }. Be concise — concision matters more than completeness.`;
}

export function buildPhase2BAreaUser(
  inputs: ProjectInputs,
  language: Language,
  area: AreaCode,
  areaTitle: string,
  areaContent: string,
  supplement: string | null,
): string {
  const supplementBlock = supplement
    ? `

Supplementary verification by the user (treat as [1차] when relevant; if a finding from the area is verified by the supplement, mark it confidence "1차" and cite the supplement source):
"""
${supplement}
"""`
    : "";

  return `Project context:
- Site: ${inputs.site}
- Typology: ${inputs.typology}
- Language: ${language}

Extract 3–5 Key Findings from ONE area only.

Area: ${area} (${areaTitle})

Area markdown (verbatim — extract findings from this content):
"""
${areaContent}
"""${supplementBlock}

Return JSON: { "findings": [ { "headline": "...", "detail": "...", "confidence": "1차"|"2차"|"미확인", "sources": [{"name": "...", "url": "..."}] }, ... ] }

Pick 3–5 of the most concrete and consequential findings — those with numbers, named precedents, regulations, named user groups, specific tensions. Avoid generic abstractions.

If the area is empty / "답변 없음", return { "findings": [] }.`;
}

// Step 2 — patterns
export const PHASE2B_PATTERNS_SCHEMA = {
  type: "object",
  required: ["patterns"],
  properties: {
    patterns: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "label", "title", "rationale", "findingIds"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          title: { type: "string" },
          rationale: { type: "string" },
          findingIds: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    },
  },
} as const;

export function buildPhase2BPatternsSystem(): string {
  return `You are identifying cross-cutting patterns across architectural pre-design findings from 5 research areas.

Rules:
- Identify 2–4 patterns. Each pattern is a recurring tension, contradiction, gap, or opportunity that spans MULTIPLE areas.
- id: positional "p1" / "p2" / "p3" / "p4". label: matching positional "A" / "B" / "C" / "D" (p1→A, p2→B, p3→C, p4→D).
- title: short (≤ 40 chars).
- rationale: 1–2 sentences explaining why this pattern matters and which findings substantiate it.
- findingIds: at least 2 finding ids from at least 2 DIFFERENT areas. Use the f<n> ids exactly as listed.

Mirror the input language. Return ONLY JSON: { "patterns": [ ... ] }.`;
}

export function buildPhase2BPatternsUser(
  inputs: ProjectInputs,
  language: Language,
  findingsSummary: string,
): string {
  return `Project context:
- Site: ${inputs.site}
- Typology: ${inputs.typology}
- Language: ${language}

Findings (extracted from the 5 research areas):
"""
${findingsSummary}
"""

Identify 2–4 cross-cutting patterns. Each pattern's findingIds must reference at least 2 finding ids from at least 2 different areas. Return JSON: { "patterns": [...] }.`;
}

// Step 3 — candidates
export const PHASE2B_CANDIDATES_SCHEMA = {
  type: "object",
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        required: ["text", "rationale"],
        properties: {
          text: { type: "string" },
          rationale: { type: "string" },
        },
      },
    },
  },
} as const;

export function buildPhase2BCandidatesSystem(): string {
  return `You are drafting candidate Problem Statements for an architectural project, based on extracted findings and cross-cutting patterns.

Rules:
- Draft EXACTLY 2 candidates.
- Each candidate is ONE sentence naming the user/context, the tension, and the design opportunity. NO solution prescribed.
- Template: "[사이트/맥락]에서 [사용자/주체]는 [현재의 한계/긴장]을 겪고 있으며, [공간 유형]은 [재정의/응답]이 필요하다."
- rationale: one line stating which patterns this candidate draws from.
- Every concrete number in a candidate MUST trace to a [1차] or [2차] finding — never invent figures.

Mirror the input language. Return ONLY JSON: { "candidates": [ {text, rationale}, {text, rationale} ] }.`;
}

export function buildPhase2BCandidatesUser(
  inputs: ProjectInputs,
  language: Language,
  findingsSummary: string,
  patternsSummary: string,
): string {
  return `Project context:
- Site: ${inputs.site}
- Typology: ${inputs.typology}
- Language: ${language}

Findings:
"""
${findingsSummary}
"""

Patterns:
"""
${patternsSummary}
"""

Draft EXACTLY 2 candidate Problem Statements. Return JSON: { "candidates": [ {"text": "...", "rationale": "..."}, {"text": "...", "rationale": "..."} ] }.`;
}

export function getAreaTitle(area: AreaCode, language: Language): string {
  const a = AREAS.find((x) => x.code === area);
  if (!a) return area;
  return language === "ko" ? a.ko : a.en;
}
