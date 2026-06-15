import { SKILL_MD } from "./index";
import { Language, ProjectInputs } from "@/lib/types/project";
import { AreaCode, AREAS } from "@/lib/skill/phase1";

// ─────────────────────────────────────────────────────────────────────────────
// Bulk schema/builders — used for Anthropic & Gemini, which can handle the
// full markdown + counting + risks/gaps in a single response.
// ─────────────────────────────────────────────────────────────────────────────

export const PHASE2A_JSON_SCHEMA = {
  type: "object",
  required: ["tagPreview", "headlineRisks", "contentGaps"],
  properties: {
    tagPreview: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        required: ["area", "primary", "secondary", "unverified"],
        properties: {
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
          primary: { type: "integer", minimum: 0 },
          secondary: { type: "integer", minimum: 0 },
          unverified: { type: "integer", minimum: 0 },
          note: { type: "string" },
        },
      },
    },
    headlineRisks: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        required: ["finding", "reason", "verifyAt"],
        properties: {
          finding: { type: "string" },
          reason: { type: "string" },
          verifyAt: { type: "string" },
        },
      },
    },
    contentGaps: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        required: ["area", "description"],
        properties: {
          area: {
            type: "string",
            enum: [
              "site_context",
              "users_community",
              "precedent_studies",
              "socio_cultural",
              "typology_limits",
              "general",
            ],
          },
          description: { type: "string" },
        },
      },
    },
  },
} as const;

export function buildPhase2ASystem(): string {
  return `${SKILL_MD}

---

You are now executing Phase 2-A — Pre-synthesis Review of the architectural-research-brief skill.

The user has just uploaded a markdown document containing the results from external research AIs, organized by the 5 fixed research areas.

Your task is ONLY the focused review described in Phase 2-A:

**1) tagPreview** — For EACH of the 5 areas, count INDIVIDUAL FINDINGS in the user's uploaded markdown by source confidence.

A finding is one factual assertion: a statistic, a named building/architect/firm, a date, a regulation, a user-group description, a debate point. A 2,000-char section typically contains 10–30 findings.

[1차] = primary source: 통계청/KOSIS/SGIS, 토지이음, .go.kr, 한국부동산원 R-ONE, 학술논문 (DOI/RISS/KCI/DBpia), 설계사무소 공식 웹사이트, 건축가 공식 인터뷰, "보완 자료 (사용자 검증)" 섹션의 모든 finding.
[2차] = secondary source: ArchDaily/Dezeen/Designboom, SPACE/브리크/A+U, 일반 언론 분석/해설, 블로그·브런치, 부동산 플랫폼 요약.
[미확인] = NO source citation. If the external AI just stated something with no URL/citation, it is [미확인], NOT [2차].

Avoid the "default to [2차]" failure mode. Mark [2차] ONLY when an explicit secondary citation is visible.

**2) headlineRisks** — Exactly 3 specific findings FROM the markdown that are likely to anchor the Problem Statement BUT are currently [2차] or [미확인]. The "finding" must be a short paraphrase of an actual claim. The "verifyAt" must be a specific Korean primary-source location (토지이음, 통계청 SGIS, 자치구청 보도자료, RISS/KCI, 설계사무소 공식 웹 등). Never write abstract critiques.

**3) contentGaps** — Exactly 3 items: 답변 없음 areas, missing user groups, missing quantitative claims, notable absences.

If the markdown contains "# 보완 자료 (사용자 검증)", treat its content as [1차] verification — lift findings to [1차] and remove the resolved risks/gaps.

Mirror the user's language. Return ONLY JSON conforming to the schema.`;
}

