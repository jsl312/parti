import { SKILL_MD } from "./index";
import { ProjectInputs, Language } from "@/lib/types/project";

export type AreaCode =
  | "site_context"
  | "users_community"
  | "precedent_studies"
  | "socio_cultural"
  | "typology_limits";

export const AREAS: ReadonlyArray<{
  code: AreaCode;
  index: number; // 1..5
  ko: string; // ① 사이트 맥락
  en: string; // ① Site context
  guidanceKo: string;
  guidanceEn: string;
}> = [
  {
    code: "site_context",
    index: 1,
    ko: "① 사이트 맥락",
    en: "① Site context",
    guidanceKo:
      "사이트의 위치 · 지형 · 기후 · 법규 · 인프라 · 주변 시설 · 접근성 · 역사적 변화 등 물리적·제도적 맥락.",
    guidanceEn:
      "Site location, topography, climate, regulations, infrastructure, surrounding facilities, accessibility, historical change.",
  },
  {
    code: "users_community",
    index: 2,
    ko: "② 사용자 · 커뮤니티",
    en: "② Users · community",
    guidanceKo:
      "잠재 사용자 그룹의 인구통계, 행태, 요구, 갈등, 커뮤니티 자산과 결핍.",
    guidanceEn:
      "Potential user demographics, behaviors, needs, tensions, community assets and gaps.",
  },
  {
    code: "precedent_studies",
    index: 3,
    ko: "③ 선례 분석",
    en: "③ Precedent studies",
    guidanceKo:
      "유사 유형 · 유사 규모의 국내외 선례 3–5개. 성공/실패 요인, 프로그램 구성, 공간 전략을 비교.",
    guidanceEn:
      "3–5 domestic & international precedents of similar typology/scale. Compare success/failure factors, program mix, spatial strategies.",
  },
  {
    code: "socio_cultural",
    index: 4,
    ko: "④ 사회·문화적 이슈",
    en: "④ Socio-cultural issues",
    guidanceKo:
      "이 프로젝트가 놓이는 사회적 · 문화적 · 정치적 · 경제적 흐름과 논쟁 지점.",
    guidanceEn:
      "Social, cultural, political, economic currents and points of debate this project sits within.",
  },
  {
    code: "typology_limits",
    index: 5,
    ko: "⑤ 유형의 한계",
    en: "⑤ Typology limits",
    guidanceKo:
      "이 공간 유형이 일반적으로 다루지 못하는 문제, 비판, 대안적 유형.",
    guidanceEn:
      "Problems this typology typically fails to address, critiques, alternative typologies.",
  },
];

