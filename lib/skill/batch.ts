import { ConceptStructure } from "@/lib/types/project";

/**
 * Batch generation (P4→P5 일괄 생성) — markdown renderers for the on-disk
 * files. Concept generation reuses the robust stepwise Phase 4 pipeline
 * (see app/api/batch/concept/route.ts) and prompts reuse the Phase 5 prompt
 * route, so no fragile single-call nested-JSON builders live here (Ollama
 * degenerates on big nested schemas — same lesson as lib/skill/phase4.ts).
 */

export function renderConceptMd(
  concept: ConceptStructure,
  meta: { projectTitle: string; index: number; finalPS: string },
): string {
  const idx = String(meta.index).padStart(3, "0");
  const lines: string[] = [];
  lines.push(`# 컨셉 ${idx} — ${meta.projectTitle}`);
  lines.push("");
  lines.push(`_생성: ${new Date().toLocaleString()}_`);
  lines.push("");
  lines.push("## Problem Statement");
  lines.push("");
  lines.push(`> ${meta.finalPS}`);
  lines.push("");
  lines.push("## 파르티 (Parti)");
  lines.push("");
  lines.push(concept.parti || "(없음)");
  lines.push("");
  lines.push("## 개념 키워드");
  lines.push("");
  lines.push(
    concept.keywords.length
      ? concept.keywords.map((k) => `- ${k}`).join("\n")
      : "(없음)",
  );
  lines.push("");
  lines.push("## 공간 전략 (패턴 → 전략)");
  lines.push("");
  const strat = concept.spatialStrategies.filter((s) => s.strategy.trim());
  lines.push(
    strat.length
      ? strat.map((s) => `- **${s.patternTitle}** — ${s.strategy}`).join("\n")
      : "(없음)",
  );
  lines.push("");
  lines.push("## 재료 · 분위기");
  lines.push("");
  lines.push(concept.materiality || "(없음)");
  lines.push("");
  lines.push("## 장면 단서");
  lines.push("");
  lines.push(
    concept.sceneAnchors.length
      ? concept.sceneAnchors.map((a) => `- ${a}`).join("\n")
      : "(없음)",
  );
  lines.push("");
  return lines.join("\n");
}

export function renderPromptsMd(
  prompts: { role: string; prompt: string }[],
  concept: ConceptStructure,
): string {
  const lines: string[] = [];
  lines.push("# 이미지 프롬프트");
  lines.push("");
  lines.push(`_파르티: ${concept.parti || "(없음)"}_`);
  lines.push("");
  lines.push(
    "각 프롬프트당 2장씩 생성되었습니다 (외관 1 · 내부 3 = 4 프롬프트, 총 8장).",
  );
  lines.push("");
  for (const p of prompts) {
    lines.push(`## ${p.role}`);
    lines.push("");
    lines.push("```");
    lines.push(p.prompt);
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}
