import {
  Finding,
  FindingSource,
  Pattern,
  Project,
  ResearchArea,
  SourceConfidence,
  getActiveConcept,
} from "@/lib/types/project";
import { areaLabel } from "./areaLabels";

const AREA_ORDER: ResearchArea[] = [
  "site_context",
  "users_community",
  "precedent_studies",
  "socio_cultural",
  "typology_limits",
];

/**
 * Generate a deterministic, machine-readable Markdown report from project
 * state. NO LLM call. Designed to be ingested as context by other skills /
 * webapps — every section has stable headers, every datum is captured
 * verbatim, no summarization or interpretation.
 */
export function generateReport(project: Project): string {
  const out: string[] = [];

  out.push(buildFrontMatter(project));
  out.push("");
  out.push(buildInputsSection(project));
  out.push("");
  out.push(buildProblemStatementSection(project));
  out.push("");
  if (getActiveConcept(project)) {
    out.push(buildConceptSection(project));
    out.push("");
  }
  if (project.phase2B) {
    out.push(buildPatternsSection(project, project.phase2B.patterns));
    out.push("");
    out.push(
      buildFindingsSection(project, project.phase2B.findings, project.language),
    );
    out.push("");
    out.push(buildSourceIndex(project.phase2B.findings));
    out.push("");
  }
  return out.join("\n").replace(/\n{4,}/g, "\n\n\n") + "\n";
}

// ---- sections ----

function buildFrontMatter(p: Project): string {
  const finalPS = p.finalPS ?? "";
  const escaped = finalPS.replace(/\n/g, "\n  ");

  const patterns = p.phase2B?.patterns ?? [];
  const patternsYaml =
    patterns.length === 0
      ? "[]"
      : "\n" +
        patterns
          .map(
            (pat) =>
              `  - id: ${pat.id}\n    label: ${pat.label}\n    title: ${yamlEscape(pat.title)}`,
          )
          .join("\n");

  const lines = [
    "---",
    "schemaVersion: 1",
    "kind: architectural-research-brief",
    `generatedAt: ${new Date().toISOString()}`,
    "project:",
    `  id: ${p.id}`,
    `  language: ${p.language}`,
    `  site: ${yamlEscape(p.inputs.site)}`,
    `  typology: ${yamlEscape(p.inputs.typology)}`,
    p.inputs.scale ? `  scale: ${yamlEscape(p.inputs.scale)}` : null,
    p.inputs.client ? `  client: ${yamlEscape(p.inputs.client)}` : null,
    p.inputs.constraints
      ? `  constraints: ${yamlEscape(p.inputs.constraints)}`
      : null,
    "problemStatement: |",
    `  ${escaped}`,
    `patterns: ${patternsYaml}`,
    `findingsCount: ${p.phase2B?.findings.length ?? 0}`,
    "---",
  ].filter((x): x is string => x !== null);

  return lines.join("\n");
}

function buildInputsSection(p: Project): string {
  const lines = [
    "# Project Inputs",
    "",
    `- **Site**: ${p.inputs.site}`,
    `- **Typology**: ${p.inputs.typology}`,
  ];
  if (p.inputs.scale) lines.push(`- **Scale**: ${p.inputs.scale}`);
  if (p.inputs.client) lines.push(`- **Client**: ${p.inputs.client}`);
  if (p.inputs.constraints)
    lines.push(`- **Known constraints**: ${p.inputs.constraints}`);
  lines.push(`- **Language**: ${p.language}`);
  return lines.join("\n");
}

function buildProblemStatementSection(p: Project): string {
  if (!p.finalPS) {
    return "# Final Problem Statement\n\n_(미확정)_";
  }
  return `# Final Problem Statement\n\n> ${p.finalPS.replace(/\n/g, " ")}\n`;
}

function buildConceptSection(p: Project): string {
  const c = getActiveConcept(p);
  if (!c) return "";
  const out: string[] = [
    `# Design Concept (Phase 4) — ${c.name}`,
    "",
  ];
  out.push("## Parti");
  out.push("");
  out.push(c.parti ? `> ${c.parti.replace(/\n/g, " ")}` : "_(미작성)_");
  out.push("");
  out.push("## Concept Keywords");
  out.push("");
  out.push(
    c.keywords.length === 0
      ? "_(없음)_"
      : c.keywords.map((k) => `- ${k}`).join("\n"),
  );
  out.push("");
  out.push("## Spatial Strategies (Pattern → Strategy)");
  out.push("");
  if (c.spatialStrategies.length === 0) {
    out.push("_(없음)_");
  } else {
    out.push("| Pattern | Strategy |");
    out.push("|---------|----------|");
    for (const s of c.spatialStrategies) {
      out.push(
        `| ${escapePipe(s.patternTitle)} | ${escapePipe(s.strategy || "—")} |`,
      );
    }
  }
  out.push("");
  out.push("## Materiality & Atmosphere");
  out.push("");
  out.push(c.materiality ? c.materiality : "_(미작성)_");
  out.push("");
  out.push("## Scene Anchors");
  out.push("");
  out.push(
    c.sceneAnchors.length === 0
      ? "_(없음)_"
      : c.sceneAnchors.map((a) => `- ${a}`).join("\n"),
  );
  return out.join("\n");
}

