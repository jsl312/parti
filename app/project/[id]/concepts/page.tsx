"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  getProject,
  maybeMigrateLegacyId,
  migrateProject,
  saveProject,
} from "@/lib/store/projects";
import {
  Concept,
  Pattern,
  Project,
  emptyConcept,
  needsReadableIdMigration,
  newConceptId,
  projectPath,
  projectTitle,
} from "@/lib/types/project";

export default function ConceptsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [armedDelete, setArmedDelete] = useState<string | null>(null);

  useEffect(() => {
    let p = getProject(params.id);
    if (p && needsReadableIdMigration(p.id)) {
      const newId = maybeMigrateLegacyId(p);
      router.replace(projectPath(newId, "concepts"));
      return;
    }
    if (p) p = migrateProject(p);
    setProject(p ?? null);
    setLoaded(true);
  }, [params.id, router]);

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

  const patterns: Pattern[] = project.phase2B?.patterns ?? [];
  const concepts: Concept[] = project.concepts ?? [];

  function persist(next: Project) {
    saveProject(next);
    setProject(next);
  }

  function progressOf(c: Concept): number {
    let done = 0;
    const total = 4; // parti, keywords, strategies(all), materiality
    if (c.parti.trim()) done++;
    if (c.keywords.length) done++;
    if (
      c.spatialStrategies.length > 0 &&
      c.spatialStrategies.every((s) => s.strategy.trim())
    )
      done++;
    if (c.materiality.trim()) done++;
    return Math.round((done / total) * 100);
  }

  function handleNew() {
    if (!project) return;
    const c = emptyConcept(
      `컨셉 ${concepts.length + 1}`,
      patterns.map((p) => ({ id: p.id, title: p.title })),
    );
    const next: Project = {
      ...project,
      concepts: [...concepts, c],
      activeConceptId: c.id,
      phase: project.phase === "5" ? "5" : "4",
    };
    persist(next);
    router.push(projectPath(project.id, "phase4"));
  }

  function openConcept(
    c: Concept,
    where: "phase4" | "phase5",
  ) {
    if (!project) return;
    const next: Project = { ...project, activeConceptId: c.id };
    persist(next);
    router.push(projectPath(project.id, where));
  }

  function handleDuplicate(c: Concept) {
    if (!project) return;
    const copy: Concept = {
      ...c,
      id: newConceptId(),
      name: `${c.name} (복제)`,
      createdAt: new Date().toISOString(),
    };
    persist({
      ...project,
      concepts: [...concepts, copy],
    });
  }

  function handleRename(c: Concept) {
    if (!project) return;
    const name = renameText.trim() || c.name;
    persist({
      ...project,
      concepts: concepts.map((x) => (x.id === c.id ? { ...x, name } : x)),
    });
    setRenamingId(null);
  }

  function handleDelete(c: Concept) {
    if (!project) return;
    const remaining = concepts.filter((x) => x.id !== c.id);
    persist({
      ...project,
      concepts: remaining,
      activeConceptId:
        project.activeConceptId === c.id
          ? remaining[0]?.id
          : project.activeConceptId,
    });
    setArmedDelete(null);
  }

  return (
    <>
      {/* Header */}
      <section className="tile-light px-8 pt-12 pb-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="t-display-md">{projectTitle(project)}</h1>
          <p className="mt-3 t-body text-[var(--text-muted)]">
            한 프로젝트에서 여러 개의 설계 컨셉을 만들고 비교할 수 있습니다.
            각 컨셉은 Phase 4 에서 단계별로 구조화하고 Phase 6 에서 이미지로
            발전시킵니다.
          </p>
        </div>
      </section>

      {/* PS recap */}
      <section className="tile-parchment px-8 py-10">
        <div className="mx-auto max-w-4xl rounded-[18px] border border-[var(--hairline)] bg-white p-6">
          <p className="t-caption text-[var(--text-muted)] mb-2">
            Problem Statement <span className="ml-1 t-fine">🔒</span>
          </p>
          <blockquote className="rounded-xl border-l-4 border-[var(--accent)] bg-[var(--surface-parchment)] px-5 py-4 t-body italic text-[var(--text-ink)]">
            &ldquo;{project.finalPS}&rdquo;
          </blockquote>
        </div>
      </section>

      {/* Concept list */}
      <section className="tile-light px-8 py-12">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="t-display-md">
              컨셉{" "}
              <span className="font-mono t-caption text-[var(--text-muted)]">
                ({concepts.length})
              </span>
            </h2>
            <div className="flex flex-wrap gap-2">
              <Link
                href={projectPath(project.id, "site-analysis")}
                className="btn-pill-ghost"
              >
                주변 대지 분석
              </Link>
              <Link
                href={projectPath(project.id, "precedents")}
                className="btn-pill-ghost"
              >
                레퍼런스 선례
              </Link>
              {concepts.length > 0 && (
                <Link
                  href={projectPath(project.id, "report")}
                  className="btn-pill-ghost"
                >
                  리포트 · 보드 출력
                </Link>
              )}
              <Link
                href={projectPath(project.id, "batch")}
                className="btn-pill-ghost"
                title="컨셉을 자동으로 여러 개 생성하고 각 컨셉마다 8장의 이미지를 만들어 로컬 폴더에 저장합니다."
              >
                ⚡ 일괄 생성 (P4→P5)
              </Link>
              <Link
                href={projectPath(project.id, "batch-results")}
                className="btn-pill-ghost"
                title="일괄 생성으로 만든 컨셉들을 앱에서 확인합니다."
              >
                일괄 생성 결과
              </Link>
              <button onClick={handleNew} className="btn-pill-primary">
                + 새 컨셉
              </button>
            </div>
          </div>

          {concepts.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-[var(--hairline)] bg-[var(--surface-parchment)] px-6 py-16 text-center">
              <p className="t-body text-[var(--text-muted)]">
                아직 컨셉이 없습니다.
              </p>
              <button
                onClick={handleNew}
                className="btn-pill-primary mt-6"
              >
                첫 컨셉 만들기
              </button>
            </div>
          ) : (
            <ul className="space-y-4">
              {concepts.map((c) => {
                const isActive = c.id === project.activeConceptId;
                const pct = progressOf(c);
                return (
                  <li
                    key={c.id}
                    className={`rounded-[18px] border p-5 ${
                      isActive
                        ? "border-[var(--accent)] bg-[var(--accent)]/5"
                        : "border-[var(--hairline)] bg-white"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {renamingId === c.id ? (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={renameText}
                              onChange={(e) =>
                                setRenameText(e.target.value)
                              }
                              className="input-base"
                              autoFocus
                            />
                            <button
                              className="btn-pill-primary"
                              onClick={() => handleRename(c)}
                            >
                              저장
                            </button>
                            <button
                              className="btn-pill-ghost"
                              onClick={() => setRenamingId(null)}
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <h3 className="t-tagline">{c.name}</h3>
                            {isActive && (
                              <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 t-fine font-semibold text-black">
                                활성
                              </span>
                            )}
                          </div>
                        )}
                        <p className="mt-2 t-caption text-[var(--text-muted)]">
                          {c.parti
                            ? c.parti.slice(0, 120)
                            : "아직 구조화되지 않음"}
                        </p>
                        <div className="mt-3 flex items-center gap-3">
                          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-[var(--surface-parchment)]">
                            <div
                              className="h-full bg-[var(--accent)]"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="t-fine text-[var(--text-muted)]">
                            {pct}% · {new Date(c.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        className="btn-pill-primary"
                        onClick={() => openConcept(c, "phase4")}
                      >
                        Phase 4 구조화
                      </button>
                      <button
                        className="btn-pill-ghost"
                        onClick={() => openConcept(c, "phase5")}
                      >
                        Phase 5 이미지
                      </button>
                      <button
                        className="btn-pill-ghost"
                        onClick={() => {
                          setRenamingId(c.id);
                          setRenameText(c.name);
                        }}
                      >
                        이름 변경
                      </button>
                      <button
                        className="btn-pill-ghost"
                        onClick={() => handleDuplicate(c)}
                      >
                        복제
                      </button>
                      <button
                        className={
                          armedDelete === c.id
                            ? "rounded-full bg-[var(--error)] px-4 py-2 t-caption font-semibold text-white"
                            : "btn-pill-ghost"
                        }
                        onClick={() => {
                          if (armedDelete === c.id) handleDelete(c);
                          else setArmedDelete(c.id);
                        }}
                      >
                        {armedDelete === c.id
                          ? "한 번 더 클릭하면 삭제"
                          : "삭제"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
