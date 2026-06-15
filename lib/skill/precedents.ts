import { ProjectInputs, Language } from "@/lib/types/project";

/**
 * Phase 3.5 — Reference precedent search-prompt generation.
 *
 * Mirrors the Phase 1 pattern: the app does NOT search the web. It generates
 * self-contained prompts the user runs on an external research AI (Perplexity,
 * ChatGPT, Gemini) to collect similar architectural precedents. Each "angle"
 * targets a different axis of similarity (typology, design approach, context,
 * materiality, critical alternatives).
 */

export type PrecedentAngleCode =
  | "typology_scale"
  | "design_approach"
  | "context_site"
  | "material_atmosphere"
  | "critical_alternative";

export const PRECEDENT_ANGLES: ReadonlyArray<{
  code: PrecedentAngleCode;
  index: number;
  ko: string;
  en: string;
  guidanceKo: string;
  guidanceEn: string;
}> = [
  {
    code: "typology_scale",
    index: 1,
    ko: "① 유형 · 규모",
    en: "① Typology · scale",
    guidanceKo:
      "같은 공간 유형이면서 유사한 규모·예산으로 실제 완공된 국내외 선례.",
    guidanceEn:
      "Built precedents of the same space type at a comparable scale/budget.",
  },
  {
    code: "design_approach",
    index: 2,
    ko: "② 설계 접근 · 파르티",
    en: "② Design approach · parti",
    guidanceKo:
      "동일한 설계 전략이나 파르티(개념적 접근)를 공유하는 사례 — 유형이 달라도 무방.",
    guidanceEn:
      "Precedents sharing the same design strategy or parti, even across typologies.",
  },
  {
    code: "context_site",
    index: 3,
    ko: "③ 맥락 · 대지 조건",
    en: "③ Context · site condition",
    guidanceKo:
      "유사한 도시·대지 조건(밀도, 지형, 인접 관계, 기후)에서 대응한 사례.",
    guidanceEn:
      "Precedents responding to a similar urban/site condition (density, topography, adjacency, climate).",
  },
  {
    code: "material_atmosphere",
    index: 4,
    ko: "④ 재료 · 분위기",
    en: "④ Materiality · atmosphere",
    guidanceKo:
      "유사한 재료성·구축·공간 분위기(빛, 촉감, 무드)를 구현한 사례.",
    guidanceEn:
      "Precedents realizing a similar materiality, tectonics, and spatial atmosphere (light, tactility, mood).",
  },
  {
    code: "critical_alternative",
    index: 5,
    ko: "⑤ 비판적 · 대안적",
    en: "⑤ Critical · alternative",
    guidanceKo:
      "이 유형의 통상적 한계를 넘어선 비판적·실험적·대안적 선례.",
    guidanceEn:
      "Critical, experimental, or alternative precedents that exceed this typology's usual limits.",
  },
];

export function precedentTitle(
  angle: PrecedentAngleCode,
  language: Language,
): string {
  const a = PRECEDENT_ANGLES.find((x) => x.code === angle);
  if (!a) return angle;
  return language === "ko" ? a.ko : a.en;
}

export type ConceptContext = {
  parti?: string;
  keywords?: string[];
  strategies?: string[];
  materiality?: string;
};

function contextLines(
  inputs: ProjectInputs,
  finalPS: string | undefined,
  concept: ConceptContext | undefined,
): string {
  const lines = [
    `Site: ${inputs.site}`,
    `Typology / Space type: ${inputs.typology}`,
  ];
  if (inputs.scale) lines.push(`Scale: ${inputs.scale}`);
  if (inputs.constraints) lines.push(`Known constraints: ${inputs.constraints}`);
  if (finalPS) lines.push(`Confirmed Problem Statement: "${finalPS}"`);
  if (concept?.parti) lines.push(`Design parti: ${concept.parti}`);
  if (concept?.keywords?.length)
    lines.push(`Concept keywords: ${concept.keywords.join(", ")}`);
  if (concept?.strategies?.length)
    lines.push(`Spatial strategies: ${concept.strategies.join("; ")}`);
  if (concept?.materiality)
    lines.push(`Materiality / atmosphere: ${concept.materiality}`);
  return lines.join("\n");
}

