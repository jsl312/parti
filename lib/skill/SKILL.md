---
name: architectural-research-brief
description: 'Guides a 3-phase architectural pre-design research workflow that turns a site + space typology into a single-sentence Problem Statement, then produces both an interactive HTML Research Board (with reasoning funnel) and a full Markdown (.md) report showing how the Problem Statement was derived. Use this skill ANY time the user mentions architectural site research, pre-design analysis, problem framing for a building/space project, design brief development, studio project setup, or provides a site + program type (e.g. "성수동 골목 + 카페", "Hongdae + co-working space", "site X for a library"). Also trigger when the user wants to develop a Problem Statement, design thesis, or design rationale for an architectural project. Token-efficient by design — this skill generates prompts for the user to run on external research AIs (Perplexity, ChatGPT Deep Research, Gemini) rather than searching itself.'
---

# Architectural Research Brief

This skill walks a designer through pre-design research and produces:
1. A single-sentence **Problem Statement**
2. An **interactive HTML artifact** (1-page Research Board with internal Funnel) showing how the Problem Statement was derived.
3. A **Markdown report** (.md) with full detail — findings, sources, patterns, derivation logic.

Language: mirror the user's language. If the user writes in Korean, all prompts and the artifact UI text should be in Korean. Otherwise English.

---

## The 3 Phases

The workflow has three distinct phases. Phase 2 has two sub-phases (2-A Pre-synthesis Review, 2-B Main Synthesis) — do not skip or merge them. Always tell the user which phase you are entering and wait for the required input before proceeding.

### Phase 1 — Intake & Prompt Generation

**Inputs required from the user:**
- **Site** — location, ideally specific (e.g. "서울 성수동 연무장길 중간 골목 코너"). If vague, ask for one clarifying detail (neighborhood, city, or a known landmark).
- **Space type / Program** — e.g. 카페, 도서관, 코워킹, 커뮤니티 센터, 갤러리.

**Optional but useful:** project scale, client/owner, any constraint the user already knows.

**Default time frame — do not ask.** If the user doesn't explicitly specify a project timeline or phase, assume the site's current state as of the moment the skill is used. Do NOT ask the user to choose between "before / after / during" an in-progress policy or redevelopment. Even if pending policies or redevelopment plans exist at the site, do not assume their completed state as the design premise. Any such policy/decision should be treated as one contextual finding among others (usually landing in ① 사이트 맥락 or ④ 사회·문화적 이슈), not as a precondition the user must decide upfront.

