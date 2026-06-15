# Research Board Artifact — Layout & Interactivity Spec

This is the spec for the Phase 3 deliverable. Build a **single-file HTML** artifact (vanilla HTML/CSS/JS, no build step, no external libraries except optionally Tailwind via CDN). Save to `/mnt/user-data/outputs/research_board.html`.

## Overall layout (1-page, scrollable but designed to fit 1440×900 ideally)

```
┌──────────────────────────────────────────────────────────────┐
│  HEADER                                                      │
│    리서치 보드 (large title)                                 │
│    Site · Typology · Date (small, muted)                     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  LEFT 60% — RESEARCH BOARD (5 cards + 1 summary, 2x3 grid)   │
│  ┌─────────┐ ┌─────────┐                                     │
│  │ Site    │ │ Users   │   Each research card:               │
│  │ Context │ │ &       │   - Title + small icon              │
│  │         │ │ Comm.   │   - 3-5 key findings (clickable)    │
│  └─────────┘ └─────────┘   - Hover/click expands detail      │
│  ┌─────────┐ ┌─────────┐                                     │
│  │Precedent│ │ Socio-  │                                     │
│  │ Studies │ │ Cultural│                                     │
│  └─────────┘ └─────────┘                                     │
│  ┌─────────┐ ┌─────────┐                                     │
│  │Typology │ │ Project │ ← Summary card (6th slot)           │
│  │ Limits  │ │ Snapshot│   - Site/typology recap             │
│  └─────────┘ └─────────┘   - Finding·pattern·source counts   │
│                            - Source-confidence bar (1차/2차) │
│                                                              │
│  RIGHT 40% — FUNNEL (vertical, sticky on scroll)             │
│  ┌────────────────────────┐                                  │
│  │  Findings (count: N)   │ ← widest                         │
│  └────────────────────────┘                                  │
│           ▼                                                  │
│      ┌──────────────┐                                        │
│      │  Patterns    │                                        │
│      │  (2-4)       │ ← narrower                             │
│      └──────────────┘                                        │
│              ▼                                               │
│         ┌─────────┐                                          │
│         │ Problem │ ← narrowest, highlighted                 │
│         │Statement│                                          │
│         └─────────┘                                          │
└──────────────────────────────────────────────────────────────┘
```

## Header block

The header is a single horizontal strip at the top, separated from the main body by a hairline. It has two tiers, in this order:

- **Primary title (largest text on the page):** The deliverable name — `리서치 보드` (Korean) or `Research Board` (English). This is *constant* across every project that uses this skill. Do NOT substitute the project name, site name, or typology into this slot.
- **Metadata line (beneath the title, muted and smaller):** A single line combining `Site · Typology · Date`, in that order. Example: `서울 종로구 지봉로13길 82 · 마을 도서관 + 수직 정원 · 2026-04-19`. Use middle-dot separators, muted color, sans font at ~0.82rem.

**Do NOT place any of the following in the header:** phase labels (`Phase 2-B Synthesis`, `Phase 3` etc.), version numbers, workflow-state badges, synthesis-stage indicators, or any text implying the board shows only a partial slice of the research. The board always represents the *final, integrated state* of Phase 2-B synthesis — labeling the header with a phase name misleads reviewers into thinking it shows only content added during that phase. If the generator wants to surface the synthesis date for versioning, the `Date` in the metadata line is the only acceptable location.

**Project Snapshot card (required):** Always fill the 6th grid cell with an auto-generated summary card so the 2×3 grid reads as complete. Content: site, typology, # of research areas, # of findings, # of patterns, # of source citations, and a horizontal stacked bar showing the source-confidence distribution (1차/2차/미확인 counts + percentages). This doubles as a trust indicator for reviewers.

## Required interactivity

1. **Finding → Pattern linking.** When the user clicks (or hovers) a finding in any board card, the pattern(s) in the funnel that it contributed to should highlight (e.g. colored border or background tint). Implement this by tagging each finding with the IDs of the patterns it supports (`data-patterns="p1,p3"`), and each pattern with its own ID. On hover/click of a finding, query and highlight matching patterns. Reverse direction also: hovering a pattern highlights contributing findings.

2. **Pattern → Problem Statement linking.** Same mechanic between patterns and the final Problem Statement — hovering the Problem Statement softly highlights all patterns; hovering a pattern highlights the Problem Statement. Use a stronger visual cue here since this is the final reasoning step.

