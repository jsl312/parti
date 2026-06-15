"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  getProject,
  maybeMigrateLegacyId,
  migrateProject,
  saveProject,
} from "@/lib/store/projects";
import { loadSettings, saveSettings } from "@/lib/store/settings";
import {
  Finding,
  Pattern,
  Phase2BResult,
  Project,
  ResearchArea,
  SourceConfidence,
  needsReadableIdMigration,
  projectPath,
  projectTitle,
} from "@/lib/types/project";
import { AppSettings, DEFAULT_SETTINGS } from "@/lib/types/settings";
import { ProviderSelect } from "@/components/ModelSelect";
import { areaLabel } from "@/lib/skill/areaLabels";
import { generateReport } from "@/lib/skill/reportTemplate";

const AREA_ORDER: ResearchArea[] = [
  "site_context",
  "users_community",
  "precedent_studies",
  "socio_cultural",
  "typology_limits",
];

export default function Phase2BPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalPS, setFinalPS] = useState<string>("");
  const [hoverPattern, setHoverPattern] = useState<string | null>(null);
  const [hoverFinding, setHoverFinding] = useState<string | null>(null);
  const [mdCopied, setMdCopied] = useState(false);

  useEffect(() => {
    let p = getProject(params.id);
    if (p && needsReadableIdMigration(p.id)) {
      const newId = maybeMigrateLegacyId(p);
      router.replace(projectPath(newId, "phase2b"));
      return;
    }
    if (p) p = migrateProject(p);
    setProject(p ?? null);
    setFinalPS(p?.finalPS ?? "");
    setSettings(loadSettings());
    setLoaded(true);
  }, [params.id, router]);

  const result = project?.phase2B;
  // Confirmed = the user has a finalPS, regardless of the mutable `phase`
  // marker (re-running Phase 1/2 sets phase back to "2A" but must NOT
  // un-confirm the PS). Locked = Phase 4 has been entered (durable
  // project.phase4 marker), so the PS can no longer be edited.
  const psConfirmed = !!project?.finalPS;
  // Entering Phase 4 (concept structuring) — or any later phase — locks the PS.
  const psLocked =
    !!project?.phase4 ||
    !!(project?.concepts && project.concepts.length > 0) ||
    !!project?.phase5 ||
    project?.phase === "4" ||
    project?.phase === "5";

  if (!loaded) {
    return (
      <div className="tile-light min-h-screen p-12">
        <p className="t-body text-[var(--text-muted)]">불러오는 중…</p>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="tile-light min-h-screen p-12">
        <p className="t-body text-[var(--error)]">
          프로젝트를 찾을 수 없습니다.
        </p>
        <Link href="/" className="mt-6 inline-block btn-pill-ghost">
          ← 홈
        </Link>
      </div>
    );
  }
  if (!project.uploadedResearch) {
    return (
      <div className="tile-light min-h-screen p-12">
        <p className="mb-6 t-body text-[var(--warning)]">
          Phase 2 가 완료되지 않았습니다. Phase 1 페이지에서 리서치 결과를
          먼저 업로드하세요.
        </p>
        <Link
          href={projectPath(project.id, "phase1")}
          className="btn-pill-primary"
        >
          Phase 1 으로
        </Link>
      </div>
    );
  }

  async function handleRun() {
    if (!project) return;
    setError(null);
    setRunning(true);
    try {
      const res = await fetch("/api/phase2b", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: settings[settings.active],
          inputs: project.inputs,
          language: project.language,
          uploadedResearch: project.uploadedResearch,
        }),
      });
      const data = (await res.json()) as
        | { result: Omit<Phase2BResult, "generatedAt"> }
        | { error: string };
      if (!res.ok || "error" in data) {
        setError(("error" in data && data.error) || `HTTP ${res.status}`);
        return;
      }
      const synth: Phase2BResult = {
        ...data.result,
        generatedAt: new Date().toISOString(),
      };
      const updated: Project = { ...project, phase2B: synth };
      saveProject(updated);
      setProject(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function handleConfirm() {
    if (!project || !finalPS.trim()) return;
    const updated: Project = {
      ...project,
      finalPS: finalPS.trim(),
      phase: "3",
    };
    saveProject(updated);
    setProject(updated);
  }

  function handleEdit() {
    if (!project) return;
    // Only reachable when NOT locked (Phase 4 not entered). Clearing finalPS
    // drops back to candidate selection; local `finalPS` state still holds
    // the text so the user can tweak and re-confirm.
    const updated: Project = { ...project, phase: "2B", finalPS: undefined };
    saveProject(updated);
    setProject(updated);
  }

  function handleDownloadMd() {
    if (!project) return;
    const md = generateReport(project);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeSite = project.inputs.site
      .replace(/[\\/:*?"<>|]/g, "_")
      .slice(0, 40);
    const safeTypology = project.inputs.typology
      .replace(/[\\/:*?"<>|]/g, "_")
      .slice(0, 30);
    a.href = url;
    a.download = `research-brief_${safeSite}_${safeTypology}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCopyMd() {
    if (!project) return;
    try {
      await navigator.clipboard.writeText(generateReport(project));
      setMdCopied(true);
      setTimeout(() => setMdCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  function handlePrint() {
    const allDetails = document.querySelectorAll<HTMLDetailsElement>("details");
    const previouslyOpen: HTMLDetailsElement[] = [];
    allDetails.forEach((d) => {
      if (d.open) previouslyOpen.push(d);
      d.open = true;
    });
    window.print();
    setTimeout(() => {
      allDetails.forEach((d) => {
        d.open = previouslyOpen.includes(d);
      });
    }, 100);
  }

  return (
    <>
      {/* Tile 1 — Header (light) */}
      <section className="tile-light px-8 pt-12 pb-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 flex flex-wrap justify-end gap-2 print-hide">
            <button
              onClick={handlePrint}
              className="btn-pill-ghost"
              title="모든 finding 을 펼쳐 인쇄/PDF 저장"
            >
              PDF 인쇄
            </button>
            {psConfirmed && (
              <>
                <button
                  onClick={handleDownloadMd}
                  className="btn-pill-primary"
                  title="다른 스킬·웹앱에 컨텍스트로 전달할 단일 .md 파일 다운로드"
                >
                  .md 다운로드
                </button>
                <button onClick={handleCopyMd} className="btn-pill-ghost">
                  {mdCopied ? "✓ 복사됨" : ".md 복사"}
                </button>
              </>
            )}
          </div>
          <h1 className="t-display-md">{projectTitle(project)}</h1>
          <p className="mt-3 t-body text-[var(--text-muted)] print-hide">
            5 영역에서 findings 를 추출하고, 영역을 가로지르는 patterns 를
            식별한 뒤, 2개의 Problem Statement 후보를 도출합니다.
          </p>
        </div>
      </section>

      {!result && (
        <section className="tile-parchment px-8 py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="t-tagline mb-4">Phase 3 종합 분석</h2>
            <p className="mb-8 t-body text-[var(--text-muted)]">
              Ollama 로컬 모델 기준 5–10분, Anthropic / Gemini 기준 1–2분
              소요됩니다.
            </p>
            <div className="mb-3 flex justify-center">
              <ProviderSelect settings={settings} onChange={setSettings} />
            </div>
            <ModelPicker
              settings={settings}
              onChange={(next) => {
                saveSettings(next);
                setSettings(next);
              }}
            />
            <button
              onClick={handleRun}
              disabled={running}
              className="btn-pill-primary"
            >
              {running ? "분석 중…" : "Phase 3 실행"}
            </button>
            {error && (
              <p className="mt-6 rounded-xl bg-[var(--error)]/10 px-4 py-3 t-caption text-[var(--error)]">
                {error}
              </p>
            )}
          </div>
        </section>
      )}

      {result && (
        <>
          {/* Tile 2 — Findings + Patterns (light) */}
          <section className="tile-light px-8 py-12">
            <div className="mx-auto max-w-7xl">
              <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <FindingsView
                    findings={result.findings}
                    language={project.language}
                    hoverPattern={hoverPattern}
                    hoverFinding={hoverFinding}
                    setHoverFinding={setHoverFinding}
                  />
                </div>
                <aside className="lg:sticky lg:top-6 lg:self-start print-static">
                  <PatternsView
                    patterns={result.patterns}
                    hoverPattern={hoverPattern}
                    hoverFinding={hoverFinding}
                    setHoverPattern={setHoverPattern}
                    findingsById={Object.fromEntries(
                      result.findings.map((f) => [f.id, f]),
                    )}
                  />
                </aside>
              </div>
            </div>
          </section>

          {/* Tile 3 — Problem Statement (parchment / dark when confirmed) */}
          <section
            className={
              psConfirmed
                ? "tile-dark px-8 py-16"
                : "tile-parchment px-8 py-16"
            }
          >
            <div className="mx-auto max-w-4xl">
              {psConfirmed && project.finalPS ? (
                <ConfirmedView
                  ps={project.finalPS}
                  onEdit={handleEdit}
                  locked={psLocked}
                />
              ) : (
                <>
                  <CandidatesView
                    candidates={result.candidates}
                    finalPS={finalPS}
                    setFinalPS={setFinalPS}
                  />

                  <div className="mt-8 flex items-center justify-between border-t border-[var(--hairline)] pt-6 print-hide">
                    <button
                      onClick={handleRun}
                      disabled={running}
                      className="btn-pill-ghost"
                    >
                      {running ? "재분석 중…" : "다시 분석"}
                    </button>
                    <button
                      onClick={handleConfirm}
                      disabled={!finalPS.trim()}
                      className="btn-pill-primary"
                    >
                      Problem Statement 확정
                    </button>
                  </div>
                </>
              )}
              {error && (
                <p className="mt-6 rounded-xl bg-[var(--error)]/10 px-4 py-3 t-caption text-[var(--error)]">
                  {error}
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}

function ConfidenceBadge({ confidence }: { confidence: SourceConfidence }) {
  const cls =
    confidence === "1차"
      ? "bg-[var(--accent)] text-black"
      : confidence === "2차"
        ? "bg-[var(--warning)] text-black"
        : "bg-[var(--surface-parchment)] text-[var(--text-muted)] border border-[var(--hairline)]";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ${cls}`}
    >
      [{confidence}]
    </span>
  );
}

function FindingsView({
  findings,
  language,
  hoverPattern,
  hoverFinding,
  setHoverFinding,
}: {
  findings: Finding[];
  language: "ko" | "en";
  hoverPattern: string | null;
  hoverFinding: string | null;
  setHoverFinding: (id: string | null) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<ResearchArea, Finding[]>();
    AREA_ORDER.forEach((a) => map.set(a, []));
    findings.forEach((f) => map.get(f.area)?.push(f));
    return map;
  }, [findings]);

  return (
    <section>
      <h2 className="t-display-md mb-6">Findings</h2>
      <div className="space-y-4">
        {AREA_ORDER.map((area) => {
          const list = grouped.get(area) ?? [];
          return (
            <div
              key={area}
              className="rounded-[18px] border border-[var(--hairline)] bg-white"
            >
              <h3 className="border-b border-[var(--hairline)] px-5 py-3 t-caption-strong text-[var(--text-ink)]">
                {areaLabel(area, language)}
                <span className="ml-2 font-mono t-fine text-[var(--text-muted)]">
                  ({list.length})
                </span>
              </h3>
              <ul>
                {list.map((f) => {
                  const dimmed =
                    (hoverPattern && !f.patternIds.includes(hoverPattern)) ||
                    (hoverFinding && hoverFinding !== f.id);
                  const highlighted =
                    (hoverPattern && f.patternIds.includes(hoverPattern)) ||
                    hoverFinding === f.id;
                  return (
                    <li
                      key={f.id}
                      onMouseEnter={() => setHoverFinding(f.id)}
                      onMouseLeave={() => setHoverFinding(null)}
                      className={`border-b border-[var(--hairline)] last:border-b-0 transition-opacity ${
                        highlighted ? "bg-[var(--surface-parchment)]" : ""
                      } ${dimmed ? "opacity-40" : "opacity-100"}`}
                    >
                      <details className="group">
                        <summary className="flex cursor-pointer items-center gap-3 px-5 py-3 hover:bg-[var(--surface-parchment)]">
                          <ConfidenceBadge confidence={f.confidence} />
                          <span className="t-caption flex-1 truncate font-semibold text-[var(--text-ink)]">
                            {f.headline}
                          </span>
                          {f.patternIds.length > 0 && (
                            <span className="shrink-0 rounded-full bg-[var(--surface-near-black)] px-2 py-0.5 font-mono text-[11px] font-semibold text-[var(--accent)]">
                              {f.patternIds.map((p) => labelOf(p)).join("·")}
                            </span>
                          )}
                          <span className="shrink-0 text-[var(--text-muted)] transition-transform group-open:rotate-90">
                            ›
                          </span>
                        </summary>
                        <div className="space-y-3 border-t border-[var(--hairline)] bg-[var(--surface-parchment)] px-5 py-4">
                          <p className="t-caption text-[var(--text-ink)]">
                            {f.detail}
                          </p>
                          {f.sources.length > 0 && (
                            <div className="flex flex-wrap gap-x-3 gap-y-1">
                              {f.sources.map((s, i) => (
                                <span
                                  key={i}
                                  className="t-fine text-[var(--text-muted)]"
                                >
                                  {s.url ? (
                                    <a
                                      href={s.url}
                                      target="_blank"
                                      rel="noopener"
                                      className="underline hover:text-[var(--text-ink)]"
                                    >
                                      {s.name}
                                    </a>
                                  ) : (
                                    s.name
                                  )}
                                  {i < f.sources.length - 1 && " ·"}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </details>
                    </li>
                  );
                })}
                {list.length === 0 && (
                  <li className="px-5 py-3 t-caption text-[var(--text-muted)]">
                    (이 영역의 finding 없음)
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PatternsView({
  patterns,
  hoverPattern,
  hoverFinding,
  setHoverPattern,
  findingsById,
}: {
  patterns: Pattern[];
  hoverPattern: string | null;
  hoverFinding: string | null;
  setHoverPattern: (id: string | null) => void;
  findingsById: Record<string, Finding>;
}) {
  return (
    <section>
      <h2 className="t-display-md mb-6">Patterns</h2>
      <div className="space-y-3">
        {patterns.map((p) => {
          const dimmedByFinding =
            hoverFinding &&
            !findingsById[hoverFinding]?.patternIds.includes(p.id);
          const highlighted =
            hoverPattern === p.id ||
            (hoverFinding &&
              findingsById[hoverFinding]?.patternIds.includes(p.id));
          return (
            <div
              key={p.id}
              onMouseEnter={() => setHoverPattern(p.id)}
              onMouseLeave={() => setHoverPattern(null)}
              className={`rounded-[18px] border p-5 transition-colors ${
                highlighted
                  ? "border-[var(--accent)] bg-[var(--accent)]/5"
                  : "border-[var(--hairline)] bg-white"
              } ${dimmedByFinding ? "opacity-40" : "opacity-100"}`}
            >
              <div className="mb-2 flex items-center gap-3">
                <span className="rounded-full bg-[var(--surface-near-black)] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[var(--accent)]">
                  {p.label}
                </span>
                <h3 className="t-caption-strong flex-1 text-[var(--text-ink)]">
                  {p.title}
                </h3>
              </div>
              <p className="mb-2 t-caption text-[var(--text-muted)]">
                {p.rationale}
              </p>
              <div className="font-mono t-fine text-[var(--text-muted)]">
                {p.findingIds.join(" · ")}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CandidatesView({
  candidates,
  finalPS,
  setFinalPS,
}: {
  candidates: { text: string; rationale: string }[];
  finalPS: string;
  setFinalPS: (v: string) => void;
}) {
  return (
    <section>
      <h2 className="t-display-md mb-6">Problem Statement 후보</h2>
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {candidates.map((c, i) => (
          <button
            key={i}
            onClick={() => setFinalPS(c.text)}
            className={`rounded-[18px] border p-5 text-left transition ${
              finalPS === c.text
                ? "border-[var(--accent)] bg-white"
                : "border-[var(--hairline)] bg-white hover:bg-[var(--surface-parchment)]"
            }`}
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded-full bg-[var(--surface-near-black)] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[var(--accent)]">
                후보 {i + 1}
              </span>
              {finalPS === c.text && (
                <span className="t-fine font-semibold text-[var(--accent-pressed)]">
                  ✓ 선택됨
                </span>
              )}
            </div>
            <p className="mb-3 t-body-strong leading-relaxed text-[var(--text-ink)]">
              &ldquo;{c.text}&rdquo;
            </p>
            <p className="t-caption text-[var(--text-muted)]">
              <span className="font-mono">근거:</span> {c.rationale}
            </p>
          </button>
        ))}
      </div>

      <div className="rounded-[18px] border border-[var(--hairline)] bg-white p-6">
        <label className="t-caption-strong mb-3 block text-[var(--text-ink)]">
          최종 Problem Statement (위 후보 선택 → 자유롭게 편집·합성 가능)
        </label>
        <textarea
          value={finalPS}
          onChange={(e) => setFinalPS(e.target.value)}
          rows={4}
          className="input-base text-[17px] leading-relaxed"
          placeholder="후보 중 하나를 클릭하거나 직접 작성하세요…"
        />
        <p className="mt-3 t-fine text-[var(--text-muted)]">
          한 문장. 사용자/맥락 + 현재의 긴장 + 디자인 응답의 필요성. 솔루션
          명시 금지.
        </p>
      </div>
    </section>
  );
}

function ConfirmedView({
  ps,
  onEdit,
  locked,
}: {
  ps: string;
  onEdit: () => void;
  locked: boolean;
}) {
  const params = useParams<{ id: string }>();
  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="t-caption text-[var(--text-silver)]">최종</p>
          <h2 className="t-display-md text-[var(--text-white)]">
            Problem Statement
          </h2>
        </div>
        {locked ? (
          <span
            className="rounded-full border border-[var(--border-gray)] px-3 py-1 t-fine text-[var(--text-silver)] print-hide"
            title="Phase 4 진입 후에는 수정할 수 없습니다"
          >
            🔒 잠금
          </span>
        ) : (
          <button
            onClick={onEdit}
            className="btn-pill-ghost on-dark print-hide"
            title="후보 선택 화면으로 되돌아가기"
          >
            수정
          </button>
        )}
      </div>
      <blockquote className="rounded-[18px] border-l-4 border-[var(--accent)] bg-[var(--surface-dark-1)] px-8 py-8 t-lead text-[var(--text-white)]">
        &ldquo;{ps}&rdquo;
      </blockquote>

      {locked && (
        <p className="mt-4 t-caption text-[var(--text-silver)] print-hide">
          Phase 4 (컨셉 구조화) 가 시작되어 Problem Statement 가 잠겼습니다.
          이 문장은 컨셉 구조화·이미지 생성의 기준이 되므로 더 이상 수정할 수
          없습니다.
        </p>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 print-hide">
        <p className="t-caption text-[var(--text-silver)]">
          상단 [.md 다운로드] 로 다른 스킬·웹앱에 컨텍스트로 전달할 .md 를
          받거나, 컨셉을 구조화해 이미지로 발전시키세요.
        </p>
        <Link
          href={projectPath(params.id, "concepts")}
          className="btn-pill-primary"
        >
          Phase 4 → 컨셉 관리
        </Link>
      </div>
    </section>
  );
}

function labelOf(patternId: string): string {
  const map: Record<string, string> = {
    p1: "A",
    p2: "B",
    p3: "C",
    p4: "D",
  };
  return map[patternId] ?? patternId;
}

const PROVIDER_LABEL: Record<AppSettings["active"], string> = {
  ollama: "Ollama",
  anthropic: "Anthropic",
  gemini: "Gemini",
};

function ModelPicker({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
}) {
  const active = settings.active;
  const currentModel = settings[active].model;
  const [draft, setDraft] = useState(currentModel);
  const [saved, setSaved] = useState(false);

  // Reset draft when underlying setting changes (e.g. provider switched).
  useEffect(() => {
    setDraft(currentModel);
  }, [currentModel]);

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === currentModel) {
      setDraft(currentModel);
      return;
    }
    const next: AppSettings = {
      ...settings,
      [active]: { ...settings[active], model: trimmed },
    } as AppSettings;
    onChange(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="mx-auto mb-6 inline-flex max-w-full flex-wrap items-center gap-2 rounded-full border border-[var(--hairline)] bg-white px-4 py-2 t-caption text-[var(--text-muted)]">
      <span>
        현재 <strong className="text-[var(--text-ink)]">{PROVIDER_LABEL[active]}</strong> ·
        모델
      </span>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        spellCheck={false}
        className="w-56 rounded-md border border-[var(--hairline)] px-2 py-1 font-mono text-[13px] text-[var(--text-ink)] focus:border-[var(--accent)] focus:outline-none"
      />
      {saved && (
        <span className="t-fine text-[var(--accent-pressed)]">✓ 저장됨</span>
      )}
    </div>
  );
}
