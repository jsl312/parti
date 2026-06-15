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
  Phase1Prompt,
  Phase2AReview,
  Project,
  ResearchArea,
  buildUploadedResearch,
  needsReadableIdMigration,
  projectPath,
  projectTitle,
} from "@/lib/types/project";
import { AppSettings, DEFAULT_SETTINGS } from "@/lib/types/settings";
import { ProviderSelect } from "@/components/ModelSelect";
import { areaLabel, areaOrGeneralLabel } from "@/lib/skill/areaLabels";

export default function Phase1Page() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [areaResults, setAreaResults] = useState<
    Partial<Record<ResearchArea, string>>
  >({});
  const [supplement, setSupplement] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoBusy, setAutoBusy] = useState<Set<ResearchArea>>(new Set());

  useEffect(() => {
    let p = getProject(params.id);
    if (p && needsReadableIdMigration(p.id)) {
      const newId = maybeMigrateLegacyId(p);
      router.replace(projectPath(newId, "phase1"));
      return;
    }
    if (p) p = migrateProject(p);
    setProject(p ?? null);
    setAreaResults(p?.phase1AreaResults ?? {});
    setSupplement(p?.phase1Supplement ?? "");
    setSettings(loadSettings());
    setLoaded(true);
  }, [params.id, router]);

  const filledCount = useMemo(
    () =>
      Object.values(areaResults).filter((v) => (v ?? "").trim().length > 0)
        .length,
    [areaResults],
  );

  if (!loaded) {
    return (
      <div className="tile-light min-h-screen p-12">
        <p className="t-body text-[var(--text-muted)]">불러오는 중…</p>
      </div>
    );
  }
  if (!project || !project.phase1) {
    return (
      <div className="tile-light min-h-screen p-12">
        <p className="t-body text-[var(--error)]">
          프로젝트를 찾을 수 없거나 Phase 1 결과가 없습니다.
        </p>
        <Link href="/" className="mt-6 inline-block btn-pill-ghost">
          ← 홈
        </Link>
      </div>
    );
  }

  const { prompts } = project.phase1;
  const review = project.phase2A;

  function patchAreaResult(area: ResearchArea, value: string) {
    setAreaResults((prev) => ({ ...prev, [area]: value }));
  }

  async function autoResearch(area: ResearchArea, promptBody: string) {
    if (!project) return;
    setError(null);
    setAutoBusy((s) => new Set(s).add(area));
    try {
      const res = await fetch("/api/research/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: settings[settings.active],
          language: project.language,
          prompt: promptBody,
          kind: "research",
          webSearch: webOn
            ? {
                apiKey: settings.webSearch!.apiKey,
                maxResults: settings.webSearch!.maxResults,
              }
            : undefined,
        }),
      });
      const data = (await res.json()) as { text: string } | { error: string };
      if (!res.ok || "error" in data) {
        setError(("error" in data && data.error) || `HTTP ${res.status}`);
        return;
      }
      patchAreaResult(area, data.text);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAutoBusy((s) => {
        const n = new Set(s);
        n.delete(area);
        return n;
      });
    }
  }

  const webOn = !!settings.webSearch?.enabled && !!settings.webSearch?.apiKey?.trim();
  const providerLabel = webOn ? `🌐 ${settings.active} + 웹검색` : settings.active;

  async function handleAnalyze() {
    if (!project || !project.phase1) return;
    setError(null);
    setRunning(true);
    try {
      const combined = buildUploadedResearch(
        project.phase1.prompts,
        areaResults,
        supplement,
      );
      const res = await fetch("/api/phase2a", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: settings[settings.active],
          inputs: project.inputs,
          language: project.language,
          uploadedResearch: combined,
        }),
      });
      const data = (await res.json()) as
        | { result: Omit<Phase2AReview, "reviewedAt"> }
        | { error: string };
      if (!res.ok || "error" in data) {
        const msg =
          ("error" in data && data.error) || `HTTP ${res.status}`;
        setError(msg);
        return;
      }
      const reviewed: Phase2AReview = {
        ...data.result,
        reviewedAt: new Date().toISOString(),
      };
      const updated: Project = {
        ...project,
        phase: "2A",
        phase1AreaResults: areaResults,
        phase1Supplement: supplement,
        uploadedResearch: combined,
        phase2A: reviewed,
        phase2AChoice: undefined,
      };
      saveProject(updated);
      setProject(updated);
      setTimeout(() => {
        document
          .getElementById("review")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    } catch (e) {
      setError((e as Error).message || "예외 발생 (콘솔 확인)");
    } finally {
      setRunning(false);
    }
  }

  function handleChoiceA() {
    if (!project) return;
    const updated: Project = { ...project, phase2AChoice: "a" };
    saveProject(updated);
    setProject(updated);
    document
      .getElementById("paste-areas")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleChoiceB() {
    if (!project) return;
    const updated: Project = { ...project, phase2AChoice: "b", phase: "2B" };
    saveProject(updated);
    router.push(projectPath(project.id, "phase2b"));
  }

  return (
    <>
      {/* Tile 1 — Header (light) */}
      <section className="tile-light px-8 pt-12 pb-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="t-display-md">{projectTitle(project)}</h1>
          <p className="mt-3 t-body text-[var(--text-muted)]">
            각 프롬프트를 외부 AI 에 직접 돌려 붙여넣거나,{" "}
            <strong className="text-[var(--text-ink)]">⚡ 자동 조사</strong> 로
            현재 설정된 API 가 바로 채우게 할 수 있습니다. 자동 조사는 모델
            지식 기반(라이브 웹검색 아님)이라 통계·연도·고유명사는 반드시 사실
            확인하세요. 결과를 채운 뒤 [Phase 2 분석] 을 누릅니다.
          </p>
          <div className="mt-5">
            <ProviderSelect settings={settings} onChange={setSettings} />
          </div>
        </div>
      </section>

      {/* Tile 2 — Prompts (parchment) */}
      <section className="tile-parchment px-8 py-12">
        <div className="mx-auto max-w-4xl">
          <section id="paste-areas" className="space-y-5">
            {prompts.map((p, i) => (
              <PromptResultCard
                key={`${p.area}-${i}`}
                prompt={p}
                index={i}
                value={areaResults[p.area] ?? ""}
                onChange={(v) => patchAreaResult(p.area, v)}
                providerLabel={providerLabel}
                autoBusy={autoBusy.has(p.area)}
                onAuto={() => autoResearch(p.area, p.body)}
              />
            ))}
          </section>

          <section className="mt-8 rounded-[18px] border-2 border-[var(--accent)] bg-white p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="t-tagline text-[var(--text-ink)]">
                보완 자료 (선택)
              </h2>
              <span className="rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-[12px] font-semibold text-black">
                [1차] 처리
              </span>
            </div>
            <p className="mb-4 t-caption text-[var(--text-muted)]">
              Phase 2 가 플래그한 위험을 보완하려고 직접 확인한 1차 자료
              (토지이음, 통계청 SGIS, 공식 보도자료, 학술논문 등) 를 여기에
              붙여넣으세요. 분석 시 위 5개 영역의 [2차]/[미확인] findings 를
              [1차] 로 끌어올리는 데 사용됩니다.
            </p>
            <textarea
              value={supplement}
              onChange={(e) => setSupplement(e.target.value)}
              rows={8}
              className="input-base font-mono text-[13px]"
              placeholder={`예) 토지이음 (URL): 이 필지는 제2종일반주거지역, 1991년 이후 용도지역 변경 없음.\n통계청 SGIS (2025-12 기준): 성수1동 인구 19,432명, 30대 비율 28.4%.`}
            />
            <div className="mt-2 text-right t-fine text-[var(--text-muted)]">
              {supplement.length.toLocaleString()} chars
            </div>
          </section>
        </div>
      </section>

      {/* Tile 3 — Action bar (dark) */}
      <section className="tile-dark px-8 py-10">
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
            <div className="t-caption text-[var(--text-silver)]">
              결과 입력:{" "}
              <strong className="t-caption-strong text-[var(--text-white)]">
                {filledCount} / 5
              </strong>
              {supplement.trim().length > 0 && (
                <span className="ml-3 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[12px] font-semibold text-black">
                  + 보완 자료
                </span>
              )}
              {filledCount < 5 && (
                <span className="ml-3 text-[var(--warning)]">
                  (빈 영역은 &ldquo;답변 없음&rdquo; 으로 처리됩니다)
                </span>
              )}
            </div>
            <button
              onClick={handleAnalyze}
              disabled={
                running ||
                (filledCount === 0 && supplement.trim().length === 0)
              }
              className="btn-pill-primary"
            >
              {running
                ? "분석 중… (30~60초)"
                : review
                  ? "다시 분석"
                  : "Phase 2 분석"}
            </button>
          </div>
          {error && (
            <p className="mt-4 rounded-xl bg-[var(--error)]/15 px-4 py-3 t-caption text-[var(--error)]">
              {error}
            </p>
          )}
        </div>
      </section>

      {/* Tile 4 — Review (light) */}
      {review && (
        <section id="review" className="tile-light px-8 py-16">
          <div className="mx-auto max-w-4xl">
            <h2 className="t-display-md mb-8">Phase 2 분석 결과</h2>
            <ReviewView review={review} project={project} />
            <NextStepChoice
              project={project}
              onA={handleChoiceA}
              onB={handleChoiceB}
            />
          </div>
        </section>
      )}
    </>
  );
}

