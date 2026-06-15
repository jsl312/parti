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
  BatchCuration,
  Concept,
  ConceptStructure,
  Project,
  needsReadableIdMigration,
  newConceptId,
  projectPath,
  projectTitle,
} from "@/lib/types/project";
import { AppSettings, DEFAULT_SETTINGS } from "@/lib/types/settings";
import { ProviderSelect } from "@/components/ModelSelect";
import { renderConceptMd, renderPromptsMd } from "@/lib/skill/batch";

const IMG_KEY_MAP = ["1_exterior", "2_interior1", "3_interior2", "4_interior3"];

type BatchRecord = {
  runId: string;
  index: number;
  createdAt?: string;
  concept: ConceptStructure | null;
  prompts?: { role: string; prompt: string }[];
  images?: string[];
};

const keyOf = (r: { runId: string; index: number }) => `${r.runId}-${r.index}`;

// ─── Word-frequency tokenizer (for the 빈도 분석) ─────────────────────────
// Concept keywords/anchors are short PHRASES, so counting whole strings makes
// almost everything a 1. We instead split into words, strip common Korean
// particles + stopwords, and count how many concepts each WORD appears in.
const STOPWORDS = new Set([
  // Korean generic / connectors
  "그리고", "그러나", "또는", "그", "이", "저", "것", "수", "등", "및", "더",
  "한", "하는", "있는", "같은", "위한", "통해", "대한", "속", "안", "위", "아래",
  "사이", "함께", "모든", "각", "또", "좀", "매우", "가장", "그런", "이런",
  // Korean particles that may stand alone
  "을", "를", "이", "가", "은", "는", "의", "에", "에서", "으로", "로", "와",
  "과", "도", "만", "까지", "부터", "처럼", "에게",
  // English
  "the", "a", "an", "of", "and", "or", "to", "in", "on", "with", "for", "by",
  "at", "as", "is", "are", "be", "that", "this", "into", "from", "over",
  "under", "between", "its", "it",
]);

const KOR_PARTICLE =
  /(으로|에서|에게|한테|까지|부터|처럼|같이|보다|이라|라는|들의|들을|들이|을|를|이|가|은|는|의|에|와|과|도|만|로)$/;

