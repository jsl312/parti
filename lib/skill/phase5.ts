import {
  ConceptParams,
  ConceptStructure,
  Language,
  Mood,
  Pattern,
  ProjectInputs,
  RenderStyle,
  ViewpointKind,
} from "@/lib/types/project";

export const PHASE5_PROMPT_SCHEMA = {
  type: "object",
  required: ["prompt"],
  properties: {
    prompt: { type: "string" },
  },
} as const;

const VIEWPOINT_LABEL_KO: Record<ViewpointKind, string> = {
  human_eye: "사람 눈높이 (휴먼 스케일)",
  aerial: "조감 (버드 아이)",
  section_perspective: "단면 투시 (sectional perspective)",
  interior_eye: "내부 눈높이 (interior eye-level)",
};

const VIEWPOINT_LABEL_EN: Record<ViewpointKind, string> = {
  human_eye: "human eye-level",
  aerial: "aerial / bird's-eye",
  section_perspective: "sectional perspective",
  interior_eye: "interior eye-level",
};

const MOOD_LABEL_KO: Record<Mood, string> = {
  cold_morning: "차가운 아침빛, 푸르스름한 그림자",
  overcast_afternoon: "흐린 오후, 무채색의 부드러운 빛",
  golden_hour: "해질 무렵 황금빛, 긴 그림자",
  blue_hour: "푸른 시간 (해진 직후), 따뜻한 인공조명 대비",
  night: "밤, 인공조명 중심, 깊은 어둠",
};

const MOOD_LABEL_EN: Record<Mood, string> = {
  cold_morning: "cold morning light, bluish shadows",
  overcast_afternoon: "overcast afternoon, soft achromatic light",
  golden_hour: "golden hour, long warm shadows",
  blue_hour: "blue hour just after sunset, warm artificial-light contrast",
  night: "night scene, artificial lighting, deep darkness",
};

const STYLE_LABEL_KO: Record<RenderStyle, string> = {
  photoreal:
    "실제 카메라로 찍은 사진 (자연광, 과장 없는 색·대비, 미세한 센서 노이즈, 사실적인 재질·흠집, CGI·렌더 느낌 배제)",
  watercolor: "수채화 (부드러운 번짐, 종이 질감)",
  bw_diagram: "흑백 다이어그램 (절제된 선과 톤, 분석적)",
  ink_sketch: "잉크 스케치 (손그림, 표현적인 선)",
  isometric_diagram: "아이소메트릭 다이어그램 (45° 등각, 평평한 색면)",
  clay_render: "클레이 렌더 (무광 회색 매스, 형태 강조)",
};

const STYLE_LABEL_EN: Record<RenderStyle, string> = {
  photoreal:
    "a real candid photograph (full-frame camera, 35mm lens, natural available light, true-to-life color and contrast, fine sensor grain, realistic imperfect surfaces — no CGI sheen)",
  watercolor: "watercolor (soft bleeds, paper texture)",
  bw_diagram: "black-and-white diagram (restrained lines and tones, analytical)",
  ink_sketch: "ink sketch (hand-drawn, expressive line)",
  isometric_diagram: "isometric diagram (45° axonometric, flat color planes)",
  clay_render: "clay render (matte grey masses, form-focused)",
};

export function viewpointLabel(v: string, lang: Language): string {
  const map = lang === "ko" ? VIEWPOINT_LABEL_KO : VIEWPOINT_LABEL_EN;
  return (map as Record<string, string>)[v] ?? v;
}
export function moodLabel(m: string, lang: Language): string {
  const map = lang === "ko" ? MOOD_LABEL_KO : MOOD_LABEL_EN;
  return (map as Record<string, string>)[m] ?? m;
}
export function styleLabel(s: string, lang: Language): string {
  const map = lang === "ko" ? STYLE_LABEL_KO : STYLE_LABEL_EN;
  return (map as Record<string, string>)[s] ?? s;
}

export const VIEWPOINTS: ViewpointKind[] = [
  "human_eye",
  "aerial",
  "section_perspective",
  "interior_eye",
];
export const MOODS: Mood[] = [
  "cold_morning",
  "overcast_afternoon",
  "golden_hour",
  "blue_hour",
  "night",
];
export const STYLES: RenderStyle[] = [
  "photoreal",
  "watercolor",
  "bw_diagram",
  "ink_sketch",
  "isometric_diagram",
  "clay_render",
];

/** Which image model the prompt is being written for — selects the photoreal
 *  guidance that suits that model's prompting behavior. */
