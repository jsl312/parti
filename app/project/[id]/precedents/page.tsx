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
import { getImageObjectUrl, putDataUrl, putImage } from "@/lib/store/images";
import { loadSettings } from "@/lib/store/settings";
import { AppSettings, DEFAULT_SETTINGS } from "@/lib/types/settings";
import { ProviderSelect } from "@/components/ModelSelect";
import {
  Concept,
  PrecedentItem,
  PrecedentPrompt,
  PrecedentStudy,
  Project,
  getActiveConcept,
  needsReadableIdMigration,
  projectPath,
  projectTitle,
} from "@/lib/types/project";

const EXTERNAL_AIS: { label: string; url: string }[] = [
  { label: "Perplexity", url: "https://www.perplexity.ai" },
  { label: "ChatGPT", url: "https://chatgpt.com" },
  { label: "Gemini", url: "https://gemini.google.com" },
];

type ParsedItem = Omit<PrecedentItem, "id" | "createdAt">;

function newItemId(): string {
  return `prc_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export default function PrecedentsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pasteText, setPasteText] = useState("");
  const [pasteAngle, setPasteAngle] = useState<string>("");
  const [autoAngle, setAutoAngle] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseMsg, setParseMsg] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [groupByTag, setGroupByTag] = useState(true);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [searchingIds, setSearchingIds] = useState<Set<string>>(new Set());
  const [photoNote, setPhotoNote] = useState<Record<string, string>>({});

  useEffect(() => {
    let p = getProject(params.id);
    if (p && needsReadableIdMigration(p.id)) {
      const newId = maybeMigrateLegacyId(p);
      router.replace(projectPath(newId, "precedents"));
      return;
    }
    if (p) p = migrateProject(p);
    setProject(p ?? null);
    setSettings(loadSettings());
    setLoaded(true);
  }, [params.id, router]);

  const study: PrecedentStudy | undefined = project?.precedents;
  const items = study?.items ?? [];
  const angleOptions = (study?.prompts ?? []).map((p) => ({
    code: p.angle,
    title: p.title,
  }));
  const angleTitle = (code?: string) =>
    angleOptions.find((a) => a.code === code)?.title;

  // Resolve photo blobs → object URLs for thumbnails / detail. Incremental and
  // non-destructive: only resolves blob keys not already in the map (entries
  // set directly on attach/auto-search are kept), so photos appear instantly.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const additions: Record<string, string> = {};
      for (const it of items) {
        const key = it.photoBlobKey;
        if (!key || photoUrls[key]) continue;
        const url = await getImageObjectUrl(key);
        if (url) additions[key] = url;
      }
      if (!cancelled && Object.keys(additions).length > 0) {
        setPhotoUrls((prev) => ({ ...prev, ...additions }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((i) => `${i.id}:${i.photoBlobKey ?? ""}`).join(",")]);

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

  const activeConcept: Concept | undefined = getActiveConcept(project);
  const selected = items.find((i) => i.id === selectedId);

  function persist(next: Project) {
    saveProject(next);
    setProject(next);
  }

  function patchStudy(patch: Partial<PrecedentStudy>) {
    if (!project) return;
    const base: PrecedentStudy = project.precedents ?? {
      prompts: [],
      items: [],
      generatedAt: new Date().toISOString(),
    };
    persist({ ...project, precedents: { ...base, ...patch } });
  }

  async function handleGenerate() {
    if (!project) return;
    setError(null);
    setRunning(true);
    try {
      const c = activeConcept;
      const concept = c
        ? {
            parti: c.parti || undefined,
            keywords: c.keywords?.length ? c.keywords : undefined,
            strategies: c.spatialStrategies
              ?.map((s) => s.strategy.trim())
              .filter(Boolean),
            materiality: c.materiality || undefined,
          }
        : undefined;
      const res = await fetch("/api/precedents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: settings[settings.active],
          inputs: project.inputs,
          language: project.language,
          finalPS: project.finalPS,
          concept,
        }),
      });
      const data = (await res.json()) as
        | { result: { prompts: PrecedentPrompt[] } }
        | { error: string };
      if (!res.ok || "error" in data) {
        setError(("error" in data && data.error) || `HTTP ${res.status}`);
        return;
      }
      patchStudy({
        prompts: data.result.prompts,
        generatedAt: new Date().toISOString(),
        basedOnConceptId: activeConcept?.id,
      });
    } catch (e) {
      setError((e as Error).message || "예외 발생 (콘솔 확인)");
    } finally {
      setRunning(false);
    }
  }

  const webOn =
    !!settings.webSearch?.enabled && !!settings.webSearch?.apiKey?.trim();
  const providerLabel = webOn
    ? `🌐 ${settings.active} + 웹검색`
    : settings.active;

  async function autoResearch(p: PrecedentPrompt) {
    if (!project) return;
    setError(null);
    setAutoAngle(p.angle);
    try {
      const res = await fetch("/api/research/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: settings[settings.active],
          language: project.language,
          prompt: p.body,
          kind: "precedents",
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
      setPasteText(data.text);
      setPasteAngle(p.angle);
      setTimeout(() => {
        document
          .getElementById("paste-box")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAutoAngle(null);
    }
  }

  async function handleParse() {
    if (!project || !pasteText.trim()) return;
    setParseError(null);
    setParseMsg(null);
    setParsing(true);
    try {
      const res = await fetch("/api/precedents/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: settings[settings.active],
          language: project.language,
          text: pasteText,
        }),
      });
      const data = (await res.json()) as
        | { items: ParsedItem[] }
        | { error: string };
      if (!res.ok || "error" in data) {
        setParseError(("error" in data && data.error) || `HTTP ${res.status}`);
        return;
      }
      if (data.items.length === 0) {
        setParseError("텍스트에서 선례를 찾지 못했습니다. 내용을 확인해 주세요.");
        return;
      }
      const now = new Date().toISOString();
      const added: PrecedentItem[] = data.items.map((it) => ({
        ...it,
        id: newItemId(),
        angle: pasteAngle || undefined,
        createdAt: now,
      }));
      patchStudy({ items: [...added, ...items] });
      setPasteText("");
      setParseMsg(`${added.length}개 선례를 정리해 추가했습니다. 대표 사진 가져오는 중…`);
      setSelectedId(added[0].id);
      setTimeout(() => setParseMsg(null), 3000);
      // Best-effort representative photos in the background (store-fresh patch).
      added.forEach((it) => void autoPhoto(it));
    } catch (e) {
      setParseError((e as Error).message);
    } finally {
      setParsing(false);
    }
  }

  function updateItem(id: string, patch: Partial<PrecedentItem>) {
    patchStudy({
      items: items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    });
  }

  function deleteItem(id: string) {
    patchStudy({ items: items.filter((it) => it.id !== id) });
    if (selectedId === id) setSelectedId(null);
  }

  async function attachPhoto(id: string, file: File) {
    if (!project) return;
    try {
      const blobKey = await putImage(project.id, file);
      // Show immediately, then persist the reference.
      setPhotoUrls((prev) => ({ ...prev, [blobKey]: URL.createObjectURL(file) }));
      setPhotoNote((prev) => ({ ...prev, [id]: "" }));
      applyItemPatchFresh(id, { photoBlobKey: blobKey, photoMime: file.type });
    } catch (e) {
      setParseError(`사진 업로드 실패: ${(e as Error).message}`);
    }
  }

  // Patch an item by re-reading the latest project from the store. Used by
  // async photo lookups so concurrent fills don't clobber each other via a
  // stale render closure.
  function applyItemPatchFresh(id: string, patch: Partial<PrecedentItem>) {
    if (!project) return;
    const fresh = getProject(project.id);
    if (!fresh?.precedents?.items) return;
    const next: Project = {
      ...fresh,
      precedents: {
        ...fresh.precedents,
        items: fresh.precedents.items.map((it) =>
          it.id === id ? { ...it, ...patch } : it,
        ),
      },
    };
    saveProject(next);
    setProject(next);
  }

  // Best-effort: pull the source page's preview image (og:image) and attach it.
  async function autoPhoto(item: PrecedentItem) {
    if (!project) return;
    if (!item.sourceUrl?.trim()) {
      setPhotoNote((prev) => ({
        ...prev,
        [item.id]:
          "출처 URL 이 없어 대표 사진을 자동으로 가져올 수 없습니다. 출처 URL 을 입력하거나 직접 업로드하세요.",
      }));
      return;
    }
    setSearchingIds((s) => new Set(s).add(item.id));
    setPhotoNote((prev) => ({ ...prev, [item.id]: "" }));
    try {
      const res = await fetch("/api/precedents/photo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceUrl: item.sourceUrl }),
      });
      const data = (await res.json()) as {
        dataUrl?: string;
        none?: boolean;
      };
      if (data.dataUrl) {
        const { blobKey, mime } = await putDataUrl(project.id, data.dataUrl);
        // Show immediately (data URL renders directly), then persist.
        setPhotoUrls((prev) => ({ ...prev, [blobKey]: data.dataUrl! }));
        applyItemPatchFresh(item.id, { photoBlobKey: blobKey, photoMime: mime });
      } else {
        setPhotoNote((prev) => ({
          ...prev,
          [item.id]:
            "출처 페이지에서 대표 이미지를 찾지 못했습니다. 직접 업로드하거나 Google 이미지를 이용하세요.",
        }));
      }
    } catch {
      setPhotoNote((prev) => ({
        ...prev,
        [item.id]: "사진을 가져오는 중 오류가 발생했습니다. 직접 업로드해 주세요.",
      }));
    } finally {
      setSearchingIds((s) => {
        const n = new Set(s);
        n.delete(item.id);
        return n;
      });
    }
  }

  return (
    <>
      {/* Header */}
      <section className="tile-light px-8 pt-12 pb-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="t-display-md">{projectTitle(project)}</h1>
          <p className="mt-3 t-body text-[var(--text-muted)]">
            문제정의 · 유형 · (활성) 컨셉을 바탕으로 선례 검색 프롬프트를
            생성하고, 외부 AI 결과를 붙여넣거나{" "}
            <strong className="text-[var(--text-ink)]">⚡ 자동 조사</strong> 로
            현재 설정된 API 가 바로 채우게 한 뒤, 구조화된 선례 라이브러리로
            정리합니다. 자동 조사는 모델 지식 기반이라 프로젝트명·건축가·연도는
            반드시 사실 확인하세요.
          </p>
          <div className="mt-5">
            <ProviderSelect settings={settings} onChange={setSettings} />
          </div>
        </div>
      </section>

      {/* Context recap */}
      <section className="tile-parchment px-8 py-10">
        <div className="mx-auto max-w-4xl space-y-4">
          {project.finalPS && (
            <div className="rounded-[18px] border border-[var(--hairline)] bg-white p-6">
              <p className="t-caption text-[var(--text-muted)] mb-2">
                Problem Statement
              </p>
              <blockquote className="rounded-xl border-l-4 border-[var(--accent)] bg-[var(--surface-parchment)] px-5 py-4 t-body italic">
                &ldquo;{project.finalPS}&rdquo;
              </blockquote>
            </div>
          )}
          <div className="rounded-[18px] border border-[var(--hairline)] bg-white p-6">
            <p className="t-caption text-[var(--text-muted)]">검색 기준 컨셉</p>
            <p className="mt-1 t-body-strong">
              {activeConcept
                ? activeConcept.name
                : "활성 컨셉 없음 (유형·문제정의만 사용)"}
            </p>
            {activeConcept?.keywords?.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {activeConcept.keywords.map((k, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-[var(--surface-parchment)] px-3 py-1 t-fine font-medium"
                  >
                    {k}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* Action bar */}
      <section className="tile-dark px-8 py-10">
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
            <div className="t-caption text-[var(--text-silver)]">
              {study
                ? `생성됨 · ${new Date(study.generatedAt).toLocaleString()}`
                : "아직 프롬프트를 생성하지 않았습니다."}
            </div>
            <button
              onClick={handleGenerate}
              disabled={running}
              className="btn-pill-primary"
            >
              {running
                ? "생성 중… (20~60초)"
                : study
                  ? "프롬프트 다시 생성"
                  : "선례 검색 프롬프트 생성"}
            </button>
          </div>
          {error && (
            <p className="mt-4 rounded-xl bg-[var(--error)]/15 px-4 py-3 t-caption text-[var(--error)]">
              {error}
            </p>
          )}
        </div>
      </section>

      {/* Prompts */}
      {study && study.prompts.length > 0 && (
        <section className="tile-light px-8 py-12">
          <div className="mx-auto max-w-4xl space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="t-display-md">검색 프롬프트</h2>
              <CopyButton
                text={study.prompts
                  .map((p) => `## ${p.title}\n${p.body}`)
                  .join("\n\n---\n\n")}
                label="전체 복사"
              />
            </div>
            {study.prompts.map((p, i) => (
              <PromptCard
                key={`${p.angle}-${i}`}
                prompt={p}
                index={i}
                providerLabel={providerLabel}
                autoBusy={autoAngle === p.angle}
                onAuto={() => autoResearch(p)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Paste results → parse */}
      {study && (
        <section className="tile-parchment px-8 py-12">
          <div className="mx-auto max-w-4xl">
            <div
              id="paste-box"
              className="rounded-[18px] border-2 border-[var(--accent)] bg-white p-6"
            >
              <h2 className="t-tagline mb-2">조사 결과 붙여넣기</h2>
              <p className="mb-4 t-caption text-[var(--text-muted)]">
                외부 AI 가 찾아 준 결과를 그대로 붙여넣고 [정리해서 추가] 를
                누르면, 프로젝트명 · 건축가 · 연도 · 위치 · 핵심 공간 전략 ·
                연관성 · 출처로 구조화해 아래 라이브러리에 적립합니다. 여러
                번 나눠서 추가할 수 있습니다.
              </p>
              {angleOptions.length > 0 && (
                <div className="mb-3">
                  <label className="t-fine text-[var(--text-muted)]">
                    어떤 검색 프롬프트의 결과인가요? (태그)
                  </label>
                  <select
                    value={pasteAngle}
                    onChange={(e) => setPasteAngle(e.target.value)}
                    className="input-base mt-1 !py-2 !text-[14px]"
                  >
                    <option value="">미지정</option>
                    {angleOptions.map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={10}
                className="input-base font-mono text-[13px]"
                placeholder="외부 AI 응답을 그대로 붙여넣으세요…"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  onClick={handleParse}
                  disabled={parsing || !pasteText.trim()}
                  className="btn-pill-primary"
                >
                  {parsing ? "정리 중…" : "정리해서 추가"}
                </button>
                {parseMsg && (
                  <span className="t-caption text-[var(--accent-pressed)]">
                    {parseMsg}
                  </span>
                )}
                <span className="ml-auto t-fine text-[var(--text-muted)]">
                  {pasteText.length.toLocaleString()} chars
                </span>
              </div>
              {parseError && (
                <p className="mt-3 rounded-xl bg-[var(--error)]/10 px-4 py-3 t-caption text-[var(--error)]">
                  {parseError}
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Precedent library */}
      {study && (
        <section className="tile-light px-8 py-12">
          <div className="mx-auto max-w-4xl">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <h2 className="t-display-md">
                선례 라이브러리{" "}
                <span className="font-mono t-caption text-[var(--text-muted)]">
                  ({items.length})
                </span>
              </h2>
              {items.length > 0 && angleOptions.length > 0 && (
                <div className="flex gap-1 rounded-full bg-[var(--surface-parchment)] p-1">
                  <button
                    type="button"
                    onClick={() => setGroupByTag(true)}
                    className={`rounded-full px-3 py-1 t-caption ${
                      groupByTag
                        ? "bg-white font-semibold text-[var(--text-ink)] shadow-sm"
                        : "text-[var(--text-muted)]"
                    }`}
                  >
                    태그별
                  </button>
                  <button
                    type="button"
                    onClick={() => setGroupByTag(false)}
                    className={`rounded-full px-3 py-1 t-caption ${
                      !groupByTag
                        ? "bg-white font-semibold text-[var(--text-ink)] shadow-sm"
                        : "text-[var(--text-muted)]"
                    }`}
                  >
                    전체
                  </button>
                </div>
              )}
            </div>

            {items.length === 0 ? (
              <p className="rounded-[18px] border border-dashed border-[var(--hairline)] bg-[var(--surface-parchment)] px-6 py-16 text-center t-caption text-[var(--text-muted)]">
                아직 정리된 선례가 없습니다. 위에 조사 결과를 붙여넣어
                추가하세요.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {/* List */}
                <div className="space-y-5">
                  {buildGroups(items, angleOptions, groupByTag).map((g) => (
                    <div key={g.key}>
                      {groupByTag && (
                        <p className="mb-2 t-caption-strong text-[var(--text-muted)]">
                          {g.title}{" "}
                          <span className="font-mono t-fine">
                            ({g.items.length})
                          </span>
                        </p>
                      )}
                      <ul className="space-y-2">
                        {g.items.map((it) => (
                          <PrecedentRow
                            key={it.id}
                            item={it}
                            selected={selectedId === it.id}
                            photoUrl={
                              it.photoBlobKey
                                ? photoUrls[it.photoBlobKey]
                                : undefined
                            }
                            tagTitle={
                              groupByTag ? undefined : angleTitle(it.angle)
                            }
                            onSelect={() =>
                              setSelectedId(selectedId === it.id ? null : it.id)
                            }
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                {/* Detail */}
                <div className="md:sticky md:top-20 md:self-start">
                  {selected ? (
                    <PrecedentDetail
                      key={selected.id}
                      item={selected}
                      photoUrl={
                        selected.photoBlobKey
                          ? photoUrls[selected.photoBlobKey]
                          : undefined
                      }
                      searching={searchingIds.has(selected.id)}
                      note={photoNote[selected.id]}
                      angleOptions={angleOptions}
                      onChange={(patch) => updateItem(selected.id, patch)}
                      onDelete={() => deleteItem(selected.id)}
                      onPhoto={(file) => attachPhoto(selected.id, file)}
                      onAutoPhoto={() => autoPhoto(selected)}
                      onRemovePhoto={() =>
                        updateItem(selected.id, {
                          photoBlobKey: undefined,
                          photoMime: undefined,
                        })
                      }
                    />
                  ) : (
                    <div className="rounded-[18px] border border-dashed border-[var(--hairline)] bg-[var(--surface-parchment)] px-6 py-16 text-center t-caption text-[var(--text-muted)]">
                      왼쪽 목록에서 선례를 선택하면 사진과 세부 정보가 여기
                      표시됩니다.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}

type ItemGroup = { key: string; title: string; items: PrecedentItem[] };

function buildGroups(
  items: PrecedentItem[],
  angleOptions: { code: string; title: string }[],
  grouped: boolean,
): ItemGroup[] {
  if (!grouped) return [{ key: "__all", title: "", items }];
  const known = new Set(angleOptions.map((a) => a.code));
  const groups: ItemGroup[] = angleOptions.map((a) => ({
    key: a.code,
    title: a.title,
    items: items.filter((it) => it.angle === a.code),
  }));
  const none = items.filter((it) => !it.angle || !known.has(it.angle));
  if (none.length > 0) {
    groups.push({ key: "__none", title: "미지정", items: none });
  }
  return groups.filter((g) => g.items.length > 0);
}

function PrecedentRow({
  item: it,
  selected,
  photoUrl,
  tagTitle,
  onSelect,
}: {
  item: PrecedentItem;
  selected: boolean;
  photoUrl?: string;
  tagTitle?: string;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        onClick={onSelect}
        className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
          selected
            ? "border-[var(--accent)] bg-[var(--accent)]/5"
            : "border-[var(--hairline)] bg-white hover:bg-[var(--surface-parchment)]"
        }`}
      >
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-[var(--surface-parchment)]">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt={it.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center t-fine text-[var(--text-muted)]">
              📐
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="t-caption-strong truncate text-[var(--text-ink)]">
            {it.name}
          </p>
          <p className="truncate t-fine text-[var(--text-muted)]">
            {[it.architect, it.year].filter(Boolean).join(" · ") ||
              "세부 정보 미정"}
          </p>
          {tagTitle && (
            <span className="mt-1 inline-block rounded-full bg-[var(--surface-parchment)] px-2 py-0.5 t-fine text-[var(--text-muted)]">
              {tagTitle}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

function PromptCard({
  prompt,
  index,
  providerLabel,
  autoBusy,
  onAuto,
}: {
  prompt: PrecedentPrompt;
  index: number;
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
        <CopyButton text={prompt.body} label="프롬프트 복사" />
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
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onAuto}
            disabled={autoBusy}
            className="btn-pill-primary !py-2 !text-[13px]"
            title={`현재 설정된 ${providerLabel} 로 이 프롬프트를 실행해 아래 붙여넣기 칸을 자동으로 채웁니다 (사실 확인 필요).`}
          >
            {autoBusy ? "자동 조사 중…" : `⚡ ${providerLabel} 로 자동 조사`}
          </button>
          <span className="t-fine text-[var(--text-muted)]">또는 새 탭:</span>
          {EXTERNAL_AIS.map((ai) => (
            <a
              key={ai.label}
              href={ai.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-pill-ghost !py-2 !text-[13px]"
            >
              {ai.label} ↗
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function PrecedentDetail({
  item,
  photoUrl,
  searching,
  note,
  angleOptions,
  onChange,
  onDelete,
  onPhoto,
  onAutoPhoto,
  onRemovePhoto,
}: {
  item: PrecedentItem;
  photoUrl?: string;
  searching?: boolean;
  note?: string;
  angleOptions: { code: string; title: string }[];
  onChange: (patch: Partial<PrecedentItem>) => void;
  onDelete: () => void;
  onPhoto: (file: File) => void;
  onAutoPhoto: () => void;
  onRemovePhoto: () => void;
}) {
  const imageSearchUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(
    [item.name, item.architect].filter(Boolean).join(" "),
  )}`;
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <div className="rounded-[18px] border border-[var(--hairline)] bg-white p-5">
      {/* Photo */}
      <div className="mb-4 overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface-parchment)]">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt={item.name} className="block w-full" />
        ) : (
          <div className="flex aspect-video items-center justify-center t-caption text-[var(--text-muted)]">
            {searching ? "대표 사진 검색 중…" : "사진 없음"}
          </div>
        )}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={onAutoPhoto}
          disabled={searching}
          className="btn-pill-ghost !py-2 !text-[13px]"
          title="출처 URL 페이지의 대표 이미지(og:image)를 가져옵니다"
        >
          {searching ? "가져오는 중…" : "출처에서 대표 사진 가져오기"}
        </button>
        <label className="btn-pill-ghost cursor-pointer !py-2 !text-[13px]">
          {photoUrl ? "사진 교체" : "사진 업로드"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPhoto(f);
            }}
          />
        </label>
        <a
          href={imageSearchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-pill-ghost !py-2 !text-[13px]"
        >
          Google 이미지 ↗
        </a>
        {photoUrl && (
          <button
            onClick={onRemovePhoto}
            className="btn-pill-ghost !py-2 !text-[13px]"
          >
            사진 제거
          </button>
        )}
      </div>
      {note && (
        <p className="mb-4 rounded-lg bg-[var(--surface-parchment)] px-3 py-2 t-fine text-[var(--text-muted)]">
          {note}
        </p>
      )}

      {/* Editable fields */}
      {angleOptions.length > 0 && (
        <div className="mb-1">
          <label className="t-fine text-[var(--text-muted)]">
            검색 프롬프트 (태그)
          </label>
          <select
            value={item.angle ?? ""}
            onChange={(e) => onChange({ angle: e.target.value || undefined })}
            className="input-base mt-1 !py-2 !text-[14px]"
          >
            <option value="">미지정</option>
            {angleOptions.map((a) => (
              <option key={a.code} value={a.code}>
                {a.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <Field label="프로젝트명" value={item.name} onChange={(v) => onChange({ name: v })} />
      <Field
        label="건축가 / 사무소"
        value={item.architect ?? ""}
        onChange={(v) => onChange({ architect: v })}
      />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field
          tight
          label="완공 연도"
          value={item.year ?? ""}
          onChange={(v) => onChange({ year: v })}
        />
        <Field
          tight
          label="위치"
          value={item.location ?? ""}
          onChange={(v) => onChange({ location: v })}
        />
      </div>
      <Field
        label="핵심 공간 전략"
        value={item.strategy ?? ""}
        onChange={(v) => onChange({ strategy: v })}
        multiline
      />
      <Field
        label="본 프로젝트와의 연관성"
        value={item.relevance ?? ""}
        onChange={(v) => onChange({ relevance: v })}
        multiline
      />
      <Field
        label="출처 URL"
        value={item.sourceUrl ?? ""}
        onChange={(v) => onChange({ sourceUrl: v })}
      />

      <div className="mt-4 flex items-center justify-between">
        {item.sourceUrl ? (
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="t-caption text-[var(--accent-pressed)] underline"
          >
            출처 열기 ↗
          </a>
        ) : (
          <span />
        )}
        <button
          onClick={() => {
            if (armed) onDelete();
            else setArmed(true);
          }}
          className={
            armed
              ? "rounded-full bg-[var(--error)] px-3 py-1 t-caption font-semibold text-white"
              : "t-caption text-[var(--text-muted)] hover:text-[var(--error)]"
          }
        >
          {armed ? "한 번 더 클릭하면 삭제" : "삭제"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline,
  tight,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  tight?: boolean;
}) {
  return (
    <div className={tight ? "" : "mt-3 first:mt-0"}>
      <label className="t-fine text-[var(--text-muted)]">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          className="input-base mt-1 !py-2 !text-[14px]"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input-base mt-1 !py-2 !text-[14px]"
        />
      )}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
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
      {copied ? "✓ 복사됨" : label}
    </button>
  );
}
