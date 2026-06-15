import {
  ConceptStructure,
  Language,
  Pattern,
  ProjectInputs,
} from "@/lib/types/project";

/**
 * Phase 4 — Concept structuring as a stepwise wizard. Each step asks the LLM
 * for a few candidates; the user picks one (or edits / re-rolls). Every step
 * is conditioned on the previously chosen items so the concept stays coherent.
 *
 * To keep the JSON schema robust for small/local models (Ollama lesson), every
 * step uses the SAME shape: { "candidates": string[] }. For multi-value steps
 * (keywords, sceneAnchors) each candidate string is a comma-separated set the
 * UI splits on selection.
 */

export type Phase4StepKind =
  | "parti"
  | "keywords"
  | "strategy"
  | "materiality"
  | "sceneAnchors";

export const PHASE4_STEP_SCHEMA = {
  type: "object",
  required: ["candidates"],
  properties: {
    candidates: { type: "array", items: { type: "string" } },
  },
} as const;

export type Phase4StepContext = {
  inputs: ProjectInputs;
  language: Language;
  patterns: Pattern[];
  finalPS: string;
  /** Choices made in earlier steps (partial concept). */
  prior: Partial<ConceptStructure>;
  /** For step "strategy": the pattern this sub-step is solving. */
  pattern?: Pattern;
  /** How many candidates to return. */
  count: number;
};

const STEP_GOAL: Record<Phase4StepKind, string> = {
  parti:
    'Each candidate is ONE design "parti" — a 1–2 sentence design thesis that DIRECTLY answers the Problem Statement (the core organizing idea, not a restatement of the problem).',
  keywords:
    "Each candidate is ONE keyword set: 3–6 short concept keywords or a guiding metaphor, comma-separated in a single string (e.g. \"켜켜이 쌓인 마당, 느린 빛, 도시적 틈\"). The keywords MUST be derived from and express the chosen parti.",
  strategy:
    "Each candidate is ONE concrete spatial / organizing move (massing, section, circulation, threshold, structure) that resolves the GIVEN pattern. One sentence, architectural and specific — not an abstract goal. It MUST embody the chosen parti and the chosen keywords.",
  materiality:
    "Each candidate is ONE materiality+atmosphere description: material palette, light quality, tactility and mood in 1–2 sentences. It MUST reinforce the chosen parti, keywords and the spatial strategies already chosen.",
  sceneAnchors:
    "Each candidate is ONE set of 4–7 concrete visual elements an image MUST show, comma-separated in a single string (tangible nouns/scenes, not adjectives). They MUST visually express the chosen parti, keywords, spatial strategies and materiality.",
};

// What each step must build on. Foregrounded so weak models don't ignore it.
const STEP_DEPENDS: Record<Phase4StepKind, string> = {
  parti:
    "This is the FIRST step. Ground each parti in the Problem Statement and the cross-cutting patterns.",
  keywords:
    "BUILD ON the chosen parti above. Every keyword set must be a direct distillation of that specific parti — NOT generic architecture words. If a candidate would fit any project, it is wrong.",
  strategy:
    "BUILD ON the chosen parti and keywords above. Each strategy must read as a concrete spatial consequence of THAT parti expressed through THOSE keywords, while resolving the target pattern.",
  materiality:
    "BUILD ON the chosen parti, keywords and spatial strategies above. The materiality must be the tactile/atmospheric expression of exactly those decisions.",
  sceneAnchors:
    "BUILD ON every earlier choice above (parti, keywords, strategies, materiality). The anchors must be the literal visual payoff of those specific decisions.",
};

export function buildPhase4StepSystem(step: Phase4StepKind): string {
  return `You are an architectural concept strategist helping a designer build a design concept STEP BY STEP. Earlier steps are already decided. Treat the designer's earlier choices as FIXED, BINDING CONSTRAINTS — your candidates for this step must be a direct consequence of them. The Problem Statement and patterns are background; the earlier choices are the primary driver.

${STEP_GOAL[step]}

${STEP_DEPENDS[step]}

Rules:
- Return ONLY a JSON object: { "candidates": [ "...", "...", "..." ] }.
- Provide exactly the requested number of candidates. Make them genuinely DIFFERENT from each other (different design attitudes), not rephrasings — but ALL of them must obey the earlier choices.
- A candidate that ignores the earlier choices, or that could belong to a different project, is WRONG. Be specific. Do NOT invent real architect or brand names.
- Mirror the input language exactly (Korean in → Korean out). No prose or markdown outside the JSON.`;
}

function priorBlock(prior: Partial<ConceptStructure>): string {
  const lines: string[] = [];
  if (prior.parti) lines.push(`- Chosen parti: ${prior.parti}`);
  if (prior.keywords && prior.keywords.length)
    lines.push(`- Chosen keywords: ${prior.keywords.join(", ")}`);
  if (prior.spatialStrategies && prior.spatialStrategies.length) {
    const done = prior.spatialStrategies.filter((s) => s.strategy.trim());
    if (done.length)
      lines.push(
        `- Chosen spatial strategies so far:\n${done
          .map((s) => `  · [${s.patternTitle}] ${s.strategy}`)
          .join("\n")}`,
      );
  }
  if (prior.materiality)
    lines.push(`- Chosen materiality: ${prior.materiality}`);
  if (prior.sceneAnchors && prior.sceneAnchors.length)
    lines.push(`- Chosen scene anchors: ${prior.sceneAnchors.join(", ")}`);
  return lines.length
    ? `★ FIXED EARLIER CHOICES — your candidates MUST be a direct consequence of these ★\n${lines.join("\n")}`
    : "Earlier choices: (none yet — this is the first step)";
}

export function buildPhase4StepUser(
  step: Phase4StepKind,
  ctx: Phase4StepContext,
): string {
  const { inputs, language, patterns, finalPS, prior, pattern, count } = ctx;
  const patternLines =
    patterns.length === 0
      ? "(no cross-cutting patterns)"
      : patterns
          .map((p) => `- [${p.label}] ${p.title} — ${p.rationale}`)
          .join("\n");

  const stepTarget =
    step === "strategy" && pattern
      ? `\nTarget pattern to solve in THIS step:\n- [${pattern.label}] ${pattern.title} — ${pattern.rationale}`
      : "";

  return `Project context:
- Site: ${inputs.site}
- Typology: ${inputs.typology}
${inputs.scale ? `- Scale: ${inputs.scale}` : ""}
${inputs.constraints ? `- Known constraints: ${inputs.constraints}` : ""}
- Language: ${language}

Confirmed Problem Statement:
"${finalPS}"

${priorBlock(prior)}

— Background only (do NOT let these override the fixed choices above) —
Cross-cutting patterns:
${patternLines}
${stepTarget}

Produce ${count} distinct candidates for the "${step}" step. Each candidate MUST be a direct, recognizable consequence of the FIXED EARLIER CHOICES above. Return JSON: { "candidates": ["...", "...", "..."] }.`;
}

// Split a multi-value candidate string (keywords / sceneAnchors) into items.
export function splitCandidateList(s: string): string[] {
  return s
    .split(/[\n,;·]/)
    .map((x) => x.trim())
    .filter(Boolean);
}
