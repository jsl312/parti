"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppSettings, DEFAULT_SETTINGS } from "@/lib/types/settings";
import { loadSettings } from "@/lib/store/settings";
import {
  deleteProject,
  importProjects,
  listProjects,
  migrateProject,
} from "@/lib/store/projects";
import {
  ExportedImage,
  exportImagesForProjects,
  importImages,
} from "@/lib/store/images";
import { Project, projectPath, projectTitle } from "@/lib/types/project";

// Derive a stable status label from durable signals (phase5 / phase4 entered /
// finalPS confirmed) rather than the mutable `phase` marker, which gets
// overwritten when the user re-runs Phase 1/2.
function phaseLabel(p: Project): string {
  if (p.phase5) return "Phase 6 · 이미지";
  if (p.concepts && p.concepts.length > 0)
    return `Phase 4 · 컨셉 ${p.concepts.length}`;
  if (p.finalPS) return "Phase 3 · 확정";
  switch (p.phase) {
    case "1":
      return "Phase 1";
    case "2A":
      return "Phase 2";
    default:
      return "Phase 3";
  }
}

function projectRoute(p: Project): string {
  if (p.phase5) return projectPath(p.id, "phase5");
  if ((p.concepts && p.concepts.length > 0) || p.finalPS)
    return projectPath(p.id, "concepts");
  if (p.phase === "2B") return projectPath(p.id, "phase2b");
  return projectPath(p.id, "phase1");
}