**Output of Phase 1:** Five research prompts, one per research area, formatted so the user can copy-paste each into an external research AI. Each prompt should:
- Be self-contained (the external AI won't have the conversation context).
- Specify the site and space type explicitly.
- Ask for sources/citations where possible.
- Request structured output (bullet points, key findings) to make Phase 2 synthesis easier.
- Be 4–8 sentences long. Long enough to be specific, short enough to paste easily.
- Cap sub-items at **4 per prompt**. More than 4 degrades external AI answer quality and tires the user.
- Use plain, natural language. Avoid academic phrasings like "잠재적이지만 가시화되지 않은" — say "아직 주목받지 않은" instead. Prompts are read by an AI but graded by a human's patience.
- **Always include these two source-quality requirements in every prompt** (append at the end, after the substantive questions):
  1. *"각 출처는 가능하면 1차 자료(통계청, 정부 발표, 학술논문, 공식 보도자료, 건축가·건축주 공식 발표)를 우선하고, 2차 가공 자료(블로그 분석, 마케팅 리포트)를 인용할 경우 그 사실을 명시해 주세요."*
  2. *"각 인용에는 반드시 출처 URL 또는 DOI를 포함해 주세요. URL을 확인할 수 없는 정보는 '출처 미확인'으로 표시해 주세요."*
- For prompts asking about specific quantitative claims (인구·매출·면적·임대료 등), add: *"수치를 인용할 때는 측정 시점·집계 단위·출처 기관을 함께 명시해 주세요."*

#### The five fixed research areas

Always use these five, in this order. Each area covers a **distinct layer of analysis** — keep these layers separate when generating prompts, so the five areas don't produce overlapping content. External AIs tend to give "comprehensive" answers that spill across layers, so the layer distinction must be enforced explicitly in the prompt body and reinforced by a boundary clause (see below).

1. **Site Context (사이트 맥락)** — *Physical / legal / historical layer (facts).* Climate, topography, transit, adjacent buildings, zoning, history of the block.
2. **Users & Community (사용자 · 커뮤니티)** — *Existential layer (people currently here).* Who currently lives/works/passes through, demographics, daily rhythms, latent user groups, behavioral patterns.
3. **Precedent Studies (선례 분석)** — *Comparative layer (other built examples).* 3–5 built examples of the same typology that succeeded or failed; ask the external AI to extract what worked and what didn't.
   - **Temporal recency**: Default to examples from **post-COVID (2020년 이후)** — the pandemic reshaped how people occupy most space typologies (hospitality, workspace, retail, third-places), so pre-2020 built examples often no longer represent current practice. For typologies where a more recent paradigm shift applies (e.g. post-AI workspaces from ~2023), tighten the window further to that shift point. Exception: long-established typologies (libraries, museums, theaters) where seminal works still define the discourse may include older landmarks — but flag them as "historical reference" separately from "current practice."
   - **Source hierarchy for precedent research** (most to least authoritative, always specify in the prompt): (a) 설계사무소 공식 웹사이트·프로젝트 페이지, (b) 건축가 본인 기고·공식 인터뷰, (c) 건축 전문 매체 (월간 SPACE, 브리크, A+U, El Croquis, 2G), (d) 종합 건축 매체 (ArchDaily, Dezeen, Designboom). Ask the external AI to cite (a)–(b) wherever possible and flag cases where only (c)–(d) are available as "1차 자료 미확인".
   - **Hybrid / combined typologies** (e.g. 도서관 + 수직 정원, 갤러리 + 주거, 카페 + 서점): pure integrated precedents are often scarce. In such cases, explicitly allow the external AI to return **2–3 precedents per component typology** (e.g. 2–3 library examples + 2–3 vertical-garden examples) instead of forcing 3–5 fully integrated hybrid examples. State this allowance in the prompt. Contrast structures (success axis vs. failure axis, or typology A vs. typology B) between component typologies often produce stronger Phase 2 patterns than rare integrated examples would.
4. **Socio-Cultural Issues (사회·문화적 이슈)** — *Discourse layer (debates, policy, opinion).* Current debates, trends, tensions related to this program type in this region (e.g. gentrification for 성수동 카페, third-place decline for libraries).
5. **Typology Limitations (유형의 한계)** — *Meta layer (structural failures of the typology itself).* What conventional examples of this space type systematically fail to address; where the typology is being challenged or reinvented.

#### Boundary clause — prevent overlap across areas

Layer distinctions are easy to violate. At the end of each prompt (after the source-quality requirements), append a **one-sentence boundary clause** that tells the external AI what NOT to cover because it belongs to another area. Adapt the wording to the specific research subject and the user's language, but the structure should match these examples:

- End of ①: *"※ 이 지역의 도시재생 담론·주민 여론·정책 논쟁은 별도 영역에서 조사하므로, 이 답변에서는 물리적·법적·역사적 조건에 집중해 주세요."*
- End of ②: *"※ 다른 장소의 건축 선례는 별도 영역에서 조사하므로, 이 답변에서는 현재 이 지역에 있는 실제 사람들의 구성·생활·동선에 집중해 주세요."*
- End of ③: *"※ 사이트의 물리적 조건이나 현재 사용자 구성은 별도 영역에서 조사하므로, 이 답변에서는 다른 장소의 건축 선례 분석에 집중해 주세요."*
- End of ④: *"※ 물리적·법적 조건과 개별 선례는 별도 영역에서 조사하므로, 이 답변에서는 담론·여론·정책 논쟁·관련 트렌드에 집중해 주세요."*
- End of ⑤: *"※ 이 지역의 현황이나 개별 선례는 별도 영역에서 조사하므로, 이 답변에서는 유형 자체의 구조적 한계와 재정의 흐름에 집중해 주세요."*

#### Upload scaffold

Present the five prompts in clearly labeled, copy-pasteable code blocks. After presenting them, **always provide an upload-format scaffold** so the user doesn't have to guess the structure:

````markdown
# ① 사이트 맥락
(external AI result pasted here)


# ② 사용자 · 커뮤니티
(result)


# ③ 선례 분석
(result)


# ④ 사회·문화적 이슈
(result)


# ⑤ 유형의 한계
(result)
````

Tell the user: "이 5개를 외부 검색 AI에 각각 돌리고, 위 형식으로 `.md` 파일 하나 만들어서 업로드해줘. 헤더(`# ① 사이트 맥락` 등)는 정확히 유지해줘 — 내가 이걸로 영역을 구분함. 일부 영역 답이 비어도 '답변 없음'이라고만 써주면 됨."

---

### Phase 2 — Synthesis

**Input from user:** the pasted research results from external AIs (could be all at once, or area by area).

Phase 2 is split into two sub-phases so that gaps and source-confidence risks are surfaced BEFORE findings crystallize into a Problem Statement. **Do not combine 2-A and 2-B into a single response.** The user needs a natural break point to go verify primary sources if needed.

#### Phase 2-A — Pre-synthesis Review

When the user uploads research, do NOT immediately extract findings and patterns. First, scan the entire uploaded `.md` and return **three short outputs**:

1. **Tag preview** — For each of the 5 areas, report the expected count of [1차] / [2차] / [미확인] findings. Keep this to one line per area.

2. **Headline-dependency risks** — List items that are likely to become core components of the Problem Statement but are currently tagged [2차] or [미확인]. For each, state specifically what would ideally be verified and where (e.g. 토지이음 토지이용계획확인원, 통계청 SGIS 동 단위 통계, 해당 기관의 공식 보도자료). **Cap this list at 4 items.** If all likely headline material is already [1차], say so explicitly — "검증이 필요한 헤드라인 의존 위험은 없습니다" — and move on.

3. **Content gaps** — List areas marked "답변 없음" OR critical user groups / quantitative claims that have no primary-source backing in the current material. **Cap this list at 3 items.**

Then offer the user two options:
- **(a) 검증·보완하고 돌아오겠다** — the user goes to verify the flagged items (토지이음, SGIS, 현장 인터뷰, 공식 보도자료 등) or fills gaps, then returns to append or re-upload.
- **(b) 현 상태로 진행** — proceed to 2-B with current material, accepting the flagged risks.

Wait for the user's choice. If (a), accept the new material and re-run 2-A as needed. If (b), move to 2-B.

**Important — 2-A is *not* full synthesis.** Do not extract findings, draft patterns, or write Problem Statements in 2-A. It is a focused review of what's present and what's missing. Quick inline quotes from the uploaded material are fine when flagging a specific risk, but no area-by-area breakdown of findings yet.

#### Phase 2-B — Main Synthesis

Once the user chooses (b) (or returns with updated material after (a)):

1. For each of the 5 areas, extract **3–5 Key Findings**. Each finding should be a single concise sentence with concrete content (no fluff like "사이트는 흥미롭다").
   - **Tag each finding's source confidence**: `[1차]` for primary sources (통계청·학술논문·공식 자료), `[2차]` for processed/secondary sources (블로그·마케팅 리포트), `[미확인]` if no source given.
   - **Briefly explain the tags the first time they appear** in a conversation (1–2 sentence definition of 1차/2차/미확인). Don't assume the user knows the convention. Re-explain in the artifact via a footer note.
   - When the same claim appears in multiple sources, prefer the highest-confidence one.
   - Findings tagged `[2차]` or `[미확인]` should NOT carry the headline weight in the final Problem Statement.
   - **Record 1–3 specific source references per finding** (source name + URL when available) while synthesizing, not only the area-level summary. The HTML artifact in Phase 3 renders these inline under each expanded finding as clickable links, so if they aren't captured at 2-B, the artifact can't surface them without a second synthesis pass. The overall `[1차]`/`[2차]`/`[미확인]` tag is the confidence *verdict*; the per-finding source list is the *evidence*.

2. Across all findings, identify **2–4 cross-cutting Patterns** — recurring tensions, contradictions, gaps, or opportunities that show up in more than one research area. Patterns are where a Problem Statement becomes possible.

3. From the patterns, draft **2 candidate Problem Statements**. Show both to the user with a one-line rationale each. Ask which one they want, or invite them to combine/edit.

**Pattern labeling convention.** Use internal IDs `p1`, `p2`, `p3`, `p4` in data structures (JSON, JS objects, Markdown source lists). But in all user-visible text — chat responses, HTML board UI, Markdown report prose — display patterns as **패턴 A / 패턴 B / 패턴 C / 패턴 D** (Korean) or **Pattern A / B / C / D** (English), matching the user's language. The mapping is positional: `p1 → A, p2 → B, p3 → C, p4 → D`. Keep this consistent across all three surfaces: chat, HTML artifact, and Markdown report.

**Problem Statement format:**
- ONE sentence.
- Names the user/context, the tension, and the design opportunity.
- Avoids prescribing a solution (the Problem Statement is not the design — it's the question the design will answer).
- Good template: *"[사이트/맥락]에서 [사용자/주체]는 [현재의 한계/긴장]을 겪고 있으며, [공간 유형]은 [재정의/응답]이 필요하다."*

Wait for the user to confirm or pick a final Problem Statement before moving to Phase 3.

---

### Phase 3 — Visualization & Documentation

Generate **two deliverables**:

**3-A. Interactive HTML Research Board** — a single-file HTML artifact rendering a 1-page Research Board with an internal Funnel. Save to `/mnt/user-data/outputs/research_board.html`. See `references/board_template.md` for layout spec, interactivity requirements, styling, pattern labeling, and funnel sizing. **Always read that file before writing the artifact.**

**3-B. Markdown Document (.md)** — a full-text report with all detail that the HTML board abbreviates. Save to `/mnt/user-data/outputs/research_brief.md`. Structure:

  1. **Title block** — site, typology, date, research summary counts
  2. **Executive Summary** — one-paragraph narrative + **pattern bullets matching the actual number of patterns derived in Phase 2-B (2, 3, or 4 — do not pad or trim to hit a fixed count)** + Problem Statement in blockquote
  3. **5 research areas** — each with full findings (short headline + detail + source-confidence tag `[1차]`/`[2차]`/`[미확인]` + pattern links), followed by a **per-area bullet source list** — compact, one line per source, with finding ID cross-reference. This is the *quick inline view* for someone reading the area top-to-bottom.
  4. **Cross-cutting Patterns** — each pattern with rationale and list of contributing findings
  5. **Problem Statement** — the statement in a blockquote + 4-component breakdown + derivation logic + limitations/follow-up
  6. **Appendix: Full Source List** — organized by area, presented as **tables** with columns: #, 출처, 신뢰도, 기여 발견. This is the *detailed reference view* for lookup.

**Section 3 per-area bullets and Section 6 appendix tables serve different roles, not the same content in two formats.** Section 3 is for scanning while reading the area; Section 6 is for structured lookup. Keep Section 3 bullets compact (one line per source + finding IDs), and put the full citation detail, URL, confidence tag, and cross-reference into Section 6's tables.

Markdown formatting conventions:
  - Use `#` for major sections, `##` for areas/subsections, `###` for findings
  - Problem Statement highlighted as `> **"..."**` blockquote
  - Source-confidence tags as inline bold: **[1차]**, **[2차]**, **[미확인]**
  - Pattern links use **letter labels** everywhere visible: `→ 패턴 A, C` (never `→ p1, p3`). Internal IDs stay in data only.
  - Per-area source lists in Section 3 as bullet points with finding ID cross-reference
  - Appendix source lists in Section 6 as tables
  - Horizontal rules `---` between major sections

---

## Working Style

- **One phase at a time.** Don't generate Phase 1 prompts and start synthesizing in the same turn. The user needs to leave the conversation, run searches, and come back. Phase 2-A and 2-B are also separate — do not skip 2-A even if the uploaded material looks clean.
- **Mirror the user's language** in all prompts, findings, patterns, the Problem Statement, and the artifact UI. Default to Korean if the user opened in Korean.
- **Don't web_search yourself** during Phases 1 or 2 unless the user explicitly asks. The whole point of this skill is to offload heavy research to external AIs to save tokens. Brief lookups for verification (e.g. confirming a building name) are fine.
- **Be specific, not generic.** A finding like "사람들이 카페를 좋아한다" is useless. "성수동 평일 점심 유동인구의 70%가 인근 IT 오피스 직원이며, 좌석 회전율이 1.4시간으로 짧다" is useful. Push back on vague pasted research and ask the user to dig deeper if needed.
- **Track state.** At the start of Phase 2-A, Phase 2-B, and Phase 3, briefly recap site, typology, and where you are in the workflow so the user can resume across sessions.
- **Never fabricate project parameters.** Only display values the user explicitly provided as project inputs (site, typology, and any optional parameters like scale·budget·client they stated). Do NOT infer connecting metrics — for example, do not derive a 연면적 estimate from precedent ranges, do not assume a budget from typology averages, do not invent a client. If a parameter slot exists in the artifact header but the user didn't provide it, omit it entirely rather than filling with a guess. The same applies to the Problem Statement: every concrete number must trace to a Phase 2-B finding tagged `[1차]` or `[2차]`.
