"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  getProject,
  maybeMigrateLegacyId,
  migrateProject,
} from "@/lib/store/projects";
import { loadSettings } from "@/lib/store/settings";
import {
  ConceptParams,
  ConceptStructure,
  Pattern,
  Project,
  needsReadableIdMigration,
  projectPath,
  projectTitle,
} from "@/lib/types/project";
import {
  AppSettings,
  DEFAULT_SETTINGS,
  DEFAULT_IMAGE_SETTINGS,
  ImageProviderConfig,
} from "@/lib/types/settings";
import { renderConceptMd, renderPromptsMd } from "@/lib/skill/batch";
import { ProviderSelect, ImageProviderSelect } from "@/components/ModelSelect";

const MAX_COUNT = 20;
// per concept: 1 concept + 4 prompt calls + 4 image jobs + 1 save
const STEPS_PER_CONCEPT = 10;
// concept-only mode: 1 concept + 4 prompt calls + 1 save (no image jobs)
const STEPS_SKIP = 6;
const IMAGES_PER_PROMPT = 2;

// Four photoreal framings: 1 exterior + 3 distinct interiors.
const PROMPT_PLANS: {
  key: string; // file prefix
  mdRole: string;
  params: ConceptParams;
}[] = [
  {
    key: "1_exterior",
    mdRole: "외관 (Exterior)",
    params: {
      viewpoint: "human_eye",
      mood: "overcast_afternoon",
      style: "photoreal",
      extras:
        "exterior view of the whole building and its approach within the site context",
    },
  },
  {
    key: "2_interior1",
    mdRole: "내부 1 (Interior)",
    params: {
      viewpoint: "interior_eye",
      mood: "overcast_afternoon",
      style: "photoreal",
      extras: "the main interior space, wide eye-level view",
    },
  },
  {
    key: "3_interior2",
    mdRole: "내부 2 (Interior)",
    params: {
      viewpoint: "interior_eye",
      mood: "overcast_afternoon",
      style: "photoreal",
      extras:
        "a secondary space or threshold / circulation, clearly different from the main space",
    },
  },
  {
    key: "4_interior3",
    mdRole: "내부 3 (Interior)",
    params: {
      viewpoint: "interior_eye",
      mood: "golden_hour",
      style: "photoreal",
      extras: "an intimate detail corner, close-up of materials and light",
    },
  },
];

type LogEntry = {
  kind: "info" | "ok" | "error";
  text: string;
  at: number;
};

type PromptRole = {
  key: string; // file prefix, e.g. "1_exterior"
  mdRole: string; // markdown heading
  prompt: string;
};