function buildPatternsSection(p: Project, patterns: Pattern[]): string {
  if (patterns.length === 0) return "# Cross-cutting Patterns\n\n_(없음)_";
  const out: string[] = ["# Cross-cutting Patterns", ""];
  for (const pat of patterns) {
    out.push(`## Pattern ${pat.label} — ${pat.title}`);
    out.push("");
    out.push(`- **id**: \`${pat.id}\``);
    out.push(`- **Contributing findings**: ${pat.findingIds.join(", ")}`);
    out.push("");
    out.push(pat.rationale);
    out.push("");
  }
  return out.join("\n").trimEnd();
}

function buildFindingsSection(
  p: Project,
  findings: Finding[],
  language: "ko" | "en",
): string {
  const out: string[] = ["# Findings by Area", ""];
  const grouped = new Map<ResearchArea, Finding[]>();
  AREA_ORDER.forEach((a) => grouped.set(a, []));
  findings.forEach((f) => grouped.get(f.area)?.push(f));

  for (const area of AREA_ORDER) {
    const list = grouped.get(area) ?? [];
    out.push(`## ${areaLabel(area, language)} (\`${area}\`)`);
    out.push("");
    if (list.length === 0) {
      out.push("_(이 영역의 finding 없음)_");
      out.push("");
      continue;
    }
    for (const f of list) {
      out.push(`### \`${f.id}\` — ${f.headline}`);
      out.push("");
      out.push(`- **Confidence**: \`[${f.confidence}]\``);
      out.push(
        `- **Patterns**: ${f.patternIds.length === 0 ? "_(없음)_" : f.patternIds.map((pid) => `${labelOfPattern(pid)} (${pid})`).join(", ")}`,
      );
      out.push("");
      out.push(f.detail);
      out.push("");
      if (f.sources.length > 0) {
        out.push("**Sources:**");
        for (const s of f.sources) {
          out.push(`- ${formatSource(s)}`);
        }
        out.push("");
      }
    }
  }
  // strip trailing blank
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

function buildSourceIndex(findings: Finding[]): string {
  // Dedupe by name+url, accumulate cited-by
  type Entry = {
    name: string;
    url?: string;
    confidences: Set<SourceConfidence>;
    citedBy: string[];
  };
  const map = new Map<string, Entry>();
  for (const f of findings) {
    for (const s of f.sources) {
      const key = `${s.name}|${s.url ?? ""}`;
      let e = map.get(key);
      if (!e) {
        e = {
          name: s.name,
          url: s.url,
          confidences: new Set<SourceConfidence>(),
          citedBy: [],
        };
        map.set(key, e);
      }
      e.confidences.add(f.confidence);
      e.citedBy.push(f.id);
    }
  }
  if (map.size === 0) return "# Source Index\n\n_(출처 인용 없음)_";

  const rows = Array.from(map.values());
  const out: string[] = ["# Source Index", ""];
  out.push("| # | Source | URL | Confidence (any) | Cited by |");
  out.push("|---|--------|-----|------------------|----------|");
  rows.forEach((e, i) => {
    const url = e.url ? e.url : "—";
    const conf = Array.from(e.confidences).join(", ");
    out.push(
      `| ${i + 1} | ${escapePipe(e.name)} | ${escapePipe(url)} | ${conf} | ${e.citedBy.join(", ")} |`,
    );
  });
  return out.join("\n");
}

// ---- helpers ----

function formatSource(s: FindingSource): string {
  if (s.url) return `[${s.name}](${s.url})`;
  return s.name;
}

function labelOfPattern(pid: string): string {
  const map: Record<string, string> = { p1: "A", p2: "B", p3: "C", p4: "D" };
  return map[pid] ?? pid;
}

function yamlEscape(s: string): string {
  // Quote if special chars or starts with reserved YAML token
  if (/^[\s'"#&*!|>%@`]|: |\n/.test(s) || s.includes('"')) {
    return `"${s.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }
  return s;
}

function escapePipe(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
