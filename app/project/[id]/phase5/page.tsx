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
  ConceptImage,
  ConceptParams,
  ImageProviderKind,
  Pattern,
  Phase5Result,
  Project,
  getActiveConcept,
  needsReadableIdMigration,
  projectPath,
  projectTitle,
} from "@/lib/types/project";
import {
  AppSettings,
  DEFAULT_IMAGE_SETTINGS,
  DEFAULT_SETTINGS,
  ImageProvider,
  ImageProviderConfig,
} from "@/lib/types/settings";
import { ProviderSelect } from "@/components/ModelSelect";
import {
  MOODS,
  STYLES,
  VIEWPOINTS,
  moodLabel,
  styleLabel,
  viewpointLabel,
} from "@/lib/skill/phase5";
import { splitCandidateList } from "@/lib/skill/phase4";
import { getImageObjectUrl, putDataUrl } from "@/lib/store/images";

const DEFAULT_PARAMS: ConceptParams = {
  viewpoint: "human_eye",
  mood: "overcast_afternoon",
  style: "photoreal",
};

type ConceptProposal = {
  materiality: string;
  sceneAnchors: string[];
  rationale: string;
};

/** Pick the prompt-writing style for the active image model. */
function imageModelHint(
  provider: ImageProvider,
  comfyModelType: string | undefined,
): "flux" | "zimage" | "generic" {
  if (provider !== "comfyui") return "generic";
  if (comfyModelType === "zimage") return "zimage";
  if (comfyModelType === "flux") return "flux";
  return "generic";
}