const SHARED_RULES = `You generate prompts that the user will paste into an external research AI to collect REAL architectural precedents. You do NOT list precedents yourself.

Each prompt body MUST instruct the external AI to:
- Return 3–5 real precedents (built, or notable competition/unbuilt if clearly labeled).
- For EACH precedent give: project name · architect/office · year · location · one line on WHY it is relevant to THIS project (tie it to the angle) · the single key spatial/strategic move · a source URL.
- Prefer primary/official sources (architect's site, ArchDaily, Divisare, journals, monographs) and include the URL with each precedent.
- Explicitly warn the AI NOT to invent project names, architects, or dates — if unsure, say so rather than fabricate.

Write each body as a complete, standalone prompt in {LANG} — an external AI can act on it with no other context. Do NOT include the angle title or any header inside the body; just the prompt content.`;

// ── Bulk path (Anthropic / Gemini) ───────────────────────────────────────

const BULK_ITEM = {
  type: "object",
  required: ["body"],
  properties: { body: { type: "string" } },
} as const;

export const PRECEDENT_BULK_SCHEMA = {
  type: "object",
  required: ["prompts"],
  properties: {
    prompts: {
      type: "object",
      required: [
        "typology_scale",
        "design_approach",
        "context_site",
        "material_atmosphere",
        "critical_alternative",
      ],
      properties: {
        typology_scale: BULK_ITEM,
        design_approach: BULK_ITEM,
        context_site: BULK_ITEM,
        material_atmosphere: BULK_ITEM,
        critical_alternative: BULK_ITEM,
      },
    },
  },
} as const;

export function buildPrecedentBulkSystem(language: Language): string {
  return `You are an architectural precedent researcher assisting a pre-design study.

${SHARED_RULES.replace("{LANG}", language === "ko" ? "Korean" : "English")}

Produce ONE prompt for EACH of the 5 angles below, each focused on a different axis of similarity:
${PRECEDENT_ANGLES.map(
  (a) =>
    `- ${a.code}: ${language === "ko" ? a.guidanceKo : a.guidanceEn}`,
).join("\n")}

Return ONLY JSON conforming to the schema. No prose outside JSON.`;
}

export function buildPrecedentBulkUser(
  inputs: ProjectInputs,
  language: Language,
  finalPS: string | undefined,
  concept: ConceptContext | undefined,
): string {
  return `Generate the 5 precedent-search prompts for this project.

Language: ${language}
${contextLines(inputs, finalPS, concept)}

"prompts" is an OBJECT with EXACTLY these 5 keys, each { body }:
- typology_scale
- design_approach
- context_site
- material_atmosphere
- critical_alternative

Each "body" is the full prompt text the user copy-pastes into an external research AI.`;
}

// ── Per-angle path (Ollama) ──────────────────────────────────────────────

export const PRECEDENT_ANGLE_SCHEMA = {
  type: "object",
  required: ["body"],
  properties: { body: { type: "string" } },
} as const;

export function buildPrecedentAngleSystem(language: Language): string {
  return `You are an architectural precedent researcher assisting a pre-design study.

${SHARED_RULES.replace("{LANG}", language === "ko" ? "Korean" : "English")}

You will be asked to generate ONE prompt for ONE specific angle.
Return ONLY a JSON object { "body": "..." }. No prose outside JSON, no other keys.`;
}