3. **Card expansion.** Each board card shows finding titles by default; clicking a finding expands an inline block containing all of:
   - A 1–2 sentence elaboration (the finding's `detail`).
   - A **per-finding source list** — rendered from the finding's `sources` array. Each entry shows the source name; if a `url` is present, the name becomes a clickable link with `target="_blank" rel="noopener"`. Render as a compact inline list separated by middle-dots `·`, or as small pill badges. This is the primary place a user verifies a finding's provenance, so it must be present in every expanded detail — do not omit it even if the source is already mentioned in the detail prose.
   - The source-confidence tag (`[1차]` / `[2차]` / `[미확인]`) — one tag, covering the overall finding.
   - Pattern references (`→ 패턴 A, C`) — letter labels only.

   The per-finding source list rendered here is **distinct from, and denser than**, the area-level source summary in the Markdown report. It is inline, immediate, and clickable — the artifact's main mechanism for letting reviewers drill from a headline claim to its citation in one tap.

4. **Print-friendly.** Add a `@media print` block that flattens the layout to a single column and expands all findings, so the user can save as PDF for reviews.

## Pattern labeling convention

Internal vs. visible labels are always separate:

- **Data structure / code only:** `p1`, `p2`, `p3`, `p4` — as object keys, `data-pattern-id` attributes, array entries, and any non-visible identifier.
- **All user-visible text:** **패턴 A / B / C / D** (Korean) or **Pattern A / B / C / D** (English), matching the user's language. Mapping is positional: `p1 → A, p2 → B, p3 → C, p4 → D`.

This applies to every visible surface in the artifact: card finding pattern links, funnel pattern-list items, pattern headers, contributor lists, Problem Statement hover tooltips, and anywhere else a pattern is referenced for the user to read. Keep this consistent with the Markdown report so HTML and `.md` read with identical labels.

## Funnel sizing — two-layer narrowing

Achieve the funnel's visual narrowing with **two layered techniques** so neither does extreme work alone. Using only `clip-path` to go from 100% → 70% across three stages forces insets of 15%+, which in turn forces text padding of 18%+, which produces a cramped pillar of text and frequent overflow bugs. The fix is to split the narrowing work.

### Layer 1 — Wrapper max-width (does most of the narrowing)

Each stage sits inside a wrapper `<div>` with a progressively smaller `max-width`, centered with `margin: 0 auto`. Target wrapper widths as a % of the funnel column:

| Stage | 2 patterns | 3 patterns | 4 patterns |
|---|---|---|---|
| Findings (top) | 100% | 100% | 100% |
| Patterns (middle) | 80% | 88% | 90% |
| Problem Statement (bottom) | 68% | 70% | 72% |

The Problem Statement wrapper width stays roughly constant regardless of pattern count — it is always the visual focal point. The Patterns wrapper widens as pattern count grows so the pattern list doesn't look cramped.

### Layer 2 — Gentle trapezoid clip-path (adds the funnel *feel*)

Inside each wrapper, the stage's `::before` pseudo-element draws a trapezoid with **side insets capped at 6%**. Example clip-paths:

- Findings: `polygon(0 0, 100% 0, 96% 100%, 4% 100%)` — 4% bottom inset
- Patterns: `polygon(4% 0, 96% 0, 94% 100%, 6% 100%)` — 6% max inset
- Problem Statement: `polygon(6% 0, 94% 0, 94% 100%, 6% 100%)` — near-rectangle (wrapper already narrow)

Do NOT push insets above 6% even if a stage "looks rectangular" on its own. The wrapper width is already doing the narrowing work; the clip-path only contributes the trapezoidal feel. Stages *together* — not individually — produce the visible funnel.

### Non-negotiable text padding rule

The stage's text-content area must have **horizontal padding at least 3 percentage points greater than the largest clip-path inset on that stage**, in the same unit. With the 6% cap above, this means padding: 9% or more on every stage.

This rule is the single most common source of rendering bugs. Violating it causes text to spill past the trapezoid's visible edge — technically the text isn't clipped (because the clip-path is on `::before`, not the text container) but it crosses outside the colored trapezoid background, which reads as broken.

### Why the two-layer approach works

- **Wrapper width** does the heavy narrowing (100% → 90% → 70%) without touching text layout at all.
- **Clip-path** contributes only the angled sides that make the stages *read* as a funnel rather than a stack of rectangles. Because the insets are gentle, the text area inside each stage stays wide and comfortable.
- **Padding** only needs to clear the gentle clip-path insets, not the full narrowing, so it stays small and text doesn't get pushed into a vertical column.

## Styling guidance

- **Aesthetic:** architectural studio / pre-design board. Off-white background (`#f5f3ee` or similar), thin hairline borders (1px, low-contrast gray), a single accent color the user can change (default: muted terracotta `#b5533c` or ink blue `#2c3e50`).
- **Typography:** use a serif for headings (e.g. `"Crimson Pro", "Noto Serif KR", serif` so Korean renders well) and a sans for body (e.g. `"Inter", "Noto Sans KR", sans-serif`). Pull from Google Fonts.
- **Funnel shape:** real trapezoids using CSS `clip-path: polygon(...)`, NOT just stacked rectangles. The narrowing must be visually obvious. See the "Funnel sizing" section above for the required two-layer (wrapper + clip-path) approach and exact sizing rules.
- **CRITICAL — clip-path text clipping bug:** `clip-path` clips ALL contents including text, not just the background. NEVER apply clip-path directly to a container that holds text. Instead, draw the trapezoid via a `::before` pseudo-element (positioned absolute, `inset: 0`, `z-index: 0`) and place the text content in a sibling/child wrapper with `z-index: 1`. Even with that structure, respect the padding rule in the "Funnel sizing" section — padding ≥ largest inset + 3 percentage points, expressed in the same unit.
- **Connecting lines** between funnel stages are nice if simple — use SVG or CSS pseudo-elements.
- **Density over decoration.** No gradients, no shadows beyond a single subtle one. Information density matters more than polish.

## Footer note (tag legend)

Below the main board, add a single footer strip explaining the source-confidence tag convention. The tags appear on every finding, so users need a visible legend to decode them without scrolling away.

Required content (brief):
- Small colored pill/badge for each of `[1차]`, `[2차]`, `[미확인]`, each followed by a one-phrase definition.
- Optionally one sentence of interaction hint (e.g. "발견을 클릭하면 해당 패턴과 Problem Statement가 함께 하이라이트됨").

Layout rules — this is where most implementations break:
- Wrap each `tag-pill + definition` as **one atomic inline-flex unit** (or equivalent: a `<span>` with `display: inline-flex; align-items: baseline; gap: 0.3rem; white-space: nowrap;`). The pill and its definition must stay on the same visual line; never let a single tag's definition wrap onto a second line.
- Allow the three units themselves to wrap between each other as container width shrinks (they can stack vertically on narrow screens), but each unit stays atomic.
- Use a middle-dot `·` or similar separator between units so they read as a list, not a paragraph.
- Muted color, small font (~0.7rem), sit below the main board separated by a hairline.

A common wrong pattern is to write the legend as flowing prose with `<span>` tags for the pills but no `white-space: nowrap` — which causes the text after a pill to wrap independently of the pill, splitting a single definition across lines.

## Data structure

Embed the data as a JS object at the top of the `<script>` block so it's easy to inspect/edit:

```javascript
const data = {
  site: "...",
  typology: "...",
  date: "2026-04-15",
  areas: [
    {
      id: "site",
      title: "Site Context",
      findings: [
        { id: "f1", short: "...", detail: "...", source: "primary",
          sources: [{name: "통계청 전국사업체조사 (2023)"}, {name: "ArchDaily", url: "https://..."}],
          patterns: ["p1"] },   // internal IDs — convert to "패턴 A" etc. at render time
        ...
      ]
    },
    ... // 5 areas total
  ],
  patterns: [
    { id: "p1", title: "...", desc: "..." },   // rendered as "패턴 A" in all visible UI
    ...
  ],
  problemStatement: "..."
};
```

Then render the DOM from this object, applying the `p1 → A, p2 → B, p3 → C, p4 → D` mapping at the render step. This keeps the data self-documenting while ensuring all visible labels follow the letter convention.

## What to AVOID

- React, Vue, build tools, or anything that needs npm.
- localStorage / sessionStorage (not supported in Claude artifacts).
- Heavy animations or auto-playing transitions.
- Decorative imagery, stock photos, emoji as section icons (use simple SVG line icons or Korean/English text labels).
- Multi-page navigation. This is intentionally one page.
- Displaying `p1`, `p2`, etc. directly anywhere a user will read them. Always convert to the letter label first.
