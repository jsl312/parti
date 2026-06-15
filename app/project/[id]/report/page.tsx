"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  getProject,
  maybeMigrateLegacyId,
  migrateProject,
} from "@/lib/store/projects";
import { getImageObjectUrl } from "@/lib/store/images";
import {
  moodLabel,
  styleLabel,
  viewpointLabel,
} from "@/lib/skill/phase5";
import {
  Concept,
  ConceptImage,
  Pattern,
  Project,
  ResearchArea,
  needsReadableIdMigration,
  projectPath,
  projectTitle,
} from "@/lib/types/project";

const AREA_LABEL: Record<ResearchArea, string> = {
  site_context: "사이트 맥락",
  users_community: "사용자 · 커뮤니티",
  precedent_studies: "선례 연구",
  socio_cultural: "사회 · 문화",
  typology_limits: "유형 한계",
};

export default function ReportPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [conceptFilter, setConceptFilter] = useState<string>("all");
  const [includeResearch, setIncludeResearch] = useState(true);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let p = getProject(params.id);
    if (p && needsReadableIdMigration(p.id)) {
      const newId = maybeMigrateLegacyId(p);
      router.replace(projectPath(newId, "report"));
      return;
    }
    if (p) p = migrateProject(p);
    setProject(p ?? null);
    setLoaded(true);
  }, [params.id, router]);

  // Gather every blob key referenced by the project (generated concept images)
  // and resolve them to object URLs for <img>.
  const blobKeys = useMemo(() => {
    if (!project) return [] as string[];
    const keys = new Set<string>();
    for (const img of project.phase5?.images ?? []) keys.add(img.blobKey);
    return [...keys];
  }, [project]);

  useEffect(() => {
    let revoked = false;
    const created: string[] = [];
    (async () => {
      const next: Record<string, string> = {};
      for (const k of blobKeys) {
        const url = await getImageObjectUrl(k);
        if (url) {
          next[k] = url;
          created.push(url);
        }
      }
      if (!revoked) setUrls(next);
      else created.forEach((u) => URL.revokeObjectURL(u));
    })();
    return () => {
      revoked = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [blobKeys]);

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

  const allConcepts: Concept[] = project.concepts ?? [];
  const concepts =
    conceptFilter === "all"
      ? allConcepts
      : allConcepts.filter((c) => c.id === conceptFilter);
  const patterns: Pattern[] = project.phase2B?.patterns ?? [];
  const findings = project.phase2B?.findings ?? [];
  const precedentItems = project.precedents?.items ?? [];
  const precAngleTitle = (code?: string) =>
    project.precedents?.prompts?.find((p) => p.angle === code)?.title;
  const precedentNotes = project.precedents?.notes?.trim();
  const hasPrecedents = precedentItems.length > 0 || !!precedentNotes;
  const images = project.phase5?.images ?? [];
  // Only when viewing all concepts: surface images that are untagged or tied to
  // a deleted concept in a separate "기타" section. When a single concept is
  // selected, its images live in its own block and others are simply hidden.
  const allConceptIds = new Set(allConcepts.map((c) => c.id));
  const orphanImages =
    conceptFilter === "all"
      ? images.filter(
          (img) => !img.conceptId || !allConceptIds.has(img.conceptId),
        )
      : [];
  const { inputs } = project;
  const lang = project.language;

  function buildMarkdown(): string {
    const cell = (s: string) => s.replace(/\|/g, "\\|");
    const imgLine = (im: ConceptImage) =>
      `${viewpointLabel(im.params.viewpoint, lang)} · ${moodLabel(
        im.params.mood,
        lang,
      )} · ${styleLabel(im.params.style, lang)}`;
    const bullets = (text: string) =>
      text
        .split(/\r?\n/)
        .map((l) => l.replace(/^\s*[•\-]\s*/, "").trim())
        .filter(Boolean)
        .map((l) => `  - ${l}`)
        .join("\n");

    const L: string[] = [];
    L.push(`# ${projectTitle(project!)}`);
    L.push("");
    L.push(`> Parti · Project Report — ${new Date().toLocaleString()}`);
    L.push("");
    L.push(`| 항목 | 내용 |`);
    L.push(`| --- | --- |`);
    L.push(`| 사이트 | ${cell(inputs.site)} |`);
    L.push(`| 공간 유형 | ${cell(inputs.typology)} |`);
    if (inputs.scale) L.push(`| 규모 | ${cell(inputs.scale)} |`);
    if (inputs.client) L.push(`| 클라이언트 | ${cell(inputs.client)} |`);
    if (inputs.constraints)
      L.push(`| 제약 | ${cell(inputs.constraints)} |`);
    L.push("");

    if (project!.finalPS) {
      L.push(`## Problem Statement`);
      L.push("");
      L.push(`> ${project!.finalPS}`);
      L.push("");
    }

    if (
      includeResearch &&
      (patterns.length > 0 || findings.length > 0 || hasPrecedents)
    ) {
      L.push(`## 리서치 종합`);
      L.push("");
      if (patterns.length > 0) {
        L.push(`### 핵심 패턴`);
        L.push("");
        for (const p of patterns)
          L.push(`- **${p.label}. ${p.title}** — ${p.rationale}`);
        L.push("");
      }
      if (findings.length > 0) {
        L.push(`### 핵심 findings (${findings.length})`);
        L.push("");
        for (const f of findings) {
          L.push(
            `- **${f.headline}** _(${AREA_LABEL[f.area]} · ${f.confidence})_`,
          );
          if (f.detail) L.push(`  ${f.detail}`);
        }
        L.push("");
      }
      if (precedentItems.length > 0) {
        L.push(`### 수집한 선례 (${precedentItems.length})`);
        L.push("");
        for (const it of precedentItems) {
          const meta = [it.architect, it.year, it.location]
            .filter(Boolean)
            .join(" · ");
          L.push(`#### ${it.name}${meta ? ` — ${meta}` : ""}`);
          const tag = precAngleTitle(it.angle);
          if (tag) L.push(`*태그: ${tag}*`);
          if (it.strategy) {
            L.push(`- 핵심 공간 전략`);
            L.push(bullets(it.strategy));
          }
          if (it.relevance) {
            L.push(`- 본 프로젝트와의 연관성`);
            L.push(bullets(it.relevance));
          }
          if (it.sourceUrl) L.push(`- 출처: ${it.sourceUrl}`);
          L.push("");
        }
      } else if (precedentNotes) {
        L.push(`### 수집한 선례`);
        L.push("");
        L.push(precedentNotes);
        L.push("");
      }
    }

    if (concepts.length > 0) {
      L.push(`## 설계 컨셉`);
      L.push("");
      for (const c of concepts) {
        L.push(`### ${c.name}`);
        L.push("");
        if (c.parti) {
          L.push(`> ${c.parti}`);
          L.push("");
        }
        if (c.keywords.length > 0) {
          L.push(`**키워드**: ${c.keywords.join(", ")}`);
          L.push("");
        }
        const strat = c.spatialStrategies.filter((s) => s.strategy.trim());
        if (strat.length > 0) {
          L.push(`**공간 전략**`);
          L.push("");
          for (const s of strat)
            L.push(`- [${s.patternTitle}] ${s.strategy}`);
          L.push("");
        }
        if (c.materiality) {
          L.push(`**재료 · 분위기**: ${c.materiality}`);
          L.push("");
        }
        if (c.sceneAnchors.length > 0) {
          L.push(`**장면 요소**: ${c.sceneAnchors.join(" · ")}`);
          L.push("");
        }
        const cimgs = images.filter((i) => i.conceptId === c.id);
        if (cimgs.length > 0) {
          L.push(`**컨셉 이미지** (${cimgs.length})`);
          L.push("");
          for (const im of cimgs) L.push(`- ${imgLine(im)}`);
          L.push("");
        }
      }
    }

    if (orphanImages.length > 0) {
      L.push(`## 기타 컨셉 이미지 (${orphanImages.length})`);
      L.push("");
      for (const im of orphanImages) L.push(`- ${imgLine(im)}`);
      L.push("");
    }

    L.push(`---`);
    L.push(
      `*${projectTitle(project!)} · Parti · ${new Date().toLocaleString()}*`,
    );
    return L.join("\n");
  }

  function downloadMarkdown() {
    const md = buildMarkdown();
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `parti-report-${stamp}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="report-root tile-light min-h-screen">
      {/* ─── Toolbar (hidden in print) ───────────────────────────── */}
      <div className="print-hide sticky top-0 z-10 border-b border-[var(--hairline)] bg-white/90 px-8 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3">
          <Link
            href={projectPath(project.id, "concepts")}
            className="t-caption text-[var(--text-muted)] hover:text-[var(--text-ink)]"
          >
            ← 컨셉 목록
          </Link>
          <span className="text-[var(--hairline)]">/</span>
          <span className="t-caption-strong">리포트 · 보드</span>

          <div className="ml-auto flex flex-wrap items-center gap-3">
            {allConcepts.length > 1 && (
              <select
                value={conceptFilter}
                onChange={(e) => setConceptFilter(e.target.value)}
                className="input-base !w-auto !py-2 !text-[14px]"
                aria-label="컨셉 선택"
              >
                <option value="all">전체 컨셉 ({allConcepts.length})</option>
                {allConcepts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-2 t-caption text-[var(--text-muted)]">
              <input
                type="checkbox"
                checked={includeResearch}
                onChange={(e) => setIncludeResearch(e.target.checked)}
              />
              리서치 근거 포함
            </label>
            <button onClick={downloadMarkdown} className="btn-pill-ghost">
              MD 다운로드
            </button>
            <button
              onClick={() => window.print()}
              className="btn-pill-primary"
            >
              PDF로 저장 / 인쇄
            </button>
          </div>
        </div>
        <p className="mx-auto mt-2 max-w-4xl t-fine text-[var(--text-muted)]">
          인쇄 대화상자에서 대상을 &ldquo;PDF로 저장&rdquo;, 용지를 A4 또는
          A3, 여백을 기본/없음으로 설정하면 깔끔하게 출력됩니다. &ldquo;배경
          그래픽&rdquo; 옵션을 켜면 색상·구분선이 그대로 나옵니다.
        </p>
      </div>

      {/* ─── Document ────────────────────────────────────────────── */}
      <article className="report-doc mx-auto max-w-4xl px-8 py-12">
        {/* Cover */}
        <header className="print-avoid-break border-b-2 border-[var(--text-ink)] pb-8">
          <p className="t-caption text-[var(--text-muted)]">
            Parti · Project Report
          </p>
          <h1 className="t-display-lg mt-3">{projectTitle(project)}</h1>
          <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-3 md:grid-cols-3">
            <Field label="사이트" value={inputs.site} />
            <Field label="공간 유형" value={inputs.typology} />
            {inputs.scale && <Field label="규모" value={inputs.scale} />}
            {inputs.client && <Field label="클라이언트" value={inputs.client} />}
            {inputs.constraints && (
              <Field label="제약" value={inputs.constraints} />
            )}
            <Field
              label="생성일"
              value={new Date().toLocaleDateString()}
            />
          </dl>
        </header>

        {/* Problem Statement */}
        {project.finalPS && (
          <section className="print-avoid-break mt-10">
            <SectionTitle index="01" title="Problem Statement" />
            <blockquote className="mt-4 rounded-xl border-l-4 border-[var(--accent)] bg-[var(--surface-parchment)] px-6 py-5 t-lead italic">
              &ldquo;{project.finalPS}&rdquo;
            </blockquote>
          </section>
        )}

        {/* Research synthesis */}
        {includeResearch &&
          (patterns.length > 0 || findings.length > 0 || hasPrecedents) && (
          <section className="mt-12">
            <SectionTitle index="02" title="리서치 종합" />

            {patterns.length > 0 && (
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                {patterns.map((p) => (
                  <div
                    key={p.id}
                    className="print-avoid-break rounded-xl border border-[var(--hairline)] p-4"
                  >
                    <p className="t-caption-strong">
                      <span className="font-mono text-[var(--accent-pressed)]">
                        {p.label}.
                      </span>{" "}
                      {p.title}
                    </p>
                    <p className="mt-2 t-caption text-[var(--text-muted)]">
                      {p.rationale}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {findings.length > 0 && (
              <div className="mt-6">
                <p className="t-caption-strong mb-2 text-[var(--text-muted)]">
                  핵심 findings ({findings.length})
                </p>
                <ul className="divide-y divide-[var(--hairline)] rounded-xl border border-[var(--hairline)]">
                  {findings.map((f) => (
                    <li
                      key={f.id}
                      className="print-avoid-break px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="t-caption-strong">{f.headline}</p>
                        <span className="shrink-0 rounded-full bg-[var(--surface-parchment)] px-2 py-0.5 t-fine font-mono">
                          {AREA_LABEL[f.area]} · {f.confidence}
                        </span>
                      </div>
                      <p className="mt-1 t-caption text-[var(--text-muted)]">
                        {f.detail}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {precedentItems.length > 0 && (
              <div className="mt-6">
                <p className="t-caption-strong mb-2 text-[var(--text-muted)]">
                  수집한 선례 ({precedentItems.length})
                </p>
                <ul className="space-y-2">
                  {precedentItems.map((it) => (
                    <li
                      key={it.id}
                      className="print-avoid-break rounded-xl border border-[var(--hairline)] px-4 py-3"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="t-caption-strong">{it.name}</p>
                        <span className="shrink-0 t-fine text-[var(--text-muted)]">
                          {[it.architect, it.year].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                      {precAngleTitle(it.angle) && (
                        <span className="mt-1 inline-block rounded-full bg-[var(--surface-parchment)] px-2 py-0.5 t-fine text-[var(--text-muted)]">
                          {precAngleTitle(it.angle)}
                        </span>
                      )}
                      {it.strategy && (
                        <p className="mt-1 whitespace-pre-line t-caption text-[var(--text-muted)]">
                          {it.strategy}
                        </p>
                      )}
                      {it.relevance && (
                        <div className="mt-1 t-caption">
                          <span className="text-[var(--text-muted)]">
                            연관성
                          </span>
                          <p className="whitespace-pre-line">{it.relevance}</p>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {precedentItems.length === 0 && precedentNotes && (
              <div className="print-avoid-break mt-6">
                <p className="t-caption-strong mb-2 text-[var(--text-muted)]">
                  수집한 선례
                </p>
                <pre className="whitespace-pre-wrap break-words rounded-xl border border-[var(--hairline)] bg-[var(--surface-parchment)] p-4 t-caption leading-relaxed text-[var(--text-ink)]">
                  {precedentNotes}
                </pre>
              </div>
            )}
          </section>
        )}

        {/* Concepts (each with its own generated images) */}
        {concepts.length > 0 && (
          <section className="mt-12">
            <SectionTitle index="03" title="설계 컨셉" />
            <div className="mt-4 space-y-10">
              {concepts.map((c) => (
                <ConceptBlock
                  key={c.id}
                  concept={c}
                  urls={urls}
                  lang={lang}
                  images={images.filter((img) => img.conceptId === c.id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Generated images not tied to any (filtered) concept */}
        {orphanImages.length > 0 && (
          <section className="report-break mt-12">
            <SectionTitle index="04" title="기타 컨셉 이미지" />
            <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
              {orphanImages.map((img) => (
                <ImageFigure key={img.id} img={img} url={urls[img.blobKey]} lang={lang} />
              ))}
            </div>
          </section>
        )}

        <footer className="mt-16 border-t border-[var(--hairline)] pt-4 t-fine text-[var(--text-muted)]">
          {projectTitle(project)} · Parti ·{" "}
          {new Date().toLocaleString()}
        </footer>
      </article>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="t-fine uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </dt>
      <dd className="mt-0.5 t-caption-strong">{value}</dd>
    </div>
  );
}

function SectionTitle({ index, title }: { index: string; title: string }) {
  return (
    <h2 className="flex items-baseline gap-3 t-display-md">
      <span className="font-mono text-[18px] text-[var(--accent-pressed)]">
        {index}
      </span>
      {title}
    </h2>
  );
}

function ConceptBlock({
  concept: c,
  urls,
  images,
  lang,
}: {
  concept: Concept;
  urls: Record<string, string>;
  images: ConceptImage[];
  lang: "ko" | "en";
}) {
  return (
    <div className="print-avoid-break rounded-2xl border border-[var(--hairline)] p-6">
      <h3 className="t-tagline">{c.name}</h3>

      {c.parti && (
        <p className="mt-3 t-body italic text-[var(--text-ink)]">
          {c.parti}
        </p>
      )}

      {c.keywords.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {c.keywords.map((k, i) => (
            <span
              key={i}
              className="rounded-full bg-[var(--surface-parchment)] px-3 py-1 t-fine font-medium"
            >
              {k}
            </span>
          ))}
        </div>
      )}

      <div className="mt-5">
        {c.spatialStrategies.some((s) => s.strategy.trim()) && (
          <div>
            <p className="t-caption-strong text-[var(--text-muted)]">
              공간 전략
            </p>
            <ul className="mt-2 space-y-2">
              {c.spatialStrategies
                .filter((s) => s.strategy.trim())
                .map((s, i) => (
                  <li key={i} className="t-caption">
                    <span className="font-mono text-[var(--accent-pressed)]">
                      ·
                    </span>{" "}
                    <span className="text-[var(--text-muted)]">
                      [{s.patternTitle}]
                    </span>{" "}
                    {s.strategy}
                  </li>
                ))}
            </ul>
          </div>
        )}

        {c.materiality && (
          <div className="mt-4">
            <p className="t-caption-strong text-[var(--text-muted)]">
              재료 · 분위기
            </p>
            <p className="mt-1 t-caption">{c.materiality}</p>
          </div>
        )}

        {c.sceneAnchors.length > 0 && (
          <div className="mt-4">
            <p className="t-caption-strong text-[var(--text-muted)]">
              장면 요소
            </p>
            <p className="mt-1 t-caption">{c.sceneAnchors.join(" · ")}</p>
          </div>
        )}
      </div>

      {images.length > 0 && (
        <div className="mt-6">
          <p className="t-caption-strong mb-2 text-[var(--text-muted)]">
            컨셉 이미지 ({images.length})
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {images.map((img) => (
              <ImageFigure key={img.id} img={img} url={urls[img.blobKey]} lang={lang} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ImageFigure({
  img,
  url,
  lang,
}: {
  img: ConceptImage;
  url?: string;
  lang: "ko" | "en";
}) {
  return (
    <figure className="print-avoid-break overflow-hidden rounded-xl border border-[var(--hairline)]">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={img.prompt.slice(0, 60)} className="block w-full" />
      ) : (
        <div className="flex aspect-video items-center justify-center bg-[var(--surface-parchment)] t-caption text-[var(--text-muted)]">
          이미지 로드 중…
        </div>
      )}
      <figcaption className="px-3 py-2 t-fine text-[var(--text-muted)]">
        {viewpointLabel(img.params.viewpoint, lang)} ·{" "}
        {moodLabel(img.params.mood, lang)} · {styleLabel(img.params.style, lang)}
      </figcaption>
    </figure>
  );
}