export function buildPhase2AUser(
  inputs: ProjectInputs,
  language: Language,
  uploadedMd: string,
): string {
  const exampleNote =
    language === "ko" ? "출처 표기 일관됨" : "consistent attribution";
  const exampleFinding =
    language === "ko"
      ? "성수1동 30대 인구 비율 28.4% (블로그 인용)"
      : "Specific statistic with [2차] tag from the markdown";
  const exampleReason =
    language === "ko"
      ? "Problem Statement 의 사용자 정의 근거가 될 수 있으나 1차 자료 미확인"
      : "Could anchor user definition in PS but no primary source";
  const exampleVerifyAt =
    language === "ko"
      ? "통계청 SGIS (sgis.kostat.go.kr) → 성수1동 행정동 인구"
      : "Statistics SGIS portal → district population";
  const exampleDescription =
    language === "ko"
      ? "이 영역에 답변이 비어있거나 핵심 정보가 부족한 부분 (구체적으로 무엇이 빠져있는지)"
      : "What specifically is missing in this area";

  return `Project context:
- Site: ${inputs.site}
- Typology: ${inputs.typology}
- Language: ${language}

Uploaded research markdown (verbatim):
"""
${uploadedMd}
"""

Run Phase 2-A pre-synthesis review on the above.

CRITICAL: Return JSON in EXACTLY this shape (each array contains OBJECTS, not strings):

{
  "tagPreview": [
    { "area": "site_context",      "primary": 0, "secondary": 0, "unverified": 0, "note": "${exampleNote}" },
    { "area": "users_community",   "primary": 0, "secondary": 0, "unverified": 0, "note": "" },
    { "area": "precedent_studies", "primary": 0, "secondary": 0, "unverified": 0, "note": "" },
    { "area": "socio_cultural",    "primary": 0, "secondary": 0, "unverified": 0, "note": "" },
    { "area": "typology_limits",   "primary": 0, "secondary": 0, "unverified": 0, "note": "" }
  ],
  "headlineRisks": [
    { "finding": "${exampleFinding}", "reason": "${exampleReason}", "verifyAt": "${exampleVerifyAt}" },
    { "finding": "...", "reason": "...", "verifyAt": "..." },
    { "finding": "...", "reason": "...", "verifyAt": "..." }
  ],
  "contentGaps": [
    { "area": "site_context", "description": "${exampleDescription}" },
    { "area": "general",      "description": "..." },
    { "area": "users_community", "description": "..." }
  ]
}

DO NOT return arrays of plain strings. Each item in every array MUST be an object with the specified keys. tagPreview has exactly 5 rows in fixed order. headlineRisks and contentGaps have exactly 3 items each.

\`area\` values: site_context, users_community, precedent_studies, socio_cultural, typology_limits (contentGaps may also use "general").`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-area schema/builders — used for Ollama. Each call scans only one area's
// section of the markdown, which is far easier for a small/local model than
// reading 40K+ characters at once.
// ─────────────────────────────────────────────────────────────────────────────

export const PHASE2A_AREA_SCHEMA = {
  type: "object",
  required: ["primary", "secondary", "unverified", "note", "risks", "gaps"],
  properties: {
    primary: { type: "integer", minimum: 0 },
    secondary: { type: "integer", minimum: 0 },
    unverified: { type: "integer", minimum: 0 },
    note: { type: "string" },
    risks: {
      type: "array",
      items: {
        type: "object",
        required: ["finding", "reason", "verifyAt"],
        properties: {
          finding: { type: "string" },
          reason: { type: "string" },
          verifyAt: { type: "string" },
        },
      },
    },
    gaps: {
      type: "array",
      items: {
        type: "object",
        required: ["description"],
        properties: {
          description: { type: "string" },
        },
      },
    },
  },
} as const;

export function buildPhase2AAreaSystem(): string {
  // Compact — no full SKILL.md. The per-area task only needs the tagging
  // rubric, kept short so small models can hold it alongside the area text.
  return `You are doing pre-synthesis review of architectural research material for ONE area.

Tag each finding by source confidence:
- [1차] primary: 통계청/KOSIS/SGIS, 토지이음, .go.kr 도메인, 한국부동산원 R-ONE, 학술논문 (DOI/RISS/KCI/DBpia), 설계사무소 공식 웹사이트, 건축가 공식 인터뷰, "보완 자료 (사용자 검증)" 섹션 내용.
- [2차] secondary: ArchDaily/Dezeen/Designboom, SPACE/브리크/A+U, 일반 언론 분석, 블로그·브런치, 부동산 플랫폼 요약.
- [미확인] no source: substantive claim with NO citation/URL. NOT the same as [2차]. If you cannot identify any source, mark [미확인].

A finding is ONE factual assertion (a statistic, named precedent, regulation, date, user-group claim, etc.). A 5,000-character section typically contains 30–80 findings.

Return ONLY a JSON object matching the schema. Mirror the language of the input.`;
}

export function buildPhase2AAreaUser(
  inputs: ProjectInputs,
  language: Language,
  area: AreaCode,
  areaTitle: string,
  areaContent: string,
  supplement: string | null,
): string {
  const verifyAtExamples =
    language === "ko"
      ? `토지이음 (eum.molit.go.kr) → 용도지역·건폐율·용적률; 통계청 SGIS (sgis.kostat.go.kr) → 행정동 단위 인구·연령; 한국부동산원 R-ONE → 임대료·실거래가; 자치구청 보도자료; 학술논문 (RISS/KCI/DBpia); 설계사무소 공식 웹·건축가 공식 인터뷰 (선례)`
      : `zoning portal, statistics agency, real-estate authority, district press releases, academic databases, firm official websites for precedents`;

  const supplementBlock = supplement
    ? `

Supplementary verification by the user (treat as [1차] when it substantiates a claim from the area above; if a claim in the area is verified by the supplement, count it as [1차] in your "primary" count, NOT separately):
"""
${supplement}
"""`
    : "";

  return `Project context:
- Site: ${inputs.site}
- Typology: ${inputs.typology}
- Language: ${language}

You are reviewing ONE area's research output.

Area: ${area} (${areaTitle})

Area markdown (verbatim — count and tag findings inside this):
"""
${areaContent}
"""${supplementBlock}

Return JSON with:
- "primary": integer count of findings backed by [1차] sources in the area markdown.
- "secondary": integer count of findings backed by [2차] sources.
- "unverified": integer count of substantive findings with NO source citation.
- "note": short note (한 줄) about this area — e.g. "출처 표기 일관됨", "통계청 인용 다수", "출처 없음 다수", or "답변 없음" if empty.
- "risks": 0–2 items. Each is a short paraphrase of an ACTUAL claim from the area markdown that is currently [2차] or [미확인], that would likely anchor the Problem Statement, and SHOULD be verified against a primary source. Format: { "finding": "<short paraphrase, no abstract critique>", "reason": "<why it matters>", "verifyAt": "<one specific Korean primary-source location, e.g. ${verifyAtExamples}>" }. If nothing notable, return [].
- "gaps": 0–2 items. Each describes a notable absence in this area — missing user groups, missing quantitative claims, "답변 없음", etc. Format: { "description": "<what is missing>" }. If nothing notable, return [].

Be specific. Every "finding" and "description" must reference content actually present in the area markdown. Do NOT invent generic critiques.

If the area is empty / "답변 없음", set all counts to 0, note = "답변 없음", risks = [], gaps = [{ "description": "이 영역의 답변이 비어 있음" }].`;
}

// All known top-level section headers used by buildUploadedResearch.
// extractAreaSection only treats these as section boundaries; arbitrary `#`
// headers inside pasted external-AI output do NOT close a section.
function knownSectionHeaders(): string[] {
  const titles: string[] = [];
  for (const a of AREAS) {
    titles.push(a.ko);
    titles.push(a.en);
  }
  titles.push("보완 자료 (사용자 검증)");
  titles.push("Supplementary Verification");
  return titles;
}

// Extract one area's content from the unified scaffold markdown produced by
// buildUploadedResearch. The scaffold uses "# <visibleTitle>" headers per
// area, plus optionally "# 보완 자료 (사용자 검증)" at the end.
//
// Pasted external-AI output frequently contains its own `# ...` headers — we
// must NOT treat those as section boundaries, only the known canonical ones.
export function extractAreaSection(
  uploadedMd: string,
  areaTitle: string,
): string {
  const known = new Set(knownSectionHeaders().map((s) => s.trim()));
  const lines = uploadedMd.split("\n");
  const out: string[] = [];
  let inSection = false;
  for (const line of lines) {
    const m = line.match(/^#\s+(.+?)\s*$/);
    const header = m ? m[1].trim() : null;
    const isKnownBoundary = header !== null && known.has(header);
    if (isKnownBoundary) {
      if (header === areaTitle.trim()) {
        inSection = true;
        continue;
      }
      if (inSection) break; // hit next known section
      continue;
    }
    if (inSection) out.push(line);
  }
  return out.join("\n").trim();
}

export function extractSupplementSection(uploadedMd: string): string | null {
  const candidates = [
    "보완 자료 (사용자 검증)",
    "Supplementary Verification",
  ];
  for (const c of candidates) {
    const section = extractAreaSection(uploadedMd, c);
    if (section) return section;
  }
  return null;
}

export function getAreaTitle(area: AreaCode, language: Language): string {
  const a = AREAS.find((x) => x.code === area);
  if (!a) return area;
  return language === "ko" ? a.ko : a.en;
}