function tokenize(s: string): string[] {
  return s
    .split(/[\s,，·•;:/()[\]{}"'“”‘’`~!?.…\-–—_|]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (/[A-Za-z]/.test(t) ? t.toLowerCase() : t))
    .map((t) => {
      // Strip a trailing Korean particle if it leaves a real stem (>=2 chars).
      const m = t.match(KOR_PARTICLE);
      if (m && t.length - m[0].length >= 2) return t.slice(0, -m[0].length);
      return t;
    })
    .filter((t) => {
      if (!t || STOPWORDS.has(t)) return false;
      if (/^\d+$/.test(t)) return false; // pure numbers
      if (/^[a-z]$/.test(t)) return false; // single Latin letter
      return true;
    });
}

function batchImgSrc(
  outputDir: string,
  rootName: string,
  runId: string,
  index: number,
  name: string,
): string {
  const idx = String(index).padStart(3, "0");
  return `/api/batch/image?outputDir=${encodeURIComponent(
    outputDir,
  )}&rootName=${encodeURIComponent(rootName)}&runId=${encodeURIComponent(
    runId,
  )}&index=${encodeURIComponent(idx)}&name=${encodeURIComponent(name)}`;
}

export default function BatchResultsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [outputDir, setOutputDir] = useState("./parti-output");
  const [items, setItems] = useState<BatchRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState<string>("");
  const [sortBy, setSortBy] = useState<"recent" | "rating">("recent");
  const [showFreq, setShowFreq] = useState(false);
  const [compareKeys, setCompareKeys] = useState<Set<string>>(new Set());
  const [showCompare, setShowCompare] = useState(false);
  const [promoted, setPromoted] = useState<Set<string>>(new Set());
  const [synthBusy, setSynthBusy] = useState(false);
  const [synthError, setSynthError] = useState<string | null>(null);
  const [synth, setSynth] = useState<{
    comparison: string;
    concept: ConceptStructure | null;
    warning?: string;
  } | null>(null);
  const [synthAdded, setSynthAdded] = useState(false);
  const [view, setView] = useState<"cards" | "moodboard">("cards");
  const [lightbox, setLightbox] = useState<{
    list: { src: string; caption: string }[];
    i: number;
  } | null>(null);
  const [renderingKey, setRenderingKey] = useState<string | null>(null);
  const [renderStatus, setRenderStatus] = useState<string | null>(null);

  useEffect(() => {
    let p = getProject(params.id);
    if (p && needsReadableIdMigration(p.id)) {
      const newId = maybeMigrateLegacyId(p);
      router.replace(projectPath(newId, "batch-results"));
      return;
    }
    if (p) p = migrateProject(p);
    setProject(p ?? null);
    const s = loadSettings();
    setSettings(s);
    setOutputDir(s.batch?.outputDir ?? "./parti-output");
    setLoaded(true);
  }, [params.id, router]);

  // Lightbox keyboard nav.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      else if (e.key === "ArrowRight")
        setLightbox((lb) =>
          lb ? { ...lb, i: (lb.i + 1) % lb.list.length } : lb,
        );
      else if (e.key === "ArrowLeft")
        setLightbox((lb) =>
          lb ? { ...lb, i: (lb.i - 1 + lb.list.length) % lb.list.length } : lb,
        );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  useEffect(() => {
    if (!loaded || !project) return;
    void refresh(project, outputDir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  async function refresh(p: Project, dir: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/batch/list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outputDir: dir, rootName: p.id }),
      });
      const data = (await res.json()) as
        | { items: BatchRecord[] }
        | { error: string };
      if (!res.ok || "error" in data) {
        setError(("error" in data && data.error) || `HTTP ${res.status}`);
        return;
      }
      setItems(data.items.filter((it) => it.concept));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function postJson<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as T & { error?: string };
    if (!res.ok || (data as { error?: string }).error) {
      throw new Error(
        (data as { error?: string }).error || `HTTP ${res.status}`,
      );
    }
    return data;
  }

  function imgListFor(rec: BatchRecord): { src: string; caption: string }[] {
    if (!project) return [];
    const idx = String(rec.index).padStart(3, "0");
    return (rec.images ?? []).map((name) => ({
      src: batchImgSrc(outputDir, project.id, rec.runId, rec.index, name),
      caption: `${rec.runId} · #${idx} · ${name}`,
    }));
  }

  // Render images on demand for a concept-only record (skip-images mode).
  async function renderImages(rec: BatchRecord) {
    if (!project || !rec.concept || !rec.prompts?.length) return;
    const comfyui = settings.image?.comfyui;
    if (!comfyui?.baseUrl) {
      setError(
        "ComfyUI 설정이 비어 있습니다. 설정 → 이미지 Provider 에서 ComfyUI를 먼저 구성하세요.",
      );
      return;
    }
    const idx = String(rec.index).padStart(3, "0");
    setRenderingKey(keyOf(rec));
    setError(null);
    try {
      const images: { name: string; dataUrl: string }[] = [];
      for (let pi = 0; pi < rec.prompts.length; pi++) {
        setRenderStatus(
          `#${idx} 이미지 렌더 중… (${pi + 1}/${rec.prompts.length})`,
        );
        const data = await postJson<{ images: { dataUrl: string }[] }>(
          "/api/phase5/image",
          {
            imageProvider: comfyui,
            prompt: rec.prompts[pi].prompt,
            count: 2,
            aspectRatio: "3:2",
          },
        );
        data.images.forEach((img, j) =>
          images.push({
            name: `${IMG_KEY_MAP[pi] ?? `p${pi + 1}`}_${j + 1}`,
            dataUrl: img.dataUrl,
          }),
        );
      }
      const conceptMd = renderConceptMd(rec.concept, {
        projectTitle: projectTitle(project),
        index: rec.index,
        finalPS: project.finalPS ?? "",
      });
      const promptsMd = renderPromptsMd(
        rec.prompts.map((p) => ({ role: p.role, prompt: p.prompt })),
        rec.concept,
      );
      await postJson("/api/batch/save", {
        outputDir,
        rootName: project.id,
        runId: rec.runId,
        index: rec.index,
        conceptMd,
        promptsMd,
        images,
        concept: rec.concept,
        prompts: rec.prompts,
      });
      await refresh(project, outputDir);
    } catch (e) {
      setError(`이미지 렌더 실패: ${(e as Error).message}`);
    } finally {
      setRenderingKey(null);
      setRenderStatus(null);
    }
  }

  const curation: Record<string, BatchCuration> = project?.batchCuration ?? {};

  function patchCuration(key: string, patch: Partial<BatchCuration>) {
    if (!project) return;
    const cur = project.batchCuration ?? {};
    const next: Project = {
      ...project,
      batchCuration: { ...cur, [key]: { ...cur[key], ...patch } },
    };
    saveProject(next);
    setProject(next);
  }

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const v of Object.values(curation))
      for (const t of v.tags ?? []) s.add(t);
    return Array.from(s).sort();
  }, [curation]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = items.filter((it) => {
      const c = it.concept;
      if (!c) return false;
      const cur = curation[keyOf(it)] ?? {};
      if (favOnly && !(cur.rating && cur.rating > 0)) return false;
      if (tagFilter && !(cur.tags ?? []).includes(tagFilter)) return false;
      if (!q) return true;
      const hay = [
        c.parti,
        c.keywords.join(" "),
        c.materiality,
        c.sceneAnchors.join(" "),
        c.spatialStrategies.map((s) => s.strategy).join(" "),
        (it.prompts ?? []).map((p) => p.prompt).join(" "),
        (cur.tags ?? []).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
    if (sortBy === "rating") {
      out.sort(
        (a, b) =>
          (curation[keyOf(b)]?.rating ?? 0) - (curation[keyOf(a)]?.rating ?? 0),
      );
    }
    return out;
  }, [items, query, favOnly, tagFilter, sortBy, curation]);

  const freq = useMemo(() => {
    // Count how many CONCEPTS each word appears in (document frequency), after
    // tokenizing the phrases — so recurring words surface instead of all-1s.
    const count = (field: "keywords" | "sceneAnchors") => {
      const m = new Map<string, number>();
      for (const it of filtered) {
        const toks = new Set<string>();
        for (const raw of it.concept?.[field] ?? [])
          for (const tok of tokenize(raw)) toks.add(tok);
        for (const tok of toks) m.set(tok, (m.get(tok) ?? 0) + 1);
      }
      let rows = Array.from(m.entries())
        .map(([label, c]) => ({ label, count: c }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      // Hide singletons once there's real signal (anything appearing 2+ times).
      if (rows.some((r) => r.count >= 2)) rows = rows.filter((r) => r.count >= 2);
      return rows.slice(0, 20);
    };
    return { keywords: count("keywords"), anchors: count("sceneAnchors") };
  }, [filtered]);

  function toggleCompare(key: string) {
    setSynth(null); // stale synthesis no longer matches the pair
    setSynthError(null);
    setSynthAdded(false);
    setCompareKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (next.size < 2) next.add(key);
      return next;
    });
  }

  const compareItems = useMemo(
    () => items.filter((it) => compareKeys.has(keyOf(it))),
    [items, compareKeys],
  );

  // ── AI compare + synthesize a new concept from the 2 compared ──────────
  async function synthesize() {
    if (!project || compareItems.length !== 2) return;
    const a = compareItems[0];
    const b = compareItems[1];
    if (!a.concept || !b.concept) {
      setSynthError("비교한 두 항목 모두 컨셉 데이터가 있어야 합니다.");
      return;
    }
    setSynthBusy(true);
    setSynthError(null);
    setSynth(null);
    setSynthAdded(false);
    try {
      const res = await fetch("/api/concepts/synthesize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: settings[settings.active],
          language: project.language,
          finalPS: project.finalPS ?? "",
          conceptA: a.concept,
          conceptB: b.concept,
          labelA: `${a.runId}-${String(a.index).padStart(3, "0")}`,
          labelB: `${b.runId}-${String(b.index).padStart(3, "0")}`,
        }),
      });
      const data = (await res.json()) as {
        comparison?: string;
        concept?: ConceptStructure | null;
        warning?: string;
        error?: string;
      };
      if (!res.ok || data.error) {
        setSynthError(data.error || `HTTP ${res.status}`);
        return;
      }
      setSynth({
        comparison: data.comparison ?? "",
        concept: data.concept ?? null,
        warning: data.warning,
      });
    } catch (e) {
      setSynthError((e as Error).message);
    } finally {
      setSynthBusy(false);
    }
  }

  function addSynthConcept() {
    if (!project || !synth?.concept) return;
    const a = compareItems[0];
    const b = compareItems[1];
    const tag =
      a && b
        ? `${String(a.index).padStart(3, "0")}+${String(b.index).padStart(3, "0")}`
        : "synth";
    const c: Concept = {
      ...synth.concept,
      id: newConceptId(),
      name: `합성 컨셉 (${tag})`,
      createdAt: new Date().toISOString(),
    };
    const next: Project = {
      ...project,
      concepts: [...(project.concepts ?? []), c],
    };
    saveProject(next);
    setProject(next);
    setSynthAdded(true);
  }

  function promote(rec: BatchRecord) {
    if (!project || !rec.concept) return;
    const idx = String(rec.index).padStart(3, "0");
    const c: Concept = {
      ...rec.concept,
      id: newConceptId(),
      name: `일괄 ${rec.runId}-${idx}`,
      createdAt: new Date().toISOString(),
    };
    const next: Project = {
      ...project,
      concepts: [...(project.concepts ?? []), c],
    };
    saveProject(next);
    setProject(next);
    setPromoted((s) => new Set(s).add(keyOf(rec)));
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
        <p className="t-body text-[var(--error)]">프로젝트를 찾을 수 없습니다.</p>
        <Link href="/" className="mt-6 inline-block btn-pill-ghost">
          ← 홈
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <section className="tile-light px-8 pt-12 pb-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex flex-wrap gap-2">
            <Link
              href={projectPath(project.id, "concepts")}
              className="btn-pill-ghost"
            >
              ← 컨셉 목록
            </Link>
            <Link
              href={projectPath(project.id, "batch")}
              className="btn-pill-ghost"
            >
              일괄 생성으로
            </Link>
          </div>
          <h1 className="t-display-md">일괄 생성 결과</h1>
          <p className="mt-3 t-body text-[var(--text-muted)]">
            별점·태그로 큐레이션하고, 빈도 분석으로 AI의 경향을 읽고, 2개를
            나란히 비교하세요. AI로 두 컨셉을 비교해 장점을 합친 새 컨셉을
            만들거나, 베스트를 &ldquo;작업 컨셉으로 추가&rdquo;해 Phase 4·5에서
            발전시킵니다.
          </p>
        </div>
      </section>

      {/* Controls */}
      <section className="tile-parchment px-8 py-8">
        <div className="mx-auto max-w-5xl space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="검색: 파르티·키워드·재료·장면·프롬프트·태그…"
              className="input-base min-w-[240px] flex-1"
            />
            <span className="t-caption text-[var(--text-muted)]">
              {filtered.length} / {items.length}개
            </span>
            <button
              className="btn-pill-ghost"
              disabled={busy}
              onClick={() => refresh(project, outputDir)}
            >
              {busy ? "불러오는 중…" : "새로고침"}
            </button>
            <ProviderSelect
              settings={settings}
              onChange={setSettings}
              label="비교·합성 AI"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-full bg-white p-1">
              <button
                onClick={() => setView("cards")}
                className={`rounded-full px-3 py-1 t-caption ${
                  view === "cards"
                    ? "bg-[var(--surface-near-black)] font-semibold text-[var(--accent)]"
                    : "text-[var(--text-muted)]"
                }`}
              >
                카드
              </button>
              <button
                onClick={() => setView("moodboard")}
                className={`rounded-full px-3 py-1 t-caption ${
                  view === "moodboard"
                    ? "bg-[var(--surface-near-black)] font-semibold text-[var(--accent)]"
                    : "text-[var(--text-muted)]"
                }`}
              >
                무드보드
              </button>
            </div>
            <button
              onClick={() => setFavOnly((v) => !v)}
              className={favOnly ? "btn-pill-primary" : "btn-pill-ghost"}
            >
              ★ 즐겨찾기만
            </button>
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="input-base w-auto py-2"
            >
              <option value="">모든 태그</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "recent" | "rating")}
              className="input-base w-auto py-2"
            >
              <option value="recent">최신순</option>
              <option value="rating">별점순</option>
            </select>
            <button
              onClick={() => setShowFreq((v) => !v)}
              className={showFreq ? "btn-pill-primary" : "btn-pill-ghost"}
            >
              📊 빈도 분석
            </button>
            <button
              onClick={() => setShowCompare(true)}
              disabled={compareKeys.size < 2}
              className="btn-pill-ghost"
              title="카드에서 2개를 담아 AI 비교 + 새 컨셉을 만드세요"
            >
              비교 보기 ({compareKeys.size}/2)
            </button>
            {compareKeys.size > 0 && (
              <button
                onClick={() => {
                  setCompareKeys(new Set());
                  setShowCompare(false);
                }}
                className="t-caption text-[var(--text-muted)] hover:text-[var(--error)]"
              >
                비교 비우기
              </button>
            )}
          </div>

          {showFreq && (
            <FreqPanel freq={freq} onPick={(t) => setQuery(t)} />
          )}
        </div>
      </section>

      {/* Compare */}
      {showCompare && compareItems.length > 0 && (
        <CompareView
          items={compareItems}
          outputDir={outputDir}
          rootName={project.id}
          providerLabel={settings.active}
          synthBusy={synthBusy}
          synthError={synthError}
          synth={synth}
          synthAdded={synthAdded}
          onSynthesize={synthesize}
          onAddSynth={addSynthConcept}
          onClose={() => setShowCompare(false)}
          onRemove={(k) => toggleCompare(k)}
        />
      )}

      {/* Body */}
      <section className="tile-light px-8 py-10">
        <div className="mx-auto max-w-5xl">
          {renderStatus && (
            <p className="mb-4 rounded-xl bg-[var(--accent)]/10 px-4 py-3 t-caption text-[var(--accent-pressed)]">
              {renderStatus}
            </p>
          )}
          {error && (
            <p className="mb-6 rounded-xl bg-[var(--error)]/10 px-4 py-3 t-caption text-[var(--error)]">
              {error}
            </p>
          )}
          {!busy && items.length === 0 && !error && (
            <p className="rounded-[18px] border border-dashed border-[var(--hairline)] bg-[var(--surface-parchment)] px-6 py-16 text-center t-caption text-[var(--text-muted)]">
              아직 저장된 일괄 생성 결과가 없습니다.{" "}
              <Link
                href={projectPath(project.id, "batch")}
                className="underline hover:text-[var(--text-ink)]"
              >
                일괄 생성
              </Link>
              에서 먼저 생성하세요.
            </p>
          )}

          {view === "moodboard" ? (
            <Moodboard
              images={filtered.flatMap((rec) => imgListFor(rec))}
              onOpen={(list, i) => setLightbox({ list, i })}
            />
          ) : (
            <ul className="space-y-6">
              {filtered.map((rec) => (
                <BatchCard
                  key={keyOf(rec)}
                  rec={rec}
                  outputDir={outputDir}
                  rootName={project.id}
                  imageList={imgListFor(rec)}
                  curation={curation[keyOf(rec)] ?? {}}
                  inCompare={compareKeys.has(keyOf(rec))}
                  compareFull={compareKeys.size >= 2}
                  promoted={promoted.has(keyOf(rec))}
                  rendering={renderingKey === keyOf(rec)}
                  onOpenImage={(i) =>
                    setLightbox({ list: imgListFor(rec), i })
                  }
                  onRate={(n) => patchCuration(keyOf(rec), { rating: n })}
                  onTags={(tags) => patchCuration(keyOf(rec), { tags })}
                  onToggleCompare={() => toggleCompare(keyOf(rec))}
                  onPromote={() => promote(rec)}
                  onRender={() => renderImages(rec)}
                />
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Lightbox */}
      {lightbox && lightbox.list[lightbox.i] && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox.list[lightbox.i].src}
            alt={lightbox.list[lightbox.i].caption}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[92vh] max-w-[94vw] rounded-lg object-contain shadow-2xl"
          />
          {lightbox.list.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightbox((lb) =>
                    lb
                      ? { ...lb, i: (lb.i - 1 + lb.list.length) % lb.list.length }
                      : lb,
                  );
                }}
                className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-white hover:bg-white/20"
                aria-label="이전"
              >
                ‹
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightbox((lb) =>
                    lb ? { ...lb, i: (lb.i + 1) % lb.list.length } : lb,
                  );
                }}
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-white hover:bg-white/20"
                aria-label="다음"
              >
                ›
              </button>
            </>
          )}
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-4 py-1.5 t-fine text-white">
            {lightbox.i + 1} / {lightbox.list.length} · {lightbox.list[lightbox.i].caption}
          </div>
          <button
            onClick={() => setLightbox(null)}
            className="absolute right-5 top-5 rounded-full bg-white/10 px-3 py-1 t-caption text-white hover:bg-white/20"
          >
            닫기 (Esc)
          </button>
        </div>
      )}
    </>
  );
}