export default function BatchPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  const [count, setCount] = useState(5);
  const [skipImages, setSkipImages] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0); // completed sub-steps
  const [total, setTotal] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const [log, setLog] = useState<LogEntry[]>([]);
  const stopRef = useRef(false);

  // Tick for live ETA while running.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    let p = getProject(params.id);
    if (p && needsReadableIdMigration(p.id)) {
      const newId = maybeMigrateLegacyId(p);
      router.replace(projectPath(newId, "batch"));
      return;
    }
    if (p) p = migrateProject(p);
    setProject(p ?? null);
    setSettings(loadSettings());
    setLoaded(true);
  }, [params.id, router]);

  function pushLog(kind: LogEntry["kind"], text: string) {
    setLog((l) => [{ kind, text, at: Date.now() }, ...l].slice(0, 200));
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

  const patterns: Pattern[] = project.phase2B?.patterns ?? [];
  const outputDir = settings.batch?.outputDir ?? "./parti-output";
  const image = settings.image ?? DEFAULT_IMAGE_SETTINGS;
  const imageProviderCfg: ImageProviderConfig = image[image.active];
  const textProvider = settings[settings.active];
  // Z-Image / Flux prompt tuning only applies to ComfyUI; hosted APIs are generic.
  const imageModel: "flux" | "zimage" | "generic" =
    imageProviderCfg.provider === "comfyui"
      ? imageProviderCfg.modelType === "zimage"
        ? "zimage"
        : imageProviderCfg.modelType === "flux"
          ? "flux"
          : "generic"
      : "generic";
  // Does the chosen image provider have the config it needs to run?
  const imageReady =
    imageProviderCfg.provider === "comfyui"
      ? !!imageProviderCfg.baseUrl
      : !!imageProviderCfg.apiKey;
  const imageLabel =
    imageProviderCfg.provider === "comfyui"
      ? `ComfyUI · ${imageProviderCfg.model || "(모델 미설정)"}`
      : imageProviderCfg.provider === "openai"
        ? `OpenAI · ${imageProviderCfg.model || "(모델 미설정)"}`
        : `Gemini · ${imageProviderCfg.model || "(모델 미설정)"}`;

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const elapsed = startedAt ? now - startedAt : 0;
  const etaMs =
    startedAt && done > 0 && done < total
      ? (elapsed / done) * (total - done)
      : 0;

  async function postJson<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as T & { error?: string };
    if (!res.ok || (data as { error?: string }).error) {
      throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
    }
    return data;
  }

  async function generateOne(
    index: number,
    avoidPartis: string[],
    runId: string,
    skip: boolean,
  ) {
    if (!project) return;
    // 1) Concept
    pushLog("info", `#${index} 컨셉 생성 중…`);
    const { concept } = await postJson<{ concept: ConceptStructure }>(
      "/api/batch/concept",
      {
        provider: textProvider,
        inputs: project.inputs,
        language: project.language,
        patterns,
        finalPS: project.finalPS,
        avoidPartis,
      },
    );
    avoidPartis.push(concept.parti);
    setDone((d) => d + 1);
    pushLog("ok", `#${index} 컨셉 완료: ${concept.parti.slice(0, 40)}…`);
    if (stopRef.current) return;

    // 2) Prompts — 4 calls to the robust single-{prompt} Phase 5 route
    //    (1 exterior + 3 interior). Avoids the nested-JSON degeneration local
    //    models hit when asked for all four at once.
    const roles: PromptRole[] = [];
    for (const plan of PROMPT_PLANS) {
      if (stopRef.current) return;
      pushLog("info", `#${index} 프롬프트 생성 — ${plan.mdRole}`);
      const { prompt } = await postJson<{ prompt: string }>(
        "/api/phase5/prompt",
        {
          provider: textProvider,
          inputs: project.inputs,
          language: project.language,
          patterns,
          finalPS: project.finalPS,
          params: plan.params,
          concept,
          imageModel,
        },
      );
      roles.push({ key: plan.key, mdRole: plan.mdRole, prompt });
      setDone((d) => d + 1);
    }
    pushLog("ok", `#${index} 프롬프트 4개 완료`);
    if (stopRef.current) return;

    // 3) Images — 2 per prompt → 8 total (skipped in concept-only mode)
    const images: { name: string; dataUrl: string }[] = [];
    if (skip) {
      pushLog("info", `#${index} 이미지 스킵 (컨셉/프롬프트만)`);
    } else {
      for (const role of roles) {
        if (stopRef.current) return;
        pushLog("info", `#${index} 이미지 생성 중 — ${role.mdRole}`);
        const data = await postJson<{
          images: { dataUrl: string; mime?: string }[];
        }>("/api/phase5/image", {
          imageProvider: imageProviderCfg,
          prompt: role.prompt,
          count: IMAGES_PER_PROMPT,
          aspectRatio: "3:2",
        });
        data.images.forEach((img, j) => {
          images.push({ name: `${role.key}_${j + 1}`, dataUrl: img.dataUrl });
        });
        setDone((d) => d + 1);
        pushLog("ok", `#${index} ${role.mdRole} — ${data.images.length}장`);
      }
    }
    if (stopRef.current) return;

    // 4) Save to disk
    pushLog("info", `#${index} 파일 저장 중…`);
    const conceptMd = renderConceptMd(concept, {
      projectTitle: projectTitle(project),
      index,
      finalPS: project.finalPS!,
    });
    const promptsMd = renderPromptsMd(
      roles.map((r) => ({ role: r.mdRole, prompt: r.prompt })),
      concept,
    );
    const saveRes = await postJson<{ dir: string; imagesWritten: number }>(
      "/api/batch/save",
      {
        outputDir,
        rootName: project.id,
        runId,
        index,
        conceptMd,
        promptsMd,
        images,
        concept,
        prompts: roles.map((r) => ({ role: r.mdRole, prompt: r.prompt })),
      },
    );
    setDone((d) => d + 1);
    pushLog(
      "ok",
      `#${index} 저장 완료 → ${saveRes.dir} (이미지 ${saveRes.imagesWritten}장)`,
    );
  }

  async function handleStart() {
    if (!project || running) return;
    if (!skipImages && !imageReady) {
      pushLog(
        "error",
        imageProviderCfg.provider === "comfyui"
          ? "ComfyUI 설정이 비어 있습니다. 설정 → 이미지 Provider 에서 base URL/모델을 저장하거나, 다른 이미지 모델을 고르거나, '이미지 스킵' 모드로 컨셉만 생성하세요."
          : "선택한 이미지 모델의 API 키가 비어 있습니다. 설정 → 이미지 Provider 에서 키를 저장하거나, 다른 이미지 모델을 고르거나, '이미지 스킵' 모드로 컨셉만 생성하세요.",
      );
      return;
    }
    const skip = skipImages;
    const n = Math.max(1, Math.min(MAX_COUNT, count));
    const stepsPer = skip ? STEPS_SKIP : STEPS_PER_CONCEPT;
    const runId = makeRunId();
    stopRef.current = false;
    setRunning(true);
    setDone(0);
    setTotal(n * stepsPer);
    setStartedAt(Date.now());
    setNow(Date.now());
    setLog([]);
    pushLog(
      "info",
      skip
        ? `일괄 생성 시작 — ${n}개 컨셉 (이미지 스킵, 컨셉/프롬프트만) · 실행 폴더 ${runId}`
        : `일괄 생성 시작 — ${n}개 컨셉 (컨셉당 8장) · 실행 폴더 ${runId}`,
    );

    const avoidPartis: string[] = [];
    try {
      for (let i = 1; i <= n; i++) {
        if (stopRef.current) {
          pushLog("info", `중지됨 — ${i - 1}개 완료. 완료된 폴더는 유지됩니다.`);
          break;
        }
        await generateOne(i, avoidPartis, runId, skip);
      }
      if (!stopRef.current) pushLog("ok", "✓ 일괄 생성 완료");
    } catch (e) {
      pushLog("error", `중단: ${(e as Error).message}`);
      pushLog(
        "error",
        "ComfyUI/Ollama 가 실행 중인지, 출력 폴더 경로가 올바른지 확인 후 다시 시도하세요. 이미 저장된 폴더는 유지됩니다.",
      );
    } finally {
      setRunning(false);
    }
  }

  function handleStop() {
    stopRef.current = true;
    pushLog("info", "중지 요청됨 — 현재 단계 종료 후 멈춥니다…");
  }

  return (
    <>
      {/* Header */}
      <section className="tile-light px-8 pt-12 pb-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 flex flex-wrap gap-2">
            <Link
              href={projectPath(project.id, "concepts")}
              className="btn-pill-ghost"
            >
              ← 컨셉 목록
            </Link>
            <Link
              href={projectPath(project.id, "batch-results")}
              className="btn-pill-ghost"
            >
              일괄 생성 결과 보기
            </Link>
          </div>
          <h1 className="t-display-md">일괄 생성 (P4 → P5)</h1>
          <p className="mt-3 t-body text-[var(--text-muted)]">
            로컬 모델로 컨셉을 자동 생성하고, 각 컨셉마다 외관 1 · 내부 3 =
            4개의 포토리얼 프롬프트로 8장(프롬프트당 2장)을 만들어 서버 로컬
            폴더에 순번 폴더로 저장합니다.
          </p>
        </div>
      </section>

      {/* Config recap */}
      <section className="tile-parchment px-8 py-10">
        <div className="mx-auto max-w-4xl rounded-[18px] border border-[var(--hairline)] bg-white p-6">
          {/* AI model pickers — choose per run, saved globally */}
          <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-[var(--hairline)] pb-5">
            <ProviderSelect settings={settings} onChange={setSettings} label="텍스트 모델" />
            <ImageProviderSelect settings={settings} onChange={setSettings} label="이미지 모델" />
          </div>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Recap label="대상 프로젝트" value={projectTitle(project)} />
            <Recap
              label="텍스트 모델"
              value={`${textProvider.provider} · ${
                "model" in textProvider ? textProvider.model : ""
              }`}
            />
            <Recap
              label="이미지 모델"
              value={
                skipImages
                  ? "스킵 (나중에 결과 화면에서 렌더)"
                  : imageLabel
              }
            />
            <Recap
              label="출력 폴더"
              value={`${outputDir}/${project.id}/<실행시각>/NNN`}
            />
          </dl>
          <p className="mt-4 t-fine text-[var(--text-muted)]">
            ※ 컨셉당 8장이라 개수가 클수록 매우 오래 걸립니다(로컬 ComfyUI 기준
            수 시간 가능). 처음엔 2~3개로 파이프라인을 검증하세요. Ollama 와
            ComfyUI 가 실행 중이어야 합니다.
          </p>
        </div>
      </section>

      {/* Controls */}
      <section className="tile-light px-8 py-10">
        <div className="mx-auto max-w-4xl">
          <label className="t-caption-strong mb-3 block text-[var(--text-ink)]">
            생성 개수: <span className="font-mono">{count}</span>개{" "}
            <span className="t-fine text-[var(--text-muted)]">
              {skipImages
                ? `(이미지 생성 안 함 · 최대 ${MAX_COUNT})`
                : `(이미지 ${count * 8}장 · 최대 ${MAX_COUNT})`}
            </span>
          </label>
          <input
            type="range"
            min={1}
            max={MAX_COUNT}
            step={1}
            value={count}
            disabled={running}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />

          <label className="mt-5 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={skipImages}
              disabled={running}
              onChange={(e) => setSkipImages(e.target.checked)}
              className="mt-1 accent-[var(--accent)]"
            />
            <span>
              <span className="t-caption-strong text-[var(--text-ink)]">
                이미지 스킵 — 컨셉·프롬프트만 빠르게 생성
              </span>
              <span className="mt-0.5 block t-fine text-[var(--text-muted)]">
                수십 개를 수십 초에 뽑아 결과 화면에서 훑어보고, 마음에 드는
                컨셉만 거기서 &ldquo;이미지 렌더&rdquo;로 나중에 그릴 수 있습니다.
                (ComfyUI 불필요)
              </span>
            </span>
          </label>

          <div className="mt-6 flex flex-wrap gap-3">
            {!running ? (
              <button onClick={handleStart} className="btn-pill-primary">
                일괄 생성 시작
              </button>
            ) : (
              <button onClick={handleStop} className="btn-pill-ghost">
                중지
              </button>
            )}
          </div>

          {/* Progress */}
          {(running || done > 0) && (
            <div className="mt-8">
              <div className="mb-2 flex items-center justify-between t-caption text-[var(--text-muted)]">
                <span>
                  {pct}% · {Math.min(done, total)} / {total} 단계
                </span>
                <span>
                  {running && etaMs > 0
                    ? `남은 시간 약 ${fmtDuration(etaMs)}`
                    : running
                      ? "추정 중…"
                      : `소요 ${fmtDuration(elapsed)}`}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-parchment)]">
                <div
                  className="h-full bg-[var(--accent)] transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Log */}
      {log.length > 0 && (
        <section className="tile-dark px-8 py-10">
          <div className="mx-auto max-w-4xl">
            <h2 className="t-display-md mb-4 text-[var(--text-white)]">진행 로그</h2>
            <ul className="space-y-1.5 font-mono text-[13px]">
              {log.map((e, i) => (
                <li
                  key={i}
                  className={
                    e.kind === "error"
                      ? "text-[var(--error)]"
                      : e.kind === "ok"
                        ? "text-[var(--accent)]"
                        : "text-[var(--text-silver)]"
                  }
                >
                  <span className="text-[var(--text-silver)]">
                    {new Date(e.at).toLocaleTimeString()}{" "}
                  </span>
                  {e.text}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}

function Recap({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="t-caption text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-1 t-body-strong break-words text-[var(--text-ink)]">
        {value}
      </dd>
    </div>
  );
}

/** Timestamp run-folder id, e.g. "20260608-2153" — groups one run, never overwrites. */
function makeRunId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(
    d.getHours(),
  )}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${sec}초`;
  return `${sec}초`;
}