export default function Phase5Page() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  const [conceptParams, setConceptParams] =
    useState<ConceptParams>(DEFAULT_PARAMS);
  const [promptDraft, setPromptDraft] = useState<string>("");
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeImageProvider, setActiveImageProvider] =
    useState<ImageProvider>("comfyui");

  // Site-photo reference for ComfyUI img2img (keeps the lot shape/proportion).
  const [refImage, setRefImage] = useState<string | null>(null);
  const [structureStrength, setStructureStrength] = useState(45);

  // Scene anchors are chosen here in Phase 5 (not Phase 4).
  const [anchorCands, setAnchorCands] = useState<string[]>([]);
  const [loadingAnchors, setLoadingAnchors] = useState(false);
  const [anchorError, setAnchorError] = useState<string | null>(null);
  const [editingAnchors, setEditingAnchors] = useState(false);
  const [anchorEditText, setAnchorEditText] = useState("");

  const [matCands, setMatCands] = useState<string[]>([]);
  const [loadingMat, setLoadingMat] = useState(false);
  const [matError, setMatError] = useState<string | null>(null);
  const [editingMat, setEditingMat] = useState(false);
  const [matEditText, setMatEditText] = useState("");

  // Image → concept feedback loop.
  const [feedbackImageId, setFeedbackImageId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ConceptProposal | null>(null);

  // Gallery: show only the active concept's images, or all of them.
  const [galleryScope, setGalleryScope] = useState<"concept" | "all">(
    "concept",
  );

  // Lightbox: click an image to view it large; Esc / backdrop click closes.
  const [lightbox, setLightbox] = useState<{
    url: string;
    alt: string;
  } | null>(null);
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  useEffect(() => {
    let p = getProject(params.id);
    if (p && needsReadableIdMigration(p.id)) {
      const newId = maybeMigrateLegacyId(p);
      router.replace(projectPath(newId, "phase5"));
      return;
    }
    if (p) p = migrateProject(p);
    // Entering Phase 5 = durable lock marker for the concept structure.
    let proj = p ?? null;
    if (proj && proj.finalPS && !proj.phase5) {
      proj = { ...proj, phase5: { images: [] }, phase: "5" };
      saveProject(proj);
    }
    setProject(proj);
    const s = loadSettings();
    setSettings(s);
    setActiveImageProvider(s.image?.active ?? "comfyui");
    if (proj?.phase5?.params) setConceptParams(proj.phase5.params);
    if (proj?.phase5?.promptDraft) setPromptDraft(proj.phase5.promptDraft);
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
  const concept: Concept | undefined = getActiveConcept(project);
  const phase5 = project.phase5;
  const images = phase5?.images ?? [];
  const conceptNameById = new Map(
    (project.concepts ?? []).map((c) => [c.id, c.name]),
  );
  const hasMultipleConcepts = (project.concepts?.length ?? 0) > 1;
  const visibleImages =
    galleryScope === "all" || !concept
      ? images
      : images.filter((img) => img.conceptId === concept.id);

  function patchPhase5(patch: Partial<Phase5Result>) {
    if (!project) return;
    const current: Phase5Result = project.phase5 ?? { images: [] };
    const updated: Project = {
      ...project,
      phase5: { ...current, ...patch },
    };
    if (project.phase !== "5") updated.phase = "5";
    saveProject(updated);
    setProject(updated);
  }

  // Scene anchors live on the ACTIVE concept but are CHOSEN here in Phase 5.
  function setAnchors(list: string[]) {
    if (!project) return;
    const active = getActiveConcept(project);
    if (!active) return;
    const updated: Project = {
      ...project,
      concepts: (project.concepts ?? []).map((x) =>
        x.id === active.id ? { ...x, sceneAnchors: list } : x,
      ),
    };
    saveProject(updated);
    setProject(updated);
  }

  // Materiality / atmosphere is configured here in Phase 5 (above anchors).
  function setMateriality(v: string) {
    if (!project) return;
    const active = getActiveConcept(project);
    if (!active) return;
    const updated: Project = {
      ...project,
      concepts: (project.concepts ?? []).map((x) =>
        x.id === active.id ? { ...x, materiality: v } : x,
      ),
    };
    saveProject(updated);
    setProject(updated);
  }

  async function fetchAnchorCandidates() {
    if (!project || !project.finalPS) return;
    setAnchorError(null);
    setLoadingAnchors(true);
    setAnchorCands([]);
    try {
      const s = loadSettings();
      const res = await fetch("/api/phase4/step", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: s[s.active],
          inputs: project.inputs,
          language: project.language,
          patterns,
          finalPS: project.finalPS,
          step: "sceneAnchors",
          prior: getActiveConcept(project) ?? {},
          count: 3,
        }),
      });
      const data = (await res.json()) as
        | { candidates: string[] }
        | { error: string };
      if (!res.ok || "error" in data) {
        setAnchorError(
          ("error" in data && data.error) || `HTTP ${res.status}`,
        );
        return;
      }
      setAnchorCands(data.candidates);
    } catch (e) {
      setAnchorError((e as Error).message);
    } finally {
      setLoadingAnchors(false);
    }
  }

  async function fetchMatCandidates() {
    if (!project || !project.finalPS) return;
    setMatError(null);
    setLoadingMat(true);
    setMatCands([]);
    try {
      const s = loadSettings();
      const res = await fetch("/api/phase4/step", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: s[s.active],
          inputs: project.inputs,
          language: project.language,
          patterns,
          finalPS: project.finalPS,
          step: "materiality",
          prior: getActiveConcept(project) ?? {},
          count: 3,
        }),
      });
      const data = (await res.json()) as
        | { candidates: string[] }
        | { error: string };
      if (!res.ok || "error" in data) {
        setMatError(
          ("error" in data && data.error) || `HTTP ${res.status}`,
        );
        return;
      }
      setMatCands(data.candidates);
    } catch (e) {
      setMatError((e as Error).message);
    } finally {
      setLoadingMat(false);
    }
  }

  async function handleGeneratePrompt() {
    if (!project || !project.finalPS) return;
    setError(null);
    setGeneratingPrompt(true);
    try {
      const res = await fetch("/api/phase5/prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: settings[settings.active],
          inputs: project.inputs,
          language: project.language,
          patterns,
          finalPS: project.finalPS,
          params: conceptParams,
          concept,
          imageModel: imageModelHint(
            activeImageProvider,
            settings.image?.comfyui?.modelType,
          ),
        }),
      });
      const data = (await res.json()) as
        | { prompt: string }
        | { error: string };
      if (!res.ok || "error" in data) {
        setError(("error" in data && data.error) || `HTTP ${res.status}`);
        return;
      }
      setPromptDraft(data.prompt);
      patchPhase5({ params: conceptParams, promptDraft: data.prompt });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGeneratingPrompt(false);
    }
  }

  async function handleGenerateImage() {
    if (!project) return;
    if (!promptDraft.trim()) {
      setError("먼저 프롬프트를 생성하거나 직접 작성해 주세요.");
      return;
    }
    setError(null);
    setGeneratingImage(true);
    try {
      const imageSettings = settings.image ?? DEFAULT_IMAGE_SETTINGS;
      const cfg: ImageProviderConfig = imageSettings[activeImageProvider];
      const useRef =
        activeImageProvider === "comfyui" && !!refImage;
      const res = await fetch("/api/phase5/image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          imageProvider: cfg,
          prompt: promptDraft,
          count: 2,
          aspectRatio: "3:2",
          initImage: useRef ? refImage : undefined,
          // 구조 유지 강도(높을수록 대지 형태 유지) → 낮은 denoise.
          denoise: useRef
            ? Math.max(0.2, Math.min(0.9, 1 - structureStrength / 100))
            : undefined,
        }),
      });
      const data = (await res.json()) as
        | { images: { dataUrl: string; mime?: string }[] }
        | { error: string };
      if (!res.ok || "error" in data) {
        setError(("error" in data && data.error) || `HTTP ${res.status}`);
        return;
      }
      const newImages: ConceptImage[] = [];
      for (const item of data.images) {
        const { blobKey, mime } = await putDataUrl(project.id, item.dataUrl);
        newImages.push({
          id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
          conceptId: concept?.id,
          prompt: promptDraft,
          params: conceptParams,
          providerKind: cfg.provider as ImageProviderKind,
          model: cfg.model,
          createdAt: new Date().toISOString(),
          blobKey,
          mime,
        });
      }
      const merged: ConceptImage[] = [...newImages, ...(phase5?.images ?? [])];
      patchPhase5({ params: conceptParams, promptDraft, images: merged });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGeneratingImage(false);
    }
  }

  function handleDeleteImage(id: string) {
    if (!project || !project.phase5) return;
    const next = project.phase5.images.filter((x) => x.id !== id);
    patchPhase5({ images: next });
  }

  function startFeedback(id: string) {
    setFeedbackImageId(id);
    setProposal(null);
    setFeedbackError(null);
    setTimeout(() => {
      document
        .getElementById("feedback")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  async function requestFeedback() {
    if (!project || !feedbackImageId) return;
    const img = (project.phase5?.images ?? []).find(
      (x) => x.id === feedbackImageId,
    );
    if (!img) return;
    if (!feedbackText.trim()) {
      setFeedbackError("피드백 내용을 입력해 주세요.");
      return;
    }
    setFeedbackError(null);
    setFeedbackBusy(true);
    setProposal(null);
    try {
      const active = getActiveConcept(project);
      const res = await fetch("/api/phase5/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: settings[settings.active],
          language: project.language,
          concept: active
            ? {
                parti: active.parti,
                keywords: active.keywords,
                materiality: active.materiality,
                sceneAnchors: active.sceneAnchors,
                spatialStrategies: active.spatialStrategies,
              }
            : undefined,
          image: { prompt: img.prompt, params: img.params },
          feedback: feedbackText,
        }),
      });
      const data = (await res.json()) as
        | { proposal: ConceptProposal }
        | { error: string };
      if (!res.ok || "error" in data) {
        setFeedbackError(
          ("error" in data && data.error) || `HTTP ${res.status}`,
        );
        return;
      }
      setProposal(data.proposal);
    } catch (e) {
      setFeedbackError((e as Error).message);
    } finally {
      setFeedbackBusy(false);
    }
  }

  function applyProposal() {
    if (!project || !proposal) return;
    const active = getActiveConcept(project);
    if (!active) return;
    const updated: Project = {
      ...project,
      concepts: (project.concepts ?? []).map((x) =>
        x.id === active.id
          ? {
              ...x,
              materiality: proposal.materiality || x.materiality,
              sceneAnchors: proposal.sceneAnchors.length
                ? proposal.sceneAnchors
                : x.sceneAnchors,
            }
          : x,
      ),
    };
    saveProject(updated);
    setProject(updated);
    setProposal(null);
    setFeedbackText("");
    setFeedbackImageId(null);
  }

  const imageProviderLabel: Record<ImageProvider, string> = {
    comfyui: "ComfyUI (로컬)",
    openai: "OpenAI",
    gemini_image: "Gemini (Imagen)",
  };

  return (
    <>
      {/* Tile 1 — Header */}
      <section className="tile-light px-8 pt-12 pb-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 flex justify-end">
            <button
              onClick={() => {
                if (!project) return;
                const updated: Project = {
                  ...project,
                  phase5: undefined,
                  phase: "4",
                };
                saveProject(updated);
                router.replace(projectPath(project.id, "phase4"));
              }}
              className="btn-pill-ghost"
              title="Phase 5 를 초기화하고 Phase 4 컨셉 구조화로 돌아갑니다 (생성된 이미지는 브라우저에 남지만 갤러리는 비워집니다)"
            >
              컨셉 재편집
            </button>
          </div>
          <h1 className="t-display-md">{projectTitle(project)}</h1>
          <p className="mt-3 t-body text-[var(--text-muted)]">
            Phase 4 에서 구조화한 컨셉을 바탕으로 이미지 프롬프트를 만들고,
            시점·시간·표현 양식을 골라 컨셉 이미지를 생성합니다.
          </p>
          <div className="mt-5">
            <ProviderSelect
              settings={settings}
              onChange={setSettings}
              label="프롬프트 생성 AI"
            />
          </div>
        </div>
      </section>

      {/* Tile 2 — Concept recap */}
      <section className="tile-parchment px-8 py-12">
        <div className="mx-auto max-w-5xl">
          <ConceptRecap
            project={project}
            patterns={patterns}
            concept={concept}
          />
        </div>
      </section>

      {/* Tile — Materiality / atmosphere (chosen in Phase 5) */}
      <section className="tile-parchment px-8 py-12">
        <div className="mx-auto max-w-5xl">
          <h2 className="t-display-md mb-2">재료 · 분위기</h2>
          <p className="t-body mb-6 text-[var(--text-muted)]">
            재료 팔레트 · 빛의 질 · 촉각 · 무드. AI 추천 중 하나를
            선택합니다. 이미지 프롬프트에 반영됩니다.
          </p>

          {concept?.materiality?.trim() && !editingMat && (
            <div className="mb-5 rounded-[18px] border border-[var(--accent)] bg-[var(--accent)]/5 p-4">
              <p className="t-fine text-[var(--accent-pressed)] mb-1">
                현재 선택
              </p>
              <p className="t-body text-[var(--text-ink)]">
                {concept.materiality}
              </p>
            </div>
          )}

          {editingMat ? (
            <div>
              <textarea
                value={matEditText}
                onChange={(e) => setMatEditText(e.target.value)}
                rows={4}
                className="input-base"
                placeholder="예: 노출 콘크리트와 적삼목 루버, 북측 천창의 확산광, 거친 바닥과 매끄러운 난간의 대비."
              />
              <div className="mt-3 flex gap-2">
                <button
                  className="btn-pill-primary"
                  disabled={!matEditText.trim()}
                  onClick={() => {
                    setMateriality(matEditText.trim());
                    setEditingMat(false);
                    setMatCands([]);
                  }}
                >
                  저장
                </button>
                <button
                  className="btn-pill-ghost"
                  onClick={() => setEditingMat(false)}
                >
                  취소
                </button>
              </div>
            </div>
          ) : (
            <>
              {matCands.length > 0 && (
                <ul className="space-y-3">
                  {matCands.map((cand, i) => {
                    const selected = concept?.materiality === cand;
                    return (
                      <li key={i}>
                        <button
                          onClick={() => {
                            setMateriality(cand);
                            setMatCands([]);
                          }}
                          className={`w-full rounded-[18px] border p-4 text-left transition ${
                            selected
                              ? "border-[var(--accent)] bg-[var(--accent)]/5"
                              : "border-[var(--hairline)] bg-white hover:bg-white"
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
                    );
                  })}
                </ul>
              )}

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  className="btn-pill-primary"
                  disabled={loadingMat}
                  onClick={fetchMatCandidates}
                >
                  {loadingMat
                    ? "추천 생성 중…"
                    : matCands.length || concept?.materiality?.trim()
                      ? "재추천"
                      : "AI 추천 생성"}
                </button>
                <button
                  className="btn-pill-ghost"
                  onClick={() => {
                    setMatEditText(
                      concept?.materiality || matCands[0] || "",
                    );
                    setEditingMat(true);
                  }}
                >
                  직접 수정
                </button>
              </div>
            </>
          )}

          {matError && (
            <p className="mt-5 rounded-xl bg-[var(--error)]/10 px-4 py-3 t-caption text-[var(--error)]">
              {matError}
            </p>
          )}
        </div>
      </section>

      {/* Tile — Scene anchors (chosen in Phase 5) */}
      <section className="tile-light px-8 py-12">
        <div className="mx-auto max-w-5xl">
          <h2 className="t-display-md mb-2">장면 단서</h2>
          <p className="t-body mb-6 text-[var(--text-muted)]">
            이미지에 반드시 담길 구체 요소를 고릅니다. Phase 4 컨셉(파르티
            ·키워드·전략·재료)을 바탕으로 추천됩니다.
          </p>

          {concept &&
            concept.sceneAnchors.length > 0 &&
            !editingAnchors && (
              <div className="mb-5 rounded-[18px] border border-[var(--accent)] bg-[var(--accent)]/5 p-4">
                <p className="t-fine text-[var(--accent-pressed)] mb-2">
                  현재 선택
                </p>
                <div className="flex flex-wrap gap-2">
                  {concept.sceneAnchors.map((a, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-[var(--surface-near-black)] px-3 py-1 t-fine text-[var(--accent)]"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            )}

          {editingAnchors ? (
            <div>
              <textarea
                value={anchorEditText}
                onChange={(e) => setAnchorEditText(e.target.value)}
                rows={4}
                className="input-base font-mono text-[14px]"
                placeholder="쉼표 또는 줄바꿈으로 구분"
              />
              <div className="mt-3 flex gap-2">
                <button
                  className="btn-pill-primary"
                  disabled={!anchorEditText.trim()}
                  onClick={() => {
                    setAnchors(splitCandidateList(anchorEditText));
                    setEditingAnchors(false);
                    setAnchorCands([]);
                  }}
                >
                  저장
                </button>
                <button
                  className="btn-pill-ghost"
                  onClick={() => setEditingAnchors(false)}
                >
                  취소
                </button>
              </div>
            </div>
          ) : (
            <>
              {anchorCands.length > 0 && (
                <ul className="space-y-3">
                  {anchorCands.map((cand, i) => {
                    const selected =
                      concept &&
                      splitCandidateList(cand).join(", ") ===
                        concept.sceneAnchors.join(", ");
                    return (
                      <li key={i}>
                        <button
                          onClick={() => {
                            setAnchors(splitCandidateList(cand));
                            setAnchorCands([]);
                          }}
                          className={`w-full rounded-[18px] border p-4 text-left transition ${
                            selected
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
                    );
                  })}
                </ul>
              )}

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  className="btn-pill-primary"
                  disabled={loadingAnchors}
                  onClick={fetchAnchorCandidates}
                >
                  {loadingAnchors
                    ? "추천 생성 중…"
                    : anchorCands.length ||
                        (concept && concept.sceneAnchors.length)
                      ? "재추천"
                      : "AI 추천 생성"}
                </button>
                <button
                  className="btn-pill-ghost"
                  onClick={() => {
                    setAnchorEditText(
                      (concept?.sceneAnchors ?? []).join("\n") ||
                        (anchorCands[0] ?? ""),
                    );
                    setEditingAnchors(true);
                  }}
                >
                  직접 수정
                </button>
              </div>
            </>
          )}

          {anchorError && (
            <p className="mt-5 rounded-xl bg-[var(--error)]/10 px-4 py-3 t-caption text-[var(--error)]">
              {anchorError}
            </p>
          )}
        </div>
      </section>

      {/* Tile 3 — Framing */}
      <section className="tile-parchment px-8 py-12">
        <div className="mx-auto max-w-5xl">
          <h2 className="t-display-md mb-6">컨셉 프레이밍</h2>

          <ChooserRow
            label="시점"
            options={VIEWPOINTS.map((v) => ({
              key: v,
              label: viewpointLabel(v, project.language),
            }))}
            value={conceptParams.viewpoint}
            onChange={(v) =>
              setConceptParams((p) => ({ ...p, viewpoint: v }))
            }
          />

          <ChooserRow
            label="시간 · 분위기"
            options={MOODS.map((m) => ({
              key: m,
              label: moodLabel(m, project.language),
            }))}
            value={conceptParams.mood}
            onChange={(v) => setConceptParams((p) => ({ ...p, mood: v }))}
          />

          <ChooserRow
            label="표현 양식"
            options={STYLES.map((s) => ({
              key: s,
              label: styleLabel(s, project.language),
            }))}
            value={conceptParams.style}
            onChange={(v) => setConceptParams((p) => ({ ...p, style: v }))}
          />

          <div className="mt-8">
            <label className="t-caption-strong mb-2 block text-[var(--text-ink)]">
              추가 요청 (선택)
            </label>
            <input
              type="text"
              value={conceptParams.extras ?? ""}
              onChange={(e) =>
                setConceptParams((p) => ({ ...p, extras: e.target.value }))
              }
              className="input-base"
              placeholder="예: 골목 깊이감 강조, 빛이 떨어지는 콘크리트 바닥, 등장인물 1–2명"
            />
          </div>

          <div className="mt-8">
            <label className="t-caption-strong mb-3 block text-[var(--text-ink)]">
              이미지 Provider
            </label>
            <div className="flex flex-wrap gap-2">
              {(["comfyui", "openai", "gemini_image"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setActiveImageProvider(p)}
                  className={
                    activeImageProvider === p
                      ? "btn-pill-primary"
                      : "btn-pill-ghost"
                  }
                >
                  {imageProviderLabel[p]}
                </button>
              ))}
            </div>
            <p className="t-caption mt-2 text-[var(--text-muted)]">
              설정 → 이미지 Provider 에서 base URL / 모델 / API 키를 미리
              저장해 두세요.
            </p>
          </div>

          {activeImageProvider === "comfyui" && (
            <div className="mt-8 rounded-[18px] border border-[var(--hairline)] p-5">
              <label className="t-caption-strong mb-1 block text-[var(--text-ink)]">
                구조 참조 이미지 (img2img)
              </label>
              <p className="t-caption mb-3 text-[var(--text-muted)]">
                대지 사진을 올리면 그 형태·비례를 유지한 채 컨셉 스타일로
                렌더링합니다. (ComfyUI 전용)
              </p>
              {refImage ? (
                <div className="flex items-start gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={refImage}
                    alt="대지 사진 미리보기"
                    className="h-32 w-48 rounded-xl object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setRefImage(null)}
                    className="btn-pill-ghost"
                  >
                    제거
                  </button>
                </div>
              ) : (
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const reader = new FileReader();
                    reader.onload = () =>
                      setRefImage(String(reader.result));
                    reader.readAsDataURL(f);
                  }}
                  className="block t-caption text-[var(--text-ink)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--surface-near-black)] file:px-4 file:py-2 file:text-[var(--accent)]"
                />
              )}
              {refImage && (
                <div className="mt-4">
                  <label className="t-caption-strong mb-2 block text-[var(--text-ink)]">
                    구조 유지 강도: {structureStrength}
                    <span className="ml-2 t-fine text-[var(--text-muted)]">
                      (높을수록 대지 형태를 더 강하게 유지, 낮을수록 자유롭게
                      재해석)
                    </span>
                  </label>
                  <input
                    type="range"
                    min={10}
                    max={80}
                    step={5}
                    value={structureStrength}
                    onChange={(e) =>
                      setStructureStrength(Number(e.target.value))
                    }
                    className="w-full accent-[var(--accent)]"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Tile 4 — Prompt + generate */}
      <section className="tile-dark px-8 py-12">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="t-display-md text-[var(--text-white)]">
              이미지 프롬프트
            </h2>
            <button
              onClick={handleGeneratePrompt}
              disabled={generatingPrompt}
              className="btn-pill-primary"
            >
              {generatingPrompt
                ? "프롬프트 생성 중…"
                : promptDraft
                  ? "프롬프트 재생성"
                  : "프롬프트 생성"}
            </button>
          </div>
          <textarea
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            rows={8}
            className="input-base on-dark font-mono text-[14px]"
            placeholder="아직 프롬프트가 없습니다. 위 버튼을 눌러 프롬프트를 생성하거나, 직접 영어로 작성하세요."
          />
          <div className="mt-2 text-right t-fine text-[var(--text-silver)]">
            {promptDraft.length.toLocaleString()} chars
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="t-caption text-[var(--text-silver)]">
              {activeImageProvider === "comfyui"
                ? "ComfyUI 가 로컬에서 실행 중이어야 합니다. 모델 사이즈에 따라 1–5분 소요."
                : "Provider API 키가 설정되어 있어야 합니다."}
            </p>
            <button
              onClick={handleGenerateImage}
              disabled={generatingImage || !promptDraft.trim()}
              className="btn-pill-primary"
            >
              {generatingImage ? "이미지 생성 중…" : "이미지 생성 (2장)"}
            </button>
          </div>

          {error && (
            <p className="mt-6 rounded-xl bg-[var(--error)]/15 px-4 py-3 t-caption text-[var(--error)]">
              {error}
            </p>
          )}
        </div>
      </section>

      {/* Tile 5 — Gallery */}
      <section className="tile-light px-8 py-12">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="t-display-md">
              생성된 컨셉 이미지
              <span className="ml-3 font-mono t-caption text-[var(--text-muted)]">
                ({visibleImages.length}
                {galleryScope === "concept" && images.length !== visibleImages.length
                  ? ` / ${images.length}`
                  : ""}
                )
              </span>
            </h2>
            {hasMultipleConcepts && (
              <div className="flex gap-1 rounded-full bg-[var(--surface-parchment)] p-1">
                <button
                  type="button"
                  onClick={() => setGalleryScope("concept")}
                  className={`rounded-full px-3 py-1 t-caption ${
                    galleryScope === "concept"
                      ? "bg-white font-semibold text-[var(--text-ink)] shadow-sm"
                      : "text-[var(--text-muted)]"
                  }`}
                >
                  이 컨셉만
                </button>
                <button
                  type="button"
                  onClick={() => setGalleryScope("all")}
                  className={`rounded-full px-3 py-1 t-caption ${
                    galleryScope === "all"
                      ? "bg-white font-semibold text-[var(--text-ink)] shadow-sm"
                      : "text-[var(--text-muted)]"
                  }`}
                >
                  전체
                </button>
              </div>
            )}
          </div>
          {images.length === 0 ? (
            <p className="rounded-[18px] border border-dashed border-[var(--hairline)] bg-[var(--surface-parchment)] px-6 py-16 text-center t-caption text-[var(--text-muted)]">
              아직 생성된 이미지가 없습니다.
            </p>
          ) : visibleImages.length === 0 ? (
            <p className="rounded-[18px] border border-dashed border-[var(--hairline)] bg-[var(--surface-parchment)] px-6 py-16 text-center t-caption text-[var(--text-muted)]">
              이 컨셉으로 생성한 이미지가 없습니다.{" "}
              <button
                onClick={() => setGalleryScope("all")}
                className="underline hover:text-[var(--text-ink)]"
              >
                전체 보기
              </button>
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {visibleImages.map((img) => (
                <ImageTile
                  key={img.id}
                  image={img}
                  language={project.language}
                  selected={img.id === feedbackImageId}
                  conceptName={
                    galleryScope === "all" || hasMultipleConcepts
                      ? conceptNameById.get(img.conceptId ?? "")
                      : undefined
                  }
                  onOpen={(url, alt) => setLightbox({ url, alt })}
                  onDelete={() => handleDeleteImage(img.id)}
                  onFeedback={() => startFeedback(img.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Tile 6 — Image → concept feedback loop */}
      {feedbackImageId && (
        <section id="feedback" className="tile-parchment px-8 py-12">
          <div className="mx-auto max-w-5xl">
            <h2 className="t-display-md mb-2">이미지 피드백 → 컨셉 보정</h2>
            <p className="t-body mb-6 text-[var(--text-muted)]">
              선택한 이미지를 보고 원하는 방향을 자연어로 적으면, 활성 컨셉의
              재료/분위기 · 장면 단서를 역으로 보정해 제안합니다. 파르티 ·
              키워드 · 공간 전략은 유지됩니다. 적용 후 위에서 프롬프트를
              재생성하면 다음 이미지에 반영됩니다.
            </p>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <FeedbackPreview
                image={images.find((x) => x.id === feedbackImageId)}
                language={project.language}
              />

              <div>
                <label className="t-caption-strong mb-2 block text-[var(--text-ink)]">
                  이 이미지에 대한 피드백
                </label>
                <textarea
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  rows={5}
                  className="input-base"
                  placeholder="예: 이 따뜻한 노을 분위기를 더 강조하고, 콘크리트보다 목재 질감을 키워드로. 사람은 빼고 빛 자체에 집중."
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="btn-pill-primary"
                    disabled={feedbackBusy || !feedbackText.trim()}
                    onClick={requestFeedback}
                  >
                    {feedbackBusy ? "보정 제안 생성 중…" : "보정 제안"}
                  </button>
                  <button
                    className="btn-pill-ghost"
                    onClick={() => {
                      setFeedbackImageId(null);
                      setProposal(null);
                      setFeedbackError(null);
                    }}
                  >
                    닫기
                  </button>
                </div>
                {feedbackError && (
                  <p className="mt-4 rounded-xl bg-[var(--error)]/10 px-4 py-3 t-caption text-[var(--error)]">
                    {feedbackError}
                  </p>
                )}
              </div>
            </div>

            {proposal && (
              <div className="mt-8 rounded-[18px] border-2 border-[var(--accent)] bg-white p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="t-tagline">보정 제안</h3>
                  <div className="flex gap-2">
                    <button
                      className="btn-pill-primary"
                      onClick={applyProposal}
                    >
                      활성 컨셉에 적용
                    </button>
                    <button
                      className="btn-pill-ghost"
                      onClick={() => setProposal(null)}
                    >
                      버리기
                    </button>
                  </div>
                </div>

                {proposal.rationale && (
                  <p className="mb-5 rounded-xl bg-[var(--surface-parchment)] px-4 py-3 t-caption text-[var(--text-ink)]">
                    {proposal.rationale}
                  </p>
                )}

                <DiffText
                  label="재료 · 분위기"
                  before={concept?.materiality ?? ""}
                  after={proposal.materiality}
                />
                <DiffList
                  label="장면 단서"
                  before={concept?.sceneAnchors ?? []}
                  after={proposal.sceneAnchors}
                />
              </div>
            )}
          </div>
        </section>
      )}

      {/* Lightbox — click an image to view it large */}
      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox.url}
            alt={lightbox.alt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[95vh] max-w-[95vw] cursor-zoom-out rounded-lg object-contain shadow-2xl"
          />
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute right-6 top-6 rounded-full bg-white/10 px-3 py-1 t-caption text-white hover:bg-white/20"
            aria-label="닫기"
          >
            닫기 (Esc)
          </button>
        </div>
      )}
    </>
  );
}

function ConceptRecap({
  project,
  patterns,
  concept,
}: {
  project: Project;
  patterns: Pattern[];
  concept?: Concept;
}) {
  return (
    <div className="rounded-[18px] border border-[var(--hairline)] bg-white p-6">
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <p className="t-caption text-[var(--text-muted)]">사이트</p>
          <p className="mt-1 t-body-strong">{project.inputs.site}</p>
        </div>
        <div>
          <p className="t-caption text-[var(--text-muted)]">공간 유형</p>
          <p className="mt-1 t-body-strong">{project.inputs.typology}</p>
        </div>
      </div>

      {concept?.parti ? (
        <div className="mb-6">
          <p className="t-caption text-[var(--text-muted)] mb-2">
            개념 선언문 (Parti)
          </p>
          <blockquote className="rounded-xl border-l-4 border-[var(--accent)] bg-[var(--surface-parchment)] px-5 py-4 t-body italic leading-relaxed text-[var(--text-ink)]">
            &ldquo;{concept.parti}&rdquo;
          </blockquote>
        </div>
      ) : (
        <p className="mb-6 rounded-xl bg-[var(--surface-parchment)] px-4 py-3 t-caption text-[var(--text-muted)]">
          아직 컨셉 구조화가 비어 있습니다.{" "}
          <Link
            href={projectPath(project.id, "phase4")}
            className="underline hover:text-[var(--text-ink)]"
          >
            Phase 4
          </Link>
          에서 먼저 컨셉을 정리하면 더 풍부한 프롬프트가 생성됩니다.
        </p>
      )}

      {concept && concept.keywords.length > 0 && (
        <div className="mb-6">
          <p className="t-caption text-[var(--text-muted)] mb-2">개념 키워드</p>
          <div className="flex flex-wrap gap-2">
            {concept.keywords.map((k, i) => (
              <span
                key={i}
                className="rounded-full bg-[var(--surface-near-black)] px-3 py-1 t-fine text-[var(--accent)]"
              >
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {concept &&
        concept.spatialStrategies.some((s) => s.strategy.trim()) && (
          <div className="mb-6">
            <p className="t-caption text-[var(--text-muted)] mb-2">
              공간 전략 (패턴 → 전략)
            </p>
            <ul className="space-y-2">
              {concept.spatialStrategies
                .filter((s) => s.strategy.trim())
                .map((s) => (
                  <li
                    key={s.patternId}
                    className="rounded-xl border border-[var(--hairline)] px-4 py-3"
                  >
                    <p className="t-fine text-[var(--text-muted)]">
                      {s.patternTitle}
                    </p>
                    <p className="mt-1 t-caption text-[var(--text-ink)]">
                      {s.strategy}
                    </p>
                  </li>
                ))}
            </ul>
          </div>
        )}

      {concept?.materiality?.trim() && (
        <div className="mb-6">
          <p className="t-caption text-[var(--text-muted)] mb-2">
            재료 · 분위기
          </p>
          <p className="t-caption text-[var(--text-ink)]">
            {concept.materiality}
          </p>
        </div>
      )}

      {patterns.length > 0 && (
        <div className="mb-6">
          <p className="t-caption text-[var(--text-muted)] mb-2">
            핵심 패턴 ({patterns.length})
          </p>
          <ul className="space-y-1.5">
            {patterns.map((p) => (
              <li key={p.id} className="flex items-baseline gap-2">
                <span className="rounded-full bg-[var(--surface-near-black)] px-2 py-0.5 font-mono text-[11px] font-semibold text-[var(--accent)]">
                  {p.label}
                </span>
                <span className="t-caption-strong">{p.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 t-fine text-[var(--text-muted)]">
        컨셉 구조 수정은{" "}
        <Link
          href={projectPath(project.id, "phase4")}
          className="underline hover:text-[var(--text-ink)]"
        >
          Phase 4
        </Link>
        , findings·patterns 는{" "}
        <Link
          href={projectPath(project.id, "phase2b")}
          className="underline hover:text-[var(--text-ink)]"
        >
          Phase 3
        </Link>
        에서 확인할 수 있습니다.
      </p>
    </div>
  );
}

function ChooserRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const isPreset = options.some((o) => o.key === value);
  const [customMode, setCustomMode] = useState(!isPreset && value !== "");

  return (
    <div className="mt-6 first:mt-0">
      <p className="t-caption-strong mb-3 text-[var(--text-ink)]">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => {
              setCustomMode(false);
              onChange(o.key);
            }}
            className={
              !customMode && value === o.key
                ? "btn-pill-primary"
                : "btn-pill-ghost"
            }
          >
            {o.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustomMode(true)}
          className={
            customMode || !isPreset ? "btn-pill-primary" : "btn-pill-ghost"
          }
        >
          직접 입력
        </button>
      </div>
      {(customMode || !isPreset) && (
        <input
          type="text"
          value={isPreset && !customMode ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          className="input-base mt-3"
          placeholder="직접 입력 (예: 드론 로우앵글, 비 오는 새벽, 콜라주 다이어그램)"
        />
      )}
    </div>
  );
}

function ImageTile({
  image,
  language,
  selected,
  conceptName,
  onOpen,
  onDelete,
  onFeedback,
}: {
  image: ConceptImage;
  language: "ko" | "en";
  selected?: boolean;
  conceptName?: string;
  onOpen: (url: string, alt: string) => void;
  onDelete: () => void;
  onFeedback: () => void;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    getImageObjectUrl(image.blobKey).then((u) => {
      if (!alive) {
        if (u) URL.revokeObjectURL(u);
        return;
      }
      url = u;
      setObjectUrl(u);
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [image.blobKey]);

  const summary = useMemo(() => {
    const v = viewpointLabel(image.params.viewpoint, language);
    const m = moodLabel(image.params.mood, language);
    const s = styleLabel(image.params.style, language);
    return `${v} · ${m} · ${s}`;
  }, [image.params, language]);

  function handleDownload() {
    if (!objectUrl) return;
    const a = document.createElement("a");
    a.href = objectUrl;
    const ext = (image.mime ?? "image/png").split("/")[1] || "png";
    a.download = `concept_${image.id}.${ext}`;
    a.click();
  }

  return (
    <li
      className={`card-light p-0 overflow-hidden ${
        selected ? "ring-2 ring-[var(--accent)]" : ""
      }`}
    >
      <button
        type="button"
        onClick={() =>
          objectUrl && onOpen(objectUrl, image.prompt.slice(0, 80))
        }
        disabled={!objectUrl}
        title="크게 보기"
        className="block aspect-[3/2] w-full cursor-zoom-in bg-[var(--surface-parchment)] disabled:cursor-default"
      >
        {objectUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={objectUrl}
            alt={image.prompt.slice(0, 80)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center t-caption text-[var(--text-muted)]">
            로딩 중…
          </div>
        )}
      </button>
      <div className="p-4">
        {conceptName && (
          <span className="mb-2 inline-block rounded-full bg-[var(--surface-near-black)] px-2.5 py-0.5 t-fine text-[var(--accent)]">
            {conceptName}
          </span>
        )}
        <p className="t-caption-strong text-[var(--text-ink)]">{summary}</p>
        <p className="mt-2 t-fine text-[var(--text-muted)]">
          {image.providerKind === "comfyui"
            ? "ComfyUI"
            : image.providerKind === "openai"
              ? "OpenAI"
              : "Gemini"}
          {image.model ? ` · ${image.model.slice(0, 32)}` : ""} ·{" "}
          {new Date(image.createdAt).toLocaleString()}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={onFeedback} className="btn-pill-primary">
            이 이미지로 컨셉 보정
          </button>
          <button onClick={handleDownload} className="btn-pill-ghost">
            다운로드
          </button>
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
    </li>
  );
}

function FeedbackPreview({
  image,
  language,
}: {
  image?: ConceptImage;
  language: "ko" | "en";
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!image) {
      setObjectUrl(null);
      return;
    }
    let alive = true;
    let url: string | null = null;
    getImageObjectUrl(image.blobKey).then((u) => {
      if (!alive) {
        if (u) URL.revokeObjectURL(u);
        return;
      }
      url = u;
      setObjectUrl(u);
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [image]);

  if (!image) return null;
  const summary = `${viewpointLabel(image.params.viewpoint, language)} · ${moodLabel(
    image.params.mood,
    language,
  )} · ${styleLabel(image.params.style, language)}`;

  return (
    <figure className="overflow-hidden rounded-[18px] border border-[var(--hairline)] bg-white">
      <div className="aspect-[3/2] w-full bg-[var(--surface-parchment)]">
        {objectUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={objectUrl}
            alt={image.prompt.slice(0, 80)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center t-caption text-[var(--text-muted)]">
            로딩 중…
          </div>
        )}
      </div>
      <figcaption className="px-4 py-3 t-fine text-[var(--text-muted)]">
        {summary}
      </figcaption>
    </figure>
  );
}

function DiffList({
  label,
  before,
  after,
}: {
  label: string;
  before: string[];
  after: string[];
}) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return (
    <div className="mt-5 first:mt-0">
      <p className="t-caption-strong mb-2 text-[var(--text-muted)]">{label}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <p className="t-fine text-[var(--text-muted)] mb-1">현재</p>
          <div className="flex flex-wrap gap-1.5">
            {before.length === 0 && (
              <span className="t-fine text-[var(--text-muted)]">(없음)</span>
            )}
            {before.map((k, i) => (
              <span
                key={i}
                className={`rounded-full px-2.5 py-1 t-fine ${
                  afterSet.has(k)
                    ? "bg-[var(--surface-parchment)] text-[var(--text-ink)]"
                    : "bg-[var(--error)]/10 text-[var(--error)] line-through"
                }`}
              >
                {k}
              </span>
            ))}
          </div>
        </div>
        <div>
          <p className="t-fine text-[var(--accent-pressed)] mb-1">제안</p>
          <div className="flex flex-wrap gap-1.5">
            {after.length === 0 && (
              <span className="t-fine text-[var(--text-muted)]">(없음)</span>
            )}
            {after.map((k, i) => (
              <span
                key={i}
                className={`rounded-full px-2.5 py-1 t-fine ${
                  beforeSet.has(k)
                    ? "bg-[var(--surface-parchment)] text-[var(--text-ink)]"
                    : "bg-[var(--accent)]/15 text-[var(--accent-pressed)] font-semibold"
                }`}
              >
                {k}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DiffText({
  label,
  before,
  after,
}: {
  label: string;
  before: string;
  after: string;
}) {
  const changed = before.trim() !== after.trim();
  return (
    <div className="mt-5">
      <p className="t-caption-strong mb-2 text-[var(--text-muted)]">{label}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <p className="t-fine text-[var(--text-muted)] mb-1">현재</p>
          <p className="rounded-xl bg-[var(--surface-parchment)] px-3 py-2 t-caption text-[var(--text-ink)]">
            {before || "(없음)"}
          </p>
        </div>
        <div>
          <p className="t-fine text-[var(--accent-pressed)] mb-1">제안</p>
          <p
            className={`rounded-xl px-3 py-2 t-caption ${
              changed
                ? "bg-[var(--accent)]/15 text-[var(--text-ink)]"
                : "bg-[var(--surface-parchment)] text-[var(--text-ink)]"
            }`}
          >
            {after || "(없음)"}
          </p>
        </div>
      </div>
    </div>
  );
}