export type ImageModelHint = "flux" | "zimage" | "generic";

// Flux (and generic SD-style models) over-saturate and look plasticky — fight
// the synthetic look with real-camera language + an explicit avoid-list.
const FLUX_REALISM_BLOCK = `PHOTOREALISM (when the render style is photographic / 사진):
- The "prompt" should be a single concise English string of 70–150 words.
- Describe the image AS A REAL PHOTOGRAPH actually taken on location — not a render. Name a plausible camera + lens + aperture (e.g. "shot on a full-frame mirrorless, 35mm f/2.8") and natural, available lighting (window light, overcast sky, practical lamps) rather than studio/"cinematic" lighting.
- Add subtle real-world imperfections that defeat the synthetic look: fine sensor grain, gentle lens vignetting, true-to-life (not boosted) color and contrast, shallow natural depth of field, slight wear/dust/fingerprints on materials, uneven hand-built surfaces, soft real shadows and bounce light.
- AVOID render/AI tells: do NOT use "hyperrealistic", "ultra-detailed", "8k", "octane", "unreal engine", "render", "masterpiece", "perfect", "flawless", over-glossy reflections, or symmetric/sterile perfection. Favor an ordinary, documentary, candid framing.`;

// Z-Image (strong Qwen text encoder, photoreal by default) rewards LONG,
// DETAILED, well-ordered natural-language description — not camera-jargon
// stacking or avoid-lists.
const ZIMAGE_REALISM_BLOCK = `PHOTOREALISM — Z-IMAGE (the target model is Z-Image, which has a strong text encoder and excels at long, detailed natural-language prompts):
- Write a RICH, DETAILED description, 120–220 words (longer than usual — Z-Image rewards specificity). Describe the space, its layout and proportions, the key objects/furniture, materials and their textures, the light source and exactly how light falls, the color palette, time of day, and any people or activity — concretely, in plain observant prose like a careful photo caption.
- Build it in a logical order: main subject & viewpoint → spatial composition → materials & surfaces → light & atmosphere → small telling details.
- Keep it true-to-life and photographic: natural / available light, realistic materials with genuine texture and subtle wear, believable scale and depth, soft real shadows. Z-Image is photorealistic by default, so DO NOT stack camera jargon or use "hyperrealistic / 8k / octane / unreal engine / render / masterpiece" buzzwords — clear, specific scene description is what produces realism.
- Write flowing prose, never keyword/tag soup or weight syntax.`;

export function buildPhase5PromptSystem(
  imageModel: ImageModelHint = "generic",
): string {
  const realism =
    imageModel === "zimage" ? ZIMAGE_REALISM_BLOCK : FLUX_REALISM_BLOCK;
  return `You are an architectural visualization prompt writer. You translate a structured design concept (parti, keywords, spatial strategies, materiality, scene anchors) plus three framing choices (viewpoint, time-of-day mood, rendering style) into ONE rich image-generation prompt suitable for Stable Diffusion / Flux / Z-Image / Imagen / gpt-image-1.

Rules:
- Output ONLY a single JSON object: { "prompt": "<the prompt>" }.
- The "prompt" is a single English string (image models work best in English). See the length guidance in the PHOTOREALISM block below.
- Lead with the subject and viewpoint. Then weave in: typology, the design concept (parti) made visual, the spatial strategies as built form, materiality/light, mood, and the scene anchors.
- The provided concept is the PRIMARY content source — prioritize parti, spatial strategies, materiality and scene anchors over generic guesses.
- Write flowing natural-language description (these models read prose, not tags). Do NOT use parameter syntax like "(weight:1.2)", comma-separated keyword soup, negative prompts, URLs, or the words "AI" / "generated".
- Do not invent specific brand names, addresses, or real architects' names not present in the input.

${realism}`;
}