function PromptResultCard({
  prompt,
  index,
  value,
  onChange,
  providerLabel,
  autoBusy,
  onAuto,
}: {
  prompt: Phase1Prompt;
  index: number;
  value: string;
  onChange: (v: string) => void;
  providerLabel: string;
  autoBusy: boolean;
  onAuto: () => void;
}) {
  return (
    <div className="rounded-[18px] border border-[var(--hairline)] bg-white">
      <div className="flex items-center justify-between border-b border-[var(--hairline)] px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="font-mono t-caption text-[var(--accent-pressed)]">
            #{String(index + 1).padStart(2, "0")}
          </span>
          <h3 className="t-tagline">{prompt.title}</h3>
        </div>
        <CopyButton text={prompt.body} />
      </div>
      <div className="space-y-4 px-5 py-4">
        <details>
          <summary className="cursor-pointer t-caption text-[var(--text-muted)] hover:text-[var(--text-ink)]">
            프롬프트 본문 보기
          </summary>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-parchment)] p-4 font-mono text-[13px] leading-relaxed text-[var(--text-ink)]">
            {prompt.body}
          </pre>
        </details>
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label className="t-caption-strong text-[var(--text-ink)]">
              결과 붙여넣기
            </label>
            <button
              onClick={onAuto}
              disabled={autoBusy}
              className="btn-pill-ghost !py-1.5 !text-[13px]"
              title={`현재 설정된 ${providerLabel} 로 이 프롬프트를 실행해 결과를 자동으로 채웁니다 (사실 확인 필요).`}
            >
              {autoBusy
                ? "자동 조사 중…"
                : `⚡ ${providerLabel} 로 자동 조사`}
            </button>
          </div>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={8}
            className="input-base font-mono text-[13px]"
            placeholder="이 영역에 대한 외부 AI 응답을 그대로 붙여넣으세요…"
          />
          <div className="mt-2 text-right t-fine text-[var(--text-muted)]">
            {value.length.toLocaleString()} chars
          </div>
        </div>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }
  return (
    <button onClick={handleCopy} className="btn-pill-ghost">
      {copied ? "✓ 복사됨" : "프롬프트 복사"}
    </button>
  );
}