export default function Home() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);

  useEffect(() => {
    setSettings(loadSettings());
    // Normalize legacy projects (old image-shaped phase4 → phase5, legacy
    // single concept → concepts library).
    setProjects(listProjects().map((p) => migrateProject(p)));
    setLoaded(true);
  }, []);

  const activeLabel =
    settings.active === "ollama"
      ? `Ollama · ${settings.ollama.model}`
      : settings.active === "anthropic"
        ? `Anthropic · ${settings.anthropic.model}`
        : `Gemini · ${settings.gemini.model}`;

  const hasCredentials =
    settings.active === "ollama"
      ? Boolean(settings.ollama.baseUrl && settings.ollama.model)
      : settings.active === "anthropic"
        ? Boolean(settings.anthropic.apiKey)
        : Boolean(settings.gemini.apiKey);

  function handleDelete(id: string) {
    if (!confirm("이 프로젝트를 삭제하시겠습니까?")) return;
    deleteProject(id);
    setProjects(listProjects());
  }

  function flashBackup(m: string) {
    setBackupMsg(m);
    setTimeout(() => setBackupMsg(null), 4000);
  }

  async function handleExport() {
    const all = listProjects();
    if (all.length === 0) {
      flashBackup("내보낼 프로젝트가 없습니다.");
      return;
    }
    setBackupBusy(true);
    try {
      const images = await exportImagesForProjects(all.map((p) => p.id));
      const data = {
        app: "parti",
        kind: "parti-backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        projects: all,
        images,
      };
      const blob = new Blob([JSON.stringify(data)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `parti-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      flashBackup(
        `백업 완료: 프로젝트 ${all.length}개, 이미지 ${images.length}개`,
      );
    } catch (e) {
      flashBackup(`백업 실패: ${(e as Error).message}`);
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleImport(file: File) {
    setBackupBusy(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text) as {
        kind?: string;
        projects?: Project[];
        images?: ExportedImage[];
      };
      if (data.kind !== "parti-backup" || !Array.isArray(data.projects)) {
        flashBackup("올바른 Parti 백업 파일이 아닙니다.");
        return;
      }
      if (
        !confirm(
          `백업을 가져오면 같은 ID의 프로젝트는 백업 내용으로 덮어쓰고, 새 프로젝트는 추가됩니다. 계속할까요? (프로젝트 ${data.projects.length}개)`,
        )
      ) {
        return;
      }
      if (Array.isArray(data.images)) await importImages(data.images);
      const { added, updated } = importProjects(data.projects);
      setProjects(listProjects().map((p) => migrateProject(p)));
      flashBackup(`가져오기 완료: 추가 ${added}개, 갱신 ${updated}개`);
    } catch (e) {
      flashBackup(`가져오기 실패: ${(e as Error).message}`);
    } finally {
      setBackupBusy(false);
    }
  }

  return (
    <>
      {/* Tile 1 — Hero (light) */}
      <section className="tile-light px-8 py-20 md:py-32">
        <div className="mx-auto max-w-5xl">
          <p className="t-caption text-[var(--text-muted)] mb-4">
            Parti · Pre-design concept studio
          </p>
          <h1 className="t-hero max-w-3xl">
            사이트에서
            <br />
            컨셉 이미지까지.
          </h1>
          <p className="t-lead mt-6 max-w-2xl text-[var(--text-muted)]">
            사이트와 공간 유형에서 출발해 Problem Statement 를 정제하고,
            설계 컨셉 · 컨셉 이미지까지 이어지는 사전 설계 워크플로우입니다.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/project/new"
              aria-disabled={!hasCredentials}
              className={`btn-pill-primary ${!hasCredentials ? "pointer-events-none opacity-50" : ""}`}
            >
              새 프로젝트 시작
            </Link>
            <Link href="/settings" className="btn-pill-ghost">
              설정 변경
            </Link>
          </div>

          <div className="mt-10 inline-flex items-center gap-2 t-caption text-[var(--text-muted)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            현재 LLM:&nbsp;
            <span className="font-mono text-[var(--text-ink)]">
              {loaded ? activeLabel : "…"}
            </span>
          </div>
          {loaded && !hasCredentials && (
            <p className="mt-3 t-caption text-[var(--error)]">
              {settings.active === "ollama"
                ? "Ollama base URL / model 이 비어 있습니다."
                : "API 키가 비어 있습니다. 설정에서 입력해 주세요."}
            </p>
          )}
        </div>
      </section>

      {/* Tile 2 — Projects (dark) */}
      <section className="tile-dark px-8 py-20 md:py-24">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="t-display-md">프로젝트</h2>
              <p className="t-caption mt-2 text-[var(--text-silver)]">
                {projects.length}개 보관 중
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="btn-pill-ghost on-dark cursor-pointer">
                {backupBusy ? "처리 중…" : "가져오기"}
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  disabled={backupBusy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleImport(f);
                    e.target.value = "";
                  }}
                />
              </label>
              {projects.length > 0 && (
                <button
                  onClick={handleExport}
                  disabled={backupBusy}
                  className="btn-pill-ghost on-dark"
                >
                  백업 내보내기
                </button>
              )}
              {projects.length > 0 && (
                <Link
                  href="/project/new"
                  aria-disabled={!hasCredentials}
                  className={`btn-pill-primary ${!hasCredentials ? "pointer-events-none opacity-50" : ""}`}
                >
                  + 새 프로젝트
                </Link>
              )}
            </div>
          </div>

          {backupMsg && (
            <p className="mb-6 rounded-xl bg-[var(--surface-dark-2)] px-4 py-3 t-caption text-[var(--accent)]">
              {backupMsg}
            </p>
          )}

          {loaded && projects.length === 0 && (
            <div className="card-dark text-center py-16">
              <p className="t-body text-[var(--text-silver)]">
                아직 프로젝트가 없습니다.
              </p>
              <Link
                href="/project/new"
                aria-disabled={!hasCredentials}
                className={`btn-pill-primary mt-6 ${!hasCredentials ? "pointer-events-none opacity-50" : ""}`}
              >
                첫 프로젝트 시작
              </Link>
            </div>
          )}

          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {projects.map((p) => (
              <li key={p.id} className="card-dark group flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={projectRoute(p)}
                    className="t-body-strong block flex-1 text-[var(--text-white)] hover:text-[var(--accent)]"
                  >
                    {projectTitle(p)}
                  </Link>
                  <button
                    onClick={() => handleDelete(p.id)}
                    className="t-small text-[var(--text-silver)] hover:text-[var(--error)] opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label="삭제"
                  >
                    삭제
                  </button>
                </div>
                <div className="mt-4 flex items-center gap-3 t-caption text-[var(--text-silver)]">
                  <span className="rounded bg-[var(--surface-dark-2)] px-2 py-0.5 font-mono text-[12px]">
                    {phaseLabel(p)}
                  </span>
                  <span>{new Date(p.updatedAt).toLocaleString()}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Tile 3 — How it works (parchment) */}
      <section className="tile-parchment px-8 py-20 md:py-28">
        <div className="mx-auto max-w-5xl">
          <h2 className="t-display-md mb-4">작동 방식</h2>
          <p className="t-body max-w-2xl text-[var(--text-muted)]">
            무거운 웹 검색은 외부 AI (Perplexity, ChatGPT, Gemini) 에 위임하고,
            앱은 프롬프트 생성 · 자료 점검 · 종합 · 컨셉화 · 시각화 · 문서화에
            집중합니다.
          </p>

          <ol className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            <WorkflowStep
              badge="P1–3"
              title="리서치 → 문제정의"
              body="사이트·공간 유형을 입력하면 5개 영역의 외부 AI 리서치 프롬프트를 생성하고, 붙여넣은 결과의 출처 신뢰도를 점검한 뒤, findings·패턴으로 종합해 단일 문장의 Problem Statement 를 확정합니다."
            />
            <WorkflowStep
              badge="P4"
              title="컨셉 구조화"
              body="Problem Statement 를 바탕으로 파르티 · 키워드 · 공간 전략 · 재료를 갖춘 설계 컨셉을 단계별로 만듭니다. 한 프로젝트에 여러 컨셉을 두고 비교할 수 있습니다."
            />
            <WorkflowStep
              badge="P5"
              title="컨셉 이미지"
              body="구조화한 컨셉을 바탕으로 시점·시간·표현 양식을 골라 컨셉 이미지를 생성합니다. 생성 이미지에 피드백을 주면 재료·장면 단서를 역으로 보정합니다."
            />
          </ol>

          <p className="mt-12 t-caption text-[var(--text-muted)]">
            그 외 주변 대지 분석(V-World), 레퍼런스 선례 수집, 리포트 · 보드
            PDF/MD 출력을 지원합니다. 텍스트 LLM 은 Ollama (로컬) / Anthropic /
            Gemini, 이미지는 ComfyUI (로컬) / OpenAI / Gemini 중 [설정 변경]
            에서 선택합니다.
          </p>
        </div>
      </section>
    </>
  );
}

function WorkflowStep({
  badge,
  title,
  body,
}: {
  badge: string;
  title: string;
  body: string;
}) {
  return (
    <li className="card-light flex flex-col">
      <span className="t-caption-strong font-mono text-[var(--accent-pressed)]">
        {badge}
      </span>
      <h3 className="t-tagline mt-4">{title}</h3>
      <p className="t-caption mt-3 text-[var(--text-muted)]">{body}</p>
    </li>
  );
}