function Moodboard({
  images,
  onOpen,
}: {
  images: { src: string; caption: string }[];
  onOpen: (list: { src: string; caption: string }[], i: number) => void;
}) {
  if (images.length === 0) {
    return (
      <p className="rounded-[18px] border border-dashed border-[var(--hairline)] bg-[var(--surface-parchment)] px-6 py-16 text-center t-caption text-[var(--text-muted)]">
        표시할 이미지가 없습니다. (이미지 스킵으로 생성한 컨셉은 카드에서
        &ldquo;이미지 렌더&rdquo;로 먼저 그려 주세요.)
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
      {images.map((im, i) => (
        <li
          key={i}
          className="aspect-[3/2] overflow-hidden rounded-lg bg-[var(--surface-parchment)]"
        >
          <button
            onClick={() => onOpen(images, i)}
            className="block h-full w-full cursor-zoom-in"
            title={im.caption}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={im.src}
              alt={im.caption}
              loading="lazy"
              className="h-full w-full object-cover transition hover:opacity-90"
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

function FreqPanel({
  freq,
  onPick,
}: {
  freq: {
    keywords: { label: string; count: number }[];
    anchors: { label: string; count: number }[];
  };
  onPick: (t: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 rounded-[18px] border border-[var(--hairline)] bg-white p-5 md:grid-cols-2">
      <FreqList title="자주 나온 키워드" rows={freq.keywords} onPick={onPick} />
      <FreqList title="자주 나온 장면 단서" rows={freq.anchors} onPick={onPick} />
    </div>
  );
}

function FreqList({
  title,
  rows,
  onPick,
}: {
  title: string;
  rows: { label: string; count: number }[];
  onPick: (t: string) => void;
}) {
  const max = rows[0]?.count ?? 1;
  return (
    <div>
      <p className="t-caption-strong mb-3 text-[var(--text-ink)]">{title}</p>
      {rows.length === 0 ? (
        <p className="t-fine text-[var(--text-muted)]">데이터가 없습니다.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.label}>
              <button
                onClick={() => onPick(r.label)}
                className="block w-full text-left"
                title="이 단어로 검색"
              >
                <div className="flex items-center justify-between t-fine text-[var(--text-ink)]">
                  <span className="truncate">{r.label}</span>
                  <span className="ml-2 font-mono text-[var(--text-muted)]">
                    {r.count}
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-parchment)]">
                  <div
                    className="h-full bg-[var(--accent)]"
                    style={{ width: `${(r.count / max) * 100}%` }}
                  />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CompareView({
  items,
  outputDir,
  rootName,
  providerLabel,
  synthBusy,
  synthError,
  synth,
  synthAdded,
  onSynthesize,
  onAddSynth,
  onClose,
  onRemove,
}: {
  items: BatchRecord[];
  outputDir: string;
  rootName: string;
  providerLabel: string;
  synthBusy: boolean;
  synthError: string | null;
  synth: {
    comparison: string;
    concept: ConceptStructure | null;
    warning?: string;
  } | null;
  synthAdded: boolean;
  onSynthesize: () => void;
  onAddSynth: () => void;
  onClose: () => void;
  onRemove: (key: string) => void;
}) {
  const ready = items.length === 2 && items.every((it) => !!it.concept);
  return (
    <section className="tile-dark px-8 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="t-display-md text-[var(--text-white)]">
            비교 ({items.length}/2)
          </h2>
          <button onClick={onClose} className="btn-pill-ghost on-dark">
            닫기
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {items.map((it) => {
            const c = it.concept;
            if (!c) return null;
            const idx = String(it.index).padStart(3, "0");
            const ext = (it.images ?? []).find((n) => /exterior/i.test(n));
            return (
              <div
                key={keyOf(it)}
                className="rounded-[18px] bg-white p-4"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono t-fine text-[var(--text-muted)]">
                    {it.runId} · #{idx}
                  </span>
                  <button
                    onClick={() => onRemove(keyOf(it))}
                    className="t-fine text-[var(--text-muted)] hover:text-[var(--error)]"
                  >
                    제거
                  </button>
                </div>
                {ext && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={batchImgSrc(outputDir, rootName, it.runId, it.index, ext)}
                    alt="exterior"
                    loading="lazy"
                    className="mb-3 aspect-[3/2] w-full rounded-lg object-cover"
                  />
                )}
                <CmpField label="파르티" value={c.parti} />
                <CmpField label="키워드" value={c.keywords.join(", ")} />
                <CmpField
                  label="공간 전략"
                  value={c.spatialStrategies
                    .filter((s) => s.strategy.trim())
                    .map((s) => `· ${s.strategy}`)
                    .join("\n")}
                />
                <CmpField label="재료 · 분위기" value={c.materiality} />
                <CmpField label="장면 단서" value={c.sceneAnchors.join(", ")} />
              </div>
            );
          })}
        </div>

        {/* AI compare + synthesize */}
        <div className="mt-6 rounded-[18px] border border-[var(--border-gray)] bg-[var(--surface-dark-1)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="t-body-strong text-[var(--text-white)]">
                ⚡ AI 비교 + 새 컨셉 합성
              </p>
              <p className="mt-1 t-caption text-[var(--text-silver)]">
                두 컨셉을 {providerLabel}로 비교해 장점을 합친 새 컨셉을
                만듭니다.
              </p>
            </div>
            <button
              onClick={onSynthesize}
              disabled={!ready || synthBusy}
              className="btn-pill-primary"
              title={
                ready
                  ? "두 컨셉을 비교하고 합성합니다"
                  : "컨셉 데이터가 있는 항목 2개가 필요합니다"
              }
            >
              {synthBusy
                ? "분석·합성 중…"
                : synth
                  ? "다시 합성"
                  : `⚡ ${providerLabel}로 비교 + 합성`}
            </button>
          </div>

          {synthError && (
            <p className="mt-4 rounded-xl bg-[var(--error)]/15 px-4 py-3 t-caption text-[var(--error)]">
              {synthError}
            </p>
          )}

          {synth && (
            <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* comparison analysis */}
              <div className="rounded-[14px] bg-[var(--surface-dark-2)] p-4">
                <p className="mb-2 t-caption-strong text-[var(--accent)]">
                  비교 분석
                </p>
                <p className="whitespace-pre-line t-caption text-[var(--text-silver)]">
                  {synth.comparison || "(분석 결과 없음)"}
                </p>
              </div>
              {/* synthesized concept */}
              <div className="rounded-[14px] bg-white p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="t-caption-strong text-[var(--accent-pressed)]">
                    합성된 새 컨셉
                  </p>
                  {synth.concept && (
                    <button
                      onClick={onAddSynth}
                      disabled={synthAdded}
                      className={synthAdded ? "btn-pill-ghost" : "btn-pill-primary"}
                    >
                      {synthAdded ? "✓ 추가됨" : "작업 컨셉으로 추가"}
                    </button>
                  )}
                </div>
                {synth.warning && (
                  <p className="mb-2 t-fine text-[var(--warning)]">
                    {synth.warning}
                  </p>
                )}
                {synth.concept && (
                  <>
                    <CmpField label="파르티" value={synth.concept.parti} />
                    <CmpField
                      label="키워드"
                      value={synth.concept.keywords.join(", ")}
                    />
                    <CmpField
                      label="공간 전략"
                      value={synth.concept.spatialStrategies
                        .filter((s) => s.strategy.trim())
                        .map((s) => `· [${s.patternTitle}] ${s.strategy}`)
                        .join("\n")}
                    />
                    <CmpField
                      label="재료 · 분위기"
                      value={synth.concept.materiality}
                    />
                    <CmpField
                      label="장면 단서"
                      value={synth.concept.sceneAnchors.join(", ")}
                    />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CmpField({ label, value }: { label: string; value: string }) {
  if (!value?.trim()) return null;
  return (
    <div className="mt-2">
      <p className="t-fine text-[var(--text-muted)]">{label}</p>
      <p className="whitespace-pre-line t-fine text-[var(--text-ink)]">
        {value}
      </p>
    </div>
  );
}

function BatchCard({
  rec,
  outputDir,
  rootName,
  imageList,
  curation,
  inCompare,
  compareFull,
  promoted,
  rendering,
  onOpenImage,
  onRate,
  onTags,
  onToggleCompare,
  onPromote,
  onRender,
}: {
  rec: BatchRecord;
  outputDir: string;
  rootName: string;
  imageList: { src: string; caption: string }[];
  curation: BatchCuration;
  inCompare: boolean;
  compareFull: boolean;
  promoted: boolean;
  rendering: boolean;
  onOpenImage: (i: number) => void;
  onRate: (n: number) => void;
  onTags: (tags: string[]) => void;
  onToggleCompare: () => void;
  onPromote: () => void;
  onRender: () => void;
}) {
  const [showPrompts, setShowPrompts] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const c = rec.concept;
  if (!c) return null;
  const idx = String(rec.index).padStart(3, "0");
  const tags = curation.tags ?? [];

  function addTag() {
    const t = tagInput.trim().replace(/^#/, "");
    if (!t || tags.includes(t)) {
      setTagInput("");
      return;
    }
    onTags([...tags, t]);
    setTagInput("");
  }

  return (
    <li className="card-light p-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="font-mono t-fine text-[var(--text-muted)]">
              {rec.runId} · #{idx}
            </span>
            <Stars value={curation.rating ?? 0} onChange={onRate} />
          </div>
          <blockquote className="rounded-xl border-l-4 border-[var(--accent)] bg-[var(--surface-parchment)] px-4 py-3 t-body italic text-[var(--text-ink)]">
            &ldquo;{c.parti}&rdquo;
          </blockquote>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button
            className={promoted ? "btn-pill-ghost" : "btn-pill-primary"}
            disabled={promoted}
            onClick={onPromote}
          >
            {promoted ? "✓ 추가됨" : "작업 컨셉으로 추가"}
          </button>
          <button
            onClick={onToggleCompare}
            disabled={!inCompare && compareFull}
            className={
              inCompare
                ? "rounded-full bg-[var(--accent)] px-3 py-1 t-fine font-semibold text-black"
                : "btn-pill-ghost"
            }
            title={compareFull && !inCompare ? "2개만 비교 가능" : "비교에 담기"}
          >
            {inCompare ? "✓ 비교에 담음" : "비교에 담기"}
          </button>
        </div>
      </div>

      {c.keywords.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {c.keywords.map((k, i) => (
            <span
              key={i}
              className="rounded-full bg-[var(--surface-near-black)] px-2.5 py-0.5 t-fine text-[var(--accent)]"
            >
              {k}
            </span>
          ))}
        </div>
      )}

      {/* Tags */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)]/15 px-2.5 py-0.5 t-fine text-[var(--accent-pressed)]"
          >
            #{t}
            <button
              onClick={() => onTags(tags.filter((x) => x !== t))}
              className="hover:text-[var(--error)]"
              aria-label="태그 삭제"
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder="+ 태그"
          className="w-24 rounded-full border border-[var(--hairline)] bg-white px-2.5 py-0.5 t-fine outline-none focus:border-[var(--accent)]"
        />
      </div>

      {/* Images */}
      {imageList.length > 0 ? (
        <ul className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {imageList.map((im, i) => (
            <li
              key={i}
              className="aspect-[3/2] overflow-hidden rounded-lg bg-[var(--surface-parchment)]"
            >
              <button
                onClick={() => onOpenImage(i)}
                className="block h-full w-full cursor-zoom-in"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={im.src}
                  alt={im.caption}
                  loading="lazy"
                  className="h-full w-full object-cover transition hover:opacity-90"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : rec.prompts && rec.prompts.length > 0 ? (
        <div className="mb-4 rounded-xl border border-dashed border-[var(--hairline)] bg-[var(--surface-parchment)] px-4 py-5 text-center">
          <p className="mb-3 t-fine text-[var(--text-muted)]">
            아직 이미지가 없습니다 (컨셉만 생성됨).
          </p>
          <button
            onClick={onRender}
            disabled={rendering}
            className="btn-pill-primary"
          >
            {rendering ? "이미지 렌더 중…" : "이미지 렌더 (8장)"}
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {c.spatialStrategies.some((s) => s.strategy.trim()) && (
          <Field label="공간 전략">
            <ul className="space-y-1.5">
              {c.spatialStrategies
                .filter((s) => s.strategy.trim())
                .map((s) => (
                  <li
                    key={s.patternId}
                    className="t-caption text-[var(--text-ink)]"
                  >
                    <span className="t-fine text-[var(--text-muted)]">
                      {s.patternTitle}:
                    </span>{" "}
                    {s.strategy}
                  </li>
                ))}
            </ul>
          </Field>
        )}
        <div className="space-y-3">
          {c.materiality && (
            <Field label="재료 · 분위기">
              <p className="t-caption text-[var(--text-ink)]">{c.materiality}</p>
            </Field>
          )}
          {c.sceneAnchors.length > 0 && (
            <Field label="장면 단서">
              <div className="flex flex-wrap gap-1.5">
                {c.sceneAnchors.map((a, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-[var(--surface-parchment)] px-2.5 py-0.5 t-fine text-[var(--text-ink)]"
                  >
                    {a}
                  </span>
                ))}
              </div>
            </Field>
          )}
        </div>
      </div>

      {rec.prompts && rec.prompts.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowPrompts((v) => !v)}
            className="t-caption text-[var(--accent-pressed)] hover:underline"
          >
            {showPrompts ? "▾ 이미지 프롬프트 숨기기" : "▸ 이미지 프롬프트 보기"}
          </button>
          {showPrompts && (
            <ul className="mt-3 space-y-3">
              {rec.prompts.map((p, i) => (
                <li
                  key={i}
                  className="rounded-xl border border-[var(--hairline)] p-3"
                >
                  <p className="t-fine text-[var(--text-muted)] mb-1">{p.role}</p>
                  <p className="font-mono text-[12px] text-[var(--text-ink)]">
                    {p.prompt}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="mt-4 font-mono t-fine text-[var(--text-muted)]">
        📁 {outputDir}/{rootName}/{rec.runId}/{idx}
      </p>
    </li>
  );
}

function Stars({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(value === n ? 0 : n)}
          className={`px-0.5 text-[15px] leading-none ${
            n <= value ? "text-[var(--accent)]" : "text-[var(--hairline)]"
          } hover:text-[var(--accent)]`}
          aria-label={`${n}점`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="t-fine text-[var(--text-muted)] mb-1">{label}</p>
      {children}
    </div>
  );
}