function ReviewView({
  review,
  project,
}: {
  review: Phase2AReview;
  project: Project;
}) {
  const lang = project.language;
  const tagPreview = Array.isArray(review.tagPreview) ? review.tagPreview : [];
  const headlineRisks = Array.isArray(review.headlineRisks)
    ? review.headlineRisks
    : [];
  const contentGaps = Array.isArray(review.contentGaps)
    ? review.contentGaps
    : [];
  return (
    <div className="space-y-6">
      <div className="rounded-[18px] border border-[var(--hairline)] bg-white p-6">
        <h3 className="t-tagline mb-4">출처 신뢰도 미리보기</h3>
        <div className="overflow-hidden rounded-xl border border-[var(--hairline)]">
          <table className="w-full t-caption">
            <thead className="bg-[var(--surface-parchment)] text-[var(--text-muted)]">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">
                  영역
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">
                  [1차]
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">
                  [2차]
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">
                  [미확인]
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">
                  메모
                </th>
              </tr>
            </thead>
            <tbody>
              {tagPreview.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-[var(--text-muted)]"
                  >
                    (응답에 표 데이터가 없습니다)
                  </td>
                </tr>
              )}
              {tagPreview.map((row, i) => (
                <tr
                  key={`${row.area ?? "unknown"}-${i}`}
                  className="border-t border-[var(--hairline)]"
                >
                  <td className="px-4 py-3">{areaLabel(row.area, lang)}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-[var(--accent-pressed)]">
                    {row.primary}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {row.secondary}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[var(--text-muted)]">
                    {row.unverified}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">
                    {row.note ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 t-fine text-[var(--text-muted)]">
          [1차] 통계청·학술논문·공식 자료 · [2차] 블로그·마케팅 리포트 ·
          [미확인] 출처 없음 — Problem Statement 헤드라인 근거는 [1차] 권장.
        </p>
      </div>

      <div className="rounded-[18px] border border-[var(--hairline)] bg-white p-6">
        <h3 className="t-tagline mb-4">헤드라인 의존 위험</h3>
        <ul className="space-y-3">
          {headlineRisks.length === 0 && (
            <li className="rounded-xl bg-[var(--surface-parchment)] px-4 py-3 t-caption text-[var(--text-muted)]">
              (응답에 헤드라인 의존 위험이 없습니다)
            </li>
          )}
          {headlineRisks.map((r, i) => (
            <li
              key={i}
              className="rounded-xl border border-[var(--hairline)] bg-[var(--surface-parchment)] p-4"
            >
              <div className="t-body-strong text-[var(--text-ink)]">
                {r.finding}
              </div>
              <div className="mt-2 t-caption text-[var(--text-muted)]">
                {r.reason}
              </div>
              <div className="mt-2 t-caption">
                <span className="text-[var(--text-muted)]">→ 검증 위치: </span>
                <strong className="text-[var(--accent-pressed)]">
                  {r.verifyAt}
                </strong>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-[18px] border border-[var(--hairline)] bg-white p-6">
        <h3 className="t-tagline mb-4">빈 영역 / 핵심 정보 누락</h3>
        <ul className="space-y-2">
          {contentGaps.length === 0 && (
            <li className="rounded-xl bg-[var(--surface-parchment)] px-4 py-3 t-caption text-[var(--text-muted)]">
              (응답에 정보 누락 항목이 없습니다)
            </li>
          )}
          {contentGaps.map((g, i) => (
            <li
              key={i}
              className="flex items-start gap-3 rounded-xl border border-[var(--hairline)] px-4 py-3"
            >
              <span className="shrink-0 whitespace-nowrap self-start rounded-full bg-[var(--surface-parchment)] px-2.5 py-1 font-mono text-[11px] text-[var(--text-muted)]">
                {areaOrGeneralLabel(g.area, lang)}
              </span>
              <span className="t-caption min-w-0 flex-1 text-[var(--text-ink)]">
                {g.description}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function NextStepChoice({
  project,
  onA,
  onB,
}: {
  project: Project;
  onA: () => void;
  onB: () => void;
}) {
  return (
    <div className="mt-10 border-t border-[var(--hairline)] pt-8">
      <h3 className="t-tagline mb-4">다음 단계</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <button
          onClick={onA}
          className={`rounded-[18px] border p-5 text-left transition-colors ${
            project.phase2AChoice === "a"
              ? "border-[var(--accent)] bg-[var(--accent)]/10"
              : "border-[var(--hairline)] bg-white hover:bg-[var(--surface-parchment)]"
          }`}
        >
          <div className="t-body-strong">(a) 검증·보완하고 다시 분석</div>
          <div className="mt-2 t-caption text-[var(--text-muted)]">
            위 위험 항목을 보완한 뒤 결과를 수정·재붙여넣기 → [다시 분석]
          </div>
        </button>
        <button
          onClick={onB}
          className="rounded-[18px] bg-[var(--surface-near-black)] p-5 text-left text-[var(--text-white)] transition-colors hover:bg-[var(--surface-dark-1)]"
        >
          <div className="t-body-strong">(b) Phase 3 진행 →</div>
          <div className="mt-2 t-caption text-[var(--text-silver)]">
            플래그된 위험을 인지한 채 본격 종합으로 이동
          </div>
        </button>
      </div>
    </div>
  );
}