export function visibleTitle(area: AreaCode, language: Language): string {
  const a = AREAS.find((x) => x.code === area);
  if (!a) return area;
  return language === "ko" ? a.ko : a.en;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk-call schema/builders — used for Anthropic & Gemini, which reliably
// produce all 5 prompts in a single response.
// ─────────────────────────────────────────────────────────────────────────────

const BULK_PROMPT_ITEM = {
  type: "object",
  required: ["title", "body"],
  properties: {
    title: { type: "string" },
    body: { type: "string" },
  },
} as const;

export const PHASE1_BULK_SCHEMA = {
  type: "object",
  required: ["language", "prompts", "uploadScaffold"],
  properties: {
    language: { type: "string", enum: ["ko", "en"] },
    prompts: {
      type: "object",
      required: [
        "site_context",
        "users_community",
        "precedent_studies",
        "socio_cultural",
        "typology_limits",
      ],
      properties: {
        site_context: BULK_PROMPT_ITEM,
        users_community: BULK_PROMPT_ITEM,
        precedent_studies: BULK_PROMPT_ITEM,
        socio_cultural: BULK_PROMPT_ITEM,
        typology_limits: BULK_PROMPT_ITEM,
      },
    },
    uploadScaffold: { type: "string" },
  },
} as const;

export function buildPhase1BulkSystem(): string {
  return `${SKILL_MD}

---

You are now executing the architectural-research-brief skill — Phase 1 (Intake & Prompt Generation).

Follow the Phase 1 rules exactly as written in the skill above:
- Produce all 5 research prompts in the fixed order: ① 사이트 맥락, ② 사용자 · 커뮤니티, ③ 선례 분석, ④ 사회·문화적 이슈, ⑤ 유형의 한계 (or English equivalents if language=en).
- Each prompt must be self-contained, 4–8 sentences, cap sub-items at 4.
- Every prompt MUST include the two source-quality requirements at the end (1차 자료 우선, URL/DOI 포함).
- Append the per-area boundary clause at the very end of each prompt body, as specified.
- For prompts with quantitative claims, also include the numerical source requirement.
- Generate an "uploadScaffold" string — the markdown template the user pastes external AI results into.
- Mirror the user's language (ko if Korean input detected, otherwise en).
- Return ONLY the JSON conforming to the schema. No prose outside JSON.`;
}

export function buildPhase1BulkUser(
  inputs: ProjectInputs,
  language: Language,
): string {
  const lines = [
    `Language: ${language}`,
    `Site: ${inputs.site}`,
    `Typology / Space type: ${inputs.typology}`,
  ];
  if (inputs.scale) lines.push(`Scale: ${inputs.scale}`);
  if (inputs.client) lines.push(`Client/Owner: ${inputs.client}`);
  if (inputs.constraints)
    lines.push(`Known constraints: ${inputs.constraints}`);

  return `Generate the 5 Phase-1 research prompts for this project.

${lines.join("\n")}

Return JSON with keys: language, prompts, uploadScaffold.

"prompts" is an OBJECT with EXACTLY these 5 keys (each is required, write a distinct prompt for each):
- site_context        → ① 사이트 맥락
- users_community     → ② 사용자 · 커뮤니티
- precedent_studies   → ③ 선례 분석
- socio_cultural      → ④ 사회·문화적 이슈
- typology_limits     → ⑤ 유형의 한계

Each value is an object { title, body }. "title" is the visible header (e.g. "① 사이트 맥락" — exact form, no extra wording). "body" is the full prompt text the user will copy-paste into an external research AI.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-area schema/builders — used for Ollama, which is unreliable when asked
// to produce all 5 prompts in one shot. We call the model 5 times with a
// focused, body-only schema.
// ─────────────────────────────────────────────────────────────────────────────

export const PHASE1_AREA_SCHEMA = {
  type: "object",
  required: ["body"],
  properties: {
    body: { type: "string" },
  },
} as const;

export function buildPhase1AreaSystem(): string {
  return `${SKILL_MD}

---

You are now executing the architectural-research-brief skill — Phase 1 (Intake & Prompt Generation).

You will be asked to generate ONE research prompt for ONE specific area. Follow the Phase 1 rules from the skill above:
- The "body" must be self-contained, 4–8 sentences, cap sub-items at 4.
- The "body" MUST end with the two source-quality requirements (1차 자료 우선, URL/DOI 포함).
- Append the per-area boundary clause at the very end of the body, as specified in the skill.
- If the area asks about quantitative claims, include the numerical source requirement.
- Mirror the user's language (ko or en) exactly.
- Return ONLY a JSON object { "body": "..." }. No prose outside JSON, no other keys.`;
}

export function buildPhase1AreaUser(
  inputs: ProjectInputs,
  language: Language,
  area: (typeof AREAS)[number],
): string {
  const lines = [
    `Language: ${language}`,
    `Site: ${inputs.site}`,
    `Typology / Space type: ${inputs.typology}`,
  ];
  if (inputs.scale) lines.push(`Scale: ${inputs.scale}`);
  if (inputs.client) lines.push(`Client/Owner: ${inputs.client}`);
  if (inputs.constraints)
    lines.push(`Known constraints: ${inputs.constraints}`);

  const guidance = language === "ko" ? area.guidanceKo : area.guidanceEn;

  return `Generate the Phase-1 research prompt for ONE area only:

Area code: ${area.code}
Area focus: ${guidance}

Project context:
${lines.join("\n")}

Return JSON: { "body": "<full prompt text the user will copy-paste into an external research AI>" }.

The "body" must be a complete, standalone research prompt — written in ${language === "ko" ? "Korean" : "English"} — that an external AI can act on without any other context. Do NOT include the area title or any header inside the body; just the prompt content itself.`;
}

// Deterministic upload scaffold — no LLM needed.
export function buildUploadScaffold(language: Language): string {
  const header =
    language === "ko"
      ? "# Phase 1 외부 리서치 결과\n\n각 영역 헤더 아래에 외부 AI 결과를 붙여넣어 주세요. 출처는 URL/DOI 와 함께 남겨 주세요.\n"
      : "# Phase 1 — External research results\n\nPaste each external AI's output beneath its area header. Keep URLs/DOIs alongside claims.\n";
  const sections = AREAS.map((a) => {
    const t = language === "ko" ? a.ko : a.en;
    return `\n## ${t}\n\n<!-- paste here -->\n`;
  }).join("");
  return header + sections;
}