export function buildPhase5PromptUser(
  inputs: ProjectInputs,
  language: Language,
  patterns: Pattern[],
  finalPS: string,
  params: ConceptParams,
  concept?: ConceptStructure,
): string {
  const vp = viewpointLabel(params.viewpoint, language);
  const md = moodLabel(params.mood, language);
  const st = styleLabel(params.style, language);
  const patternLines =
    patterns.length === 0
      ? "(no cross-cutting patterns)"
      : patterns
          .map((p) => `- ${p.label}. ${p.title} — ${p.rationale}`)
          .join("\n");
  const extras = params.extras?.trim();

  const conceptBlock = concept
    ? `Structured design concept (PRIMARY visual content):
- Parti: ${concept.parti || "(none)"}
- Keywords: ${concept.keywords?.length ? concept.keywords.join(", ") : "(none)"}
- Spatial strategies:
${
  concept.spatialStrategies?.length
    ? concept.spatialStrategies
        .map((s) => `  · [${s.patternTitle}] ${s.strategy}`)
        .join("\n")
    : "  (none)"
}
- Materiality / atmosphere: ${concept.materiality || "(none)"}
- Scene anchors: ${concept.sceneAnchors?.length ? concept.sceneAnchors.join("; ") : "(none)"}
`
    : "Structured design concept: (not provided — infer from patterns + PS)\n";

  return `Project context:
- Site: ${inputs.site}
- Typology: ${inputs.typology}
${inputs.scale ? `- Scale: ${inputs.scale}` : ""}
${inputs.constraints ? `- Constraints: ${inputs.constraints}` : ""}

${conceptBlock}
Cross-cutting patterns from the research:
${patternLines}

Confirmed Problem Statement:
"${finalPS}"

User's framing choices:
- Viewpoint: ${vp}
- Time / mood: ${md}
- Render style: ${st}
${extras ? `- Additional request: ${extras}` : ""}

Write a single English image-generation prompt that captures this project. Return JSON: { "prompt": "<your prompt>" }.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Image → concept feedback loop. The user reacts to a generated image in
// natural language ("emphasize this mood", "warmer", "drop this material") and
// we reverse-correct the concept's VISUAL-FACING fields (keywords, materiality,
// scene anchors) to steer the next render. Parti & spatial strategies stay
// intact so the design thesis is preserved.
// ─────────────────────────────────────────────────────────────────────────────

export const PHASE5_FEEDBACK_SCHEMA = {
  type: "object",
  required: ["materiality", "sceneAnchors", "rationale"],
  properties: {
    materiality: { type: "string" },
    sceneAnchors: { type: "array", items: { type: "string" } },
    rationale: { type: "string" },
  },
} as const;

export function buildFeedbackSystem(language: Language): string {
  const lang = language === "ko" ? "Korean" : "English";
  return `You refine a structured architectural design concept based on the user's reaction to a generated concept image. Your job is to REVERSE-CORRECT the concept's visual-facing fields so the NEXT image moves toward what the user wants.

Rules:
- Adjust ONLY these two fields: materiality and sceneAnchors.
- Do NOT touch keywords, parti, or spatial strategies — keep the design thesis and concept keywords intact.
- Return the FULL revised value of each field (not a diff). Preserve what already works; add, modify, or remove only to reflect the feedback.
- materiality: ONE rich sentence (palette · light · tactility · mood).
- sceneAnchors: 3–6 concrete visual elements an image must show.
- "rationale": 1–3 short sentences in ${lang} explaining what you changed and why, tied to the user's feedback.
- Output ONLY a JSON object conforming to the schema. No prose outside JSON.`;
}

export function buildFeedbackUser(
  language: Language,
  concept: Partial<ConceptStructure> | undefined,
  image: { prompt: string; params: ConceptParams },
  feedback: string,
): string {
  const vp = viewpointLabel(image.params.viewpoint, language);
  const md = moodLabel(image.params.mood, language);
  const st = styleLabel(image.params.style, language);
  const strategies = concept?.spatialStrategies?.length
    ? concept.spatialStrategies
        .map((s) => `  · [${s.patternTitle}] ${s.strategy}`)
        .join("\n")
    : "  (none)";
  return `Here is the current concept and the image the user is reacting to.

Current concept:
- Parti (KEEP, do not change): ${concept?.parti || "(none)"}
- Keywords: ${concept?.keywords?.length ? concept.keywords.join(", ") : "(none)"}
- Materiality / atmosphere: ${concept?.materiality || "(none)"}
- Scene anchors: ${concept?.sceneAnchors?.length ? concept.sceneAnchors.join("; ") : "(none)"}
- Spatial strategies (KEEP, do not contradict):
${strategies}

The generated image was rendered with:
- Viewpoint: ${vp}
- Time / mood: ${md}
- Render style: ${st}
- Image prompt used: "${image.prompt}"

User's feedback on this image:
"${feedback}"

Revise keywords, materiality, and sceneAnchors to steer the next image toward this feedback. Return JSON: { "keywords": [...], "materiality": "...", "sceneAnchors": [...], "rationale": "..." }.`;
}