export function buildPrecedentAngleUser(
  inputs: ProjectInputs,
  language: Language,
  finalPS: string | undefined,
  concept: ConceptContext | undefined,
  angle: (typeof PRECEDENT_ANGLES)[number],
): string {
  const guidance = language === "ko" ? angle.guidanceKo : angle.guidanceEn;
  return `Generate the precedent-search prompt for ONE angle only:

Angle code: ${angle.code}
Angle focus: ${guidance}

Project context:
Language: ${language}
${contextLines(inputs, finalPS, concept)}

Return JSON: { "body": "<full prompt text the user will copy-paste into an external research AI>" }.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse pasted research results into structured precedent records.
// ─────────────────────────────────────────────────────────────────────────────

export const PRECEDENT_PARSE_SCHEMA = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        // All fields required so structured-output models (e.g. Gemini) emit
        // every key rather than silently dropping the optional ones.
        required: [
          "name",
          "architect",
          "year",
          "location",
          "strategy",
          "relevance",
          "sourceUrl",
        ],
        properties: {
          name: { type: "string" },
          architect: { type: "string" },
          year: { type: "string" },
          location: { type: "string" },
          strategy: { type: "string" },
          relevance: { type: "string" },
          sourceUrl: { type: "string" },
        },
      },
    },
  },
} as const;

export function buildPrecedentParseSystem(language: Language): string {
  const lang = language === "ko" ? "Korean" : "English";
  return `You extract architectural precedents from pasted research text (usually an external AI's answer) into structured records. Each precedent is normally written as a heading (name · architect · year) FOLLOWED BY a paragraph of prose. Most fields live in that prose — read the WHOLE entry, not just the heading.

For EACH distinct precedent, output one record and fill ALL of these fields:
- name: project name
- architect: architect / office
- year: completion year
- location: city / country — scan the prose for place names
- strategy: the key spatial / architectural strategies. Write 2–4 bullet points, each on its own line starting with "• ". Be specific and PRESERVE the detail in the text — do not compress everything into one short line.
- relevance: why it matters to the user's project. Write 2–4 bullet points, each on its own line starting with "• ", using the text's stated relevance and concrete reasons.
- sourceUrl: a source URL for this precedent if one appears in the text

Critical rules:
- strategy and relevance MUST be multi-line bulleted lists ("• " per line), not single sentences. Keep the richness of the source text.
- Do NOT leave location / strategy / relevance blank when the prose describes them — extract and summarize. Only use "" when the text truly says nothing about that field.
- Do NOT invent precedents that are not in the text. If the text contains none, return an empty items array.
- Keep free-text fields (location, strategy, relevance) in ${lang}; keep proper nouns (name, architect) as written.
- Output ONLY a JSON object conforming to the schema. No prose outside JSON.

Example (structure only — mirror the INPUT text's language in your real output):
Input: "Teshima Art Museum (SANAA / Ryue Nishizawa, 2010) — On Teshima Island, Japan. A single seamless concrete shell forms a column-free interior that frames the sky; water beads travel across the floor; two oval openings connect to weather and season. Relevant for its minimal-structure dialogue with landscape and its single-material atmosphere. https://ex.com/teshima"
Output: {"items":[{"name":"Teshima Art Museum","architect":"SANAA (Ryue Nishizawa)","year":"2010","location":"Teshima Island, Japan","strategy":"• Single seamless concrete shell forms a column-free interior\\n• Two oval roof openings connect the space to weather, light and season\\n• Water beads move across the floor as a kinetic, atmospheric element","relevance":"• Minimal-structure approach that merges architecture with the surrounding landscape\\n• Demonstrates a single-material atmosphere driving the spatial experience\\n• Shows how a quiet, open volume can frame nature as the main content","sourceUrl":"https://ex.com/teshima"}]}`;
}

export function buildPrecedentParseUser(text: string): string {
  return `Extract the precedents from the following research text.

--- RESEARCH TEXT START ---
${text}
--- RESEARCH TEXT END ---

Return JSON: { "items": [ { "name", "architect", "year", "location", "strategy", "relevance", "sourceUrl" }, ... ] }.`;
}
