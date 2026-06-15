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
import { loadSettings } from "@/lib/store/settings";
import {
  Concept,
  ConceptStructure,
  Pattern,
  Project,
  emptyConcept,
  getActiveConcept,
  needsReadableIdMigration,
  projectPath,
  projectTitle,
} from "@/lib/types/project";
import { Phase4StepKind, splitCandidateList } from "@/lib/skill/phase4";
import { AppSettings, DEFAULT_SETTINGS } from "@/lib/types/settings";
import { ProviderSelect } from "@/components/ModelSelect";

type StepDef =
  | { kind: "parti"; key: string; title: string }
  | { kind: "keywords"; key: string; title: string }
  | { kind: "strategy"; key: string; title: string; pattern: Pattern }
  | { kind: "materiality"; key: string; title: string }
  | { kind: "sceneAnchors"; key: string; title: string };

function seedConcept(patterns: Pattern[]): ConceptStructure {
  return {
    parti: "",
    keywords: [],
    spatialStrategies: patterns.map((p) => ({
      patternId: p.id,
      patternTitle: p.title,
      strategy: "",
    })),
    materiality: "",
    sceneAnchors: [],
  };
}

export default function Phase4Page() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [concept, setConcept] = useState<Concept | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [stepIdx, setStepIdx] = useState(0);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [loadingCands, setLoadingCands] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let p = getProject(params.id);
    if (p && needsReadableIdMigration(p.id)) {
      const newId = maybeMigrateLegacyId(p);
      router.replace(projectPath(newId, "phase4"));
      return;
    }
    if (p) p = migrateProject(p);
    let proj = p ?? null;
    // Ensure there's an active concept to edit (normally created on the
    // concepts page; seed one if user lands here directly).
    if (proj && proj.finalPS && (!proj.concepts || proj.concepts.length === 0)) {
      const pats = proj.phase2B?.patterns ?? [];
      const c = emptyConcept(
        "컨셉 1",
        pats.map((x) => ({ id: x.id, title: x.title })),
      );
      proj = {
        ...proj,
        concepts: [c],
        activeConceptId: c.id,
        phase: proj.phase === "5" ? "5" : "4",
      };
      saveProject(proj);
    }
    setProject(proj);
    if (proj) setConcept(getActiveConcept(proj) ?? null);
    setSettings(loadSettings());
    setLoaded(true);
  }, [params.id, router]);

  const patterns: Pattern[] = useMemo(
    () => project?.phase2B?.patterns ?? [],
    [project],
  );

  const steps: StepDef[] = useMemo(() => {
    const list: StepDef[] = [
      { kind: "parti", key: "parti", title: "개념 선언문 (Parti)" },
      { kind: "keywords", key: "keywords", title: "개념 키워드 · 은유" },
    ];
    patterns.forEach((p) =>
      list.push({
        kind: "strategy",
        key: `strategy:${p.id}`,
        title: `공간 전략 — ${p.title}`,
        pattern: p,
      }),
    );
    // 재료·분위기와 장면 단서(sceneAnchors)는 Phase 5 에서 구성합니다.
    return list;
  }, [patterns]);

  // Lock the concept structure only when THIS concept already has generated
  // Phase 5 images — not project-wide. (Merely visiting Phase 5 seeds an empty
  // `project.phase5 = { images: [] }`, which must NOT lock anything, and other
  // concepts reaching P5 must not lock a brand-new concept.)
  const locked = (project?.phase5?.images ?? []).some(
    (img) => img.conceptId === concept?.id,
  );

  // Current stored value for a step (to show "chosen" state).
  function storedValue(c: ConceptStructure, s: StepDef): string {
    switch (s.kind) {
      case "parti":
        return c.parti;
      case "keywords":
        return c.keywords.join(", ");
      case "strategy":
        return (
          c.spatialStrategies.find((x) => x.patternId === s.pattern.id)
            ?.strategy ?? ""
        );
      case "materiality":
        return c.materiality;
      case "sceneAnchors":
        return c.sceneAnchors.join(", ");
    }
  }

  function applyChoice(s: StepDef, value: string, c: ConceptStructure) {
    const next: ConceptStructure = { ...c };
    switch (s.kind) {
      case "parti":
        next.parti = value.trim();
        break;
      case "keywords":
        next.keywords = splitCandidateList(value);
        break;
      case "strategy":
        next.spatialStrategies = c.spatialStrategies.map((x) =>
          x.patternId === s.pattern.id
            ? { ...x, strategy: value.trim() }
            : x,
        );
        break;
      case "materiality":
        next.materiality = value.trim();
        break;
      case "sceneAnchors":
        next.sceneAnchors = splitCandidateList(value);
        break;
    }
    next.generatedAt = new Date().toISOString();
    return next;
  }

  function persist(next: ConceptStructure) {
    if (!project) return;
    const active = getActiveConcept(project);
    if (!active) return;
    const mergedConcept: Concept = {
      ...active,
      ...next,
      id: active.id,
      name: active.name,
      createdAt: active.createdAt,
    };
    const updated: Project = {
      ...project,
      concepts: (project.concepts ?? []).map((x) =>
        x.id === active.id ? mergedConcept : x,
      ),
      activeConceptId: active.id,
      phase: project.phase === "5" ? "5" : "4",
    };
    saveProject(updated);
    setProject(updated);
    setConcept(mergedConcept);
  }

  async function fetchCandidates(s: StepDef) {
    if (!project || !project.finalPS || !concept) return;
    setError(null);
    setLoadingCands(true);
    setCandidates([]);
    try {
      const settings = loadSettings();
      const stepKind: Phase4StepKind = s.kind;
      const res = await fetch("/api/phase4/step", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: settings[settings.active],
          inputs: project.inputs,
          language: project.language,
          patterns,
          finalPS: project.finalPS,
          step: stepKind,
          // Freshest persisted active concept so prior selections are included.
          prior: getActiveConcept(project) ?? concept,
          patternId: s.kind === "strategy" ? s.pattern.id : undefined,
          count: 3,
        }),
      });
      const data = (await res.json()) as
        | { candidates: string[] }
        | { error: string };
      if (!res.ok || "error" in data) {
        setError(("error" in data && data.error) || `HTTP ${res.status}`);
        return;
      }
      setCandidates(data.candidates);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingCands(false);
    }
  }

  // Unlock this concept by removing ONLY its own Phase 5 images. Other
  // concepts' images (and the project-level phase5 record) are preserved.
  function clearPhase5() {
    if (!project || !concept) return;
    const remaining = (project.phase5?.images ?? []).filter(
      (img) => img.conceptId !== concept.id,
    );
    const updated: Project = {
      ...project,
      phase5: project.phase5
        ? { ...project.phase5, images: remaining }
        : undefined,
    };
    saveProject(updated);
    setProject(updated);
  }

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
  if (!project.finalPS) {
    return (
      <div className="tile-light min-h-screen p-12">
        <p className="mb-6 t-body text-[var(--warning)]">
          Problem Statement 가 아직 확정되지 않았습니다. Phase 3 에서 먼저
          확정해 주세요.
        </p>
        <Link
          href={projectPath(project.id, "phase2b")}
          className="btn-pill-primary"
        >
          Phase 3 으로
        </Link>
      </div>
    );
  }

  const c = concept ?? seedConcept(patterns);
  const step = steps[stepIdx];
  const stepValue = storedValue(c, step);
  const completedCount = steps.filter(
    (s) => storedValue(c, s).trim().length > 0,
  ).length;
  const allDone = completedCount === steps.length;
  const isMulti = step.kind === "keywords" || step.kind === "sceneAnchors";

  return (
    <>
      {/* Header */}
      <section className="tile-light px-8 pt-12 pb-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="t-display-md">{projectTitle(project)}</h1>
          <p className="mt-3 t-body text-[var(--text-muted)]">
            AI 추천 중 하나를 단계별로 선택해 설계 개념을 쌓아 갑니다. 각
            단계는 이전 선택을 반영해 추천됩니다.
          </p>
          <div className="mt-5">
            <ProviderSelect settings={settings} onChange={setSettings} />
          </div>
        </div>
      </section>

      {/* Locked banner */}
      {locked && (
        <section className="tile-parchment px-8 py-8">
          <div className="mx-auto max-w-4xl rounded-[18px] border border-[var(--hairline)] bg-white p-6">
            <p className="t-body-strong">🔒 이 컨셉의 구조가 잠겨 있습니다</p>
            <p className="mt-2 t-caption text-[var(--text-muted)]">
              이 컨셉에서 이미지가 생성되어 구조가 잠겼습니다. 다시 편집하려면
              이 컨셉의 이미지를 초기화하세요. (다른 컨셉의 이미지는 그대로
              유지됩니다.)
            </p>
            <button
              onClick={clearPhase5}
              className="btn-pill-primary mt-4"
            >
              이 컨셉 이미지 초기화 → 다시 편집
            </button>
          </div>
        </section>
      )}

      {/* PS + patterns recap */}
      <section className="tile-parchment px-8 py-10">
        <div className="mx-auto max-w-4xl rounded-[18px] border border-[var(--hairline)] bg-white p-6">
          <p className="t-caption text-[var(--text-muted)] mb-2">
            Problem Statement <span className="ml-1 t-fine">🔒</span>
          </p>
          <blockquote className="rounded-xl border-l-4 border-[var(--accent)] bg-[var(--surface-parchment)] px-5 py-4 t-body italic text-[var(--text-ink)]">
            &ldquo;{project.finalPS}&rdquo;
          </blockquote>
          {patterns.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {patterns.map((p) => (
                <li
                  key={p.id}
                  className="rounded-full bg-[var(--surface-near-black)] px-3 py-1 t-fine text-[var(--accent)]"
                >
                  {p.label}. {p.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Stepper */}
      <section className="tile-light px-8 py-12">
        <div className="mx-auto max-w-4xl">
          {/* progress */}
          <div className="mb-8 flex flex-wrap gap-2">
            {steps.map((s, i) => {
              const done = storedValue(c, s).trim().length > 0;
              const isCur = i === stepIdx;
              return (
                <button
                  key={s.key}
                  onClick={() => {
                    setStepIdx(i);
                    setCandidates([]);
                    setEditing(false);
                  }}
                  className={`rounded-full px-3 py-1 t-fine ${
                    isCur
                      ? "bg-[var(--accent)] text-black"
                      : done
                        ? "bg-[var(--surface-near-black)] text-[var(--accent)]"
                        : "bg-[var(--surface-parchment)] text-[var(--text-muted)]"
                  }`}
                  title={s.title}
                >
                  {i + 1}. {done ? "✓ " : ""}
                  {s.title}
                </button>
              );
            })}
          </div>

          <div className="rounded-[18px] border border-[var(--hairline)] bg-white p-6">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="t-tagline">
                {stepIdx + 1} / {steps.length} · {step.title}
              </h2>
              <span className="t-fine text-[var(--text-muted)]">
                완료 {completedCount}/{steps.length}
              </span>
            </div>
            {step.kind === "strategy" && (
              <p className="mb-3 t-caption text-[var(--text-muted)]">
                패턴 “{step.pattern.title}” — {step.pattern.rationale}
              </p>
            )}

            {/* Current chosen value */}
            {stepValue.trim() && !editing && (
              <div className="mb-5 rounded-xl border border-[var(--accent)] bg-[var(--accent)]/5 p-4">
                <p className="t-fine text-[var(--accent-pressed)] mb-1">
                  현재 선택
                </p>
                <p className="t-body text-[var(--text-ink)]">{stepValue}</p>
              </div>
            )}

            {/* Editing mode */}
            {editing ? (
              <div>
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={isMulti ? 4 : 3}
                  className="input-base"
                  placeholder={
                    isMulti
                      ? "쉼표 또는 줄바꿈으로 구분"
                      : "직접 작성하세요"
                  }
                  disabled={locked}
                />
                <div className="mt-3 flex gap-2">
                  <button
                    className="btn-pill-primary"
                    disabled={locked || !editText.trim()}
                    onClick={() => {
                      const next = applyChoice(step, editText, c);
                      persist(next);
                      setEditing(false);
                    }}
                  >
                    저장
                  </button>
                  <button
                    className="btn-pill-ghost"
                    onClick={() => setEditing(false)}
                  >
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Candidates */}
                {candidates.length > 0 && (
                  <ul className="space-y-3">
                    {candidates.map((cand, i) => (
                      <li key={i}>
                        <button
                          disabled={locked}
                          onClick={() => {
                            const next = applyChoice(step, cand, c);
                            persist(next);
                            setCandidates([]);
                            if (stepIdx < steps.length - 1)
                              setStepIdx(stepIdx + 1);
                          }}
                          className={`w-full rounded-[18px] border p-4 text-left transition ${
                            stepValue === cand ||
                            (isMulti &&
                              splitCandidateList(cand).join(", ") ===
                                stepValue)
                              ? "border-[var(--accent)] bg-[var(--accent)]/5"
                              : "border-[var(--hairline)] bg-white hover:bg-[var(--surface-parchment)]"
                          }`}
                        >
                          <span className="t-caption-strong text-[var(--accent-pressed)] mr-2">
                            {String.fromCharCode(65 + i)}
                          </span>
                          <span className="t-body text-[var(--text-ink)]">
                            {cand}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Actions */}
                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    className="btn-pill-primary"
                    disabled={locked || loadingCands}
                    onClick={() => fetchCandidates(step)}
                  >
                    {loadingCands
                      ? "추천 생성 중…"
                      : candidates.length || stepValue
                        ? "재추천"
                        : "AI 추천 생성"}
                  </button>
                  <button
                    className="btn-pill-ghost"
                    disabled={locked}
                    onClick={() => {
                      setEditText(
                        stepValue ||
                          (candidates.length ? candidates[0] : ""),
                      );
                      setEditing(true);
                    }}
                  >
                    직접 수정
                  </button>
                  {stepIdx > 0 && (
                    <button
                      className="btn-pill-ghost"
                      onClick={() => {
                        setStepIdx(stepIdx - 1);
                        setCandidates([]);
                      }}
                    >
                      ← 이전
                    </button>
                  )}
                  {stepValue.trim() && stepIdx < steps.length - 1 && (
                    <button
                      className="btn-pill-ghost"
                      onClick={() => {
                        setStepIdx(stepIdx + 1);
                        setCandidates([]);
                      }}
                    >
                      다음 →
                    </button>
                  )}
                </div>
              </>
            )}

            {error && (
              <p className="mt-5 rounded-xl bg-[var(--error)]/10 px-4 py-3 t-caption text-[var(--error)]">
                {error}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Summary + next */}
      <section className="tile-dark px-8 py-12">
        <div className="mx-auto max-w-4xl">
          <h2 className="t-tagline text-[var(--text-white)] mb-4">
            컨셉 요약 ({completedCount}/{steps.length} 완료)
          </h2>
          <dl className="space-y-3">
            <SummaryRow label="Parti" value={c.parti} />
            <SummaryRow label="키워드" value={c.keywords.join(", ")} />
            {c.spatialStrategies.map((s) => (
              <SummaryRow
                key={s.patternId}
                label={`전략 · ${s.patternTitle}`}
                value={s.strategy}
              />
            ))}
          </dl>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
            <p className="t-caption text-[var(--text-silver)]">
              컨셉을 채운 뒤 컨셉 이미지를 생성합니다.
            </p>
            <Link
              href={projectPath(project.id, "phase5")}
              aria-disabled={!allDone}
              className={`btn-pill-primary ${!allDone ? "pointer-events-none opacity-50" : ""}`}
            >
              Phase 5 → 컨셉 이미지 생성
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4 border-b border-[var(--border-gray)] pb-3">
      <dt className="w-32 shrink-0 t-caption text-[var(--text-silver)]">
        {label}
      </dt>
      <dd className="t-caption text-[var(--text-white)]">
        {value.trim() ? (
          value
        ) : (
          <span className="text-[var(--text-muted)]">— 미선택</span>
        )}
      </dd>
    </div>
  );
}
