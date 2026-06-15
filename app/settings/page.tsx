"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AppSettings,
  DEFAULT_IMAGE_SETTINGS,
  DEFAULT_SETTINGS,
  ImageProvider,
  ImageProviderConfig,
  ImageSettings,
  LlmProvider,
  ProviderConfig,
} from "@/lib/types/settings";
import { loadSettings, saveSettings } from "@/lib/store/settings";

type TestResult = {
  ok: boolean;
  message: string;
  models?: string[];
  /** ComfyUI: Flux UNET diffusion models in models/unet. */
  unetModels?: string[];
  /** ComfyUI: CLIP files (clip_l, t5xxl, …) in models/clip. */
  clipFiles?: string[];
  /** ComfyUI: VAE files in models/vae. */
  vaeFiles?: string[];
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tests, setTests] = useState<Record<LlmProvider, TestResult | null>>({
    ollama: null,
    anthropic: null,
    gemini: null,
  });
  const [testing, setTesting] = useState<LlmProvider | null>(null);

  const [imageTests, setImageTests] = useState<
    Record<ImageProvider, TestResult | null>
  >({ comfyui: null, openai: null, gemini_image: null });
  const [imageTesting, setImageTesting] = useState<ImageProvider | null>(null);

  const image: ImageSettings = settings.image ?? DEFAULT_IMAGE_SETTINGS;

  useEffect(() => {
    setSettings(loadSettings());
    setLoaded(true);
  }, []);

  const update = (patch: Partial<AppSettings>) =>
    setSettings((s) => ({ ...s, ...patch }));

  const updateOllama = (patch: Partial<AppSettings["ollama"]>) =>
    setSettings((s) => ({ ...s, ollama: { ...s.ollama, ...patch } }));
  const updateAnthropic = (patch: Partial<AppSettings["anthropic"]>) =>
    setSettings((s) => ({ ...s, anthropic: { ...s.anthropic, ...patch } }));
  const updateGemini = (patch: Partial<AppSettings["gemini"]>) =>
    setSettings((s) => ({ ...s, gemini: { ...s.gemini, ...patch } }));

  const updateImage = (patch: Partial<ImageSettings>) =>
    setSettings((s) => ({
      ...s,
      image: { ...(s.image ?? DEFAULT_IMAGE_SETTINGS), ...patch },
    }));
  const updateComfyui = (patch: Partial<ImageSettings["comfyui"]>) =>
    setSettings((s) => {
      const cur = s.image ?? DEFAULT_IMAGE_SETTINGS;
      return { ...s, image: { ...cur, comfyui: { ...cur.comfyui, ...patch } } };
    });
  const updateOpenaiImage = (patch: Partial<ImageSettings["openai"]>) =>
    setSettings((s) => {
      const cur = s.image ?? DEFAULT_IMAGE_SETTINGS;
      return { ...s, image: { ...cur, openai: { ...cur.openai, ...patch } } };
    });
  const updateGeminiImage = (patch: Partial<ImageSettings["gemini_image"]>) =>
    setSettings((s) => {
      const cur = s.image ?? DEFAULT_IMAGE_SETTINGS;
      return {
        ...s,
        image: {
          ...cur,
          gemini_image: { ...cur.gemini_image, ...patch },
        },
      };
    });

  async function handleImageTest(provider: ImageProvider) {
    setImageTesting(provider);
    const cfg: ImageProviderConfig = image[provider];
    try {
      const res = await fetch("/api/image/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cfg),
      });
      const data = (await res.json()) as TestResult;
      setImageTests((t) => ({ ...t, [provider]: data }));
    } catch (e) {
      setImageTests((t) => ({
        ...t,
        [provider]: { ok: false, message: (e as Error).message },
      }));
    } finally {
      setImageTesting(null);
    }
  }

  async function handleTest(provider: LlmProvider) {
    setTesting(provider);
    const cfg: ProviderConfig = settings[provider];
    try {
      const res = await fetch("/api/llm/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cfg),
      });
      const data = (await res.json()) as TestResult;
      setTests((t) => ({ ...t, [provider]: data }));
    } catch (e) {
      setTests((t) => ({
        ...t,
        [provider]: { ok: false, message: (e as Error).message },
      }));
    } finally {
      setTesting(null);
    }
  }

  function handleSave() {
    saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  if (!loaded) {
    return (
      <div className="tile-light min-h-screen p-12">
        <p className="t-body text-[var(--text-muted)]">불러오는 중…</p>
      </div>
    );
  }

  return (
    <main className="tile-light min-h-screen px-8 py-16">
      <div className="mx-auto max-w-3xl">
        <div className="mb-12 flex items-center justify-between">
          <Link
            href="/"
            className="t-caption text-[var(--text-muted)] hover:text-[var(--text-ink)]"
          >
            ← 홈
          </Link>
          <span className="t-caption text-[var(--text-muted)]">설정</span>
        </div>

        <h1 className="t-display-md mb-12">설정</h1>

        <section className="mb-12">
          <h2 className="t-tagline mb-4">사용할 Provider</h2>
          <div className="flex flex-wrap gap-2">
            {(["ollama", "anthropic", "gemini"] as const).map((p) => (
              <button
                key={p}
                onClick={() => update({ active: p })}
                className={
                  settings.active === p
                    ? "btn-pill-primary"
                    : "btn-pill-ghost"
                }
              >
                {p === "ollama"
                  ? "Ollama (로컬)"
                  : p === "anthropic"
                    ? "Anthropic"
                    : "Gemini"}
              </button>
            ))}
          </div>
          <p className="t-caption mt-4 text-[var(--text-muted)]">
            기본값은 Ollama + qwen2.5:14b (구조화 출력에 안정적). 실패하면
            Anthropic 또는 Gemini 로 전환해 보세요.
          </p>
        </section>

        <ProviderCard
          title="Ollama (로컬)"
          active={settings.active === "ollama"}
          onTest={() => handleTest("ollama")}
          testing={testing === "ollama"}
          result={tests.ollama}
        >
          <Field label="Base URL">
            <input
              type="text"
              value={settings.ollama.baseUrl}
              onChange={(e) => updateOllama({ baseUrl: e.target.value })}
              className="input-base font-mono text-[15px]"
              placeholder="http://localhost:11434"
            />
          </Field>
          <Field label="Model">
            <input
              type="text"
              value={settings.ollama.model}
              onChange={(e) => updateOllama({ model: e.target.value })}
              className="input-base font-mono text-[15px]"
              placeholder="qwen2.5:14b"
            />
            <p className="t-caption mt-2 text-[var(--text-muted)]">
              사전에{" "}
              <code className="rounded bg-[var(--surface-parchment)] px-1.5 py-0.5 font-mono text-[13px]">
                ollama pull {settings.ollama.model}
              </code>{" "}
              으로 모델을 내려받아 두세요.
            </p>
          </Field>
        </ProviderCard>

        <ProviderCard
          title="Anthropic"
          active={settings.active === "anthropic"}
          onTest={() => handleTest("anthropic")}
          testing={testing === "anthropic"}
          result={tests.anthropic}
        >
          <Field label="API Key">
            <input
              type="password"
              value={settings.anthropic.apiKey}
              onChange={(e) => updateAnthropic({ apiKey: e.target.value })}
              className="input-base font-mono text-[15px]"
              placeholder="sk-ant-..."
            />
            <p className="t-caption mt-2 text-[var(--text-muted)]">
              console.anthropic.com 에서 발급. 브라우저 localStorage 에만
              저장됩니다.
            </p>
          </Field>
          <Field label="Model">
            <input
              type="text"
              value={settings.anthropic.model}
              onChange={(e) => updateAnthropic({ model: e.target.value })}
              className="input-base font-mono text-[15px]"
              placeholder="claude-sonnet-4-6"
            />
          </Field>
        </ProviderCard>

        <ProviderCard
          title="Gemini"
          active={settings.active === "gemini"}
          onTest={() => handleTest("gemini")}
          testing={testing === "gemini"}
          result={tests.gemini}
        >
          <Field label="API Key">
            <input
              type="password"
              value={settings.gemini.apiKey}
              onChange={(e) => updateGemini({ apiKey: e.target.value })}
              className="input-base font-mono text-[15px]"
              placeholder="AI..."
            />
            <p className="t-caption mt-2 text-[var(--text-muted)]">
              aistudio.google.com 에서 발급. 브라우저 localStorage 에만
              저장됩니다.
            </p>
          </Field>
          <Field label="Model">
            <input
              type="text"
              value={settings.gemini.model}
              onChange={(e) => updateGemini({ model: e.target.value })}
              className="input-base font-mono text-[15px]"
              placeholder="gemini-2.5-pro"
            />
          </Field>
        </ProviderCard>

        <section className="mt-16 mb-12">
          <h2 className="t-display-md mb-4">이미지 생성 Provider</h2>
          <p className="t-body mb-6 text-[var(--text-muted)]">
            Phase 4 (컨셉 이미지) 에서 사용. 기본값은 로컬 ComfyUI.
          </p>
          <div className="flex flex-wrap gap-2">
            {(["comfyui", "openai", "gemini_image"] as const).map((p) => (
              <button
                key={p}
                onClick={() => updateImage({ active: p })}
                className={
                  image.active === p ? "btn-pill-primary" : "btn-pill-ghost"
                }
              >
                {p === "comfyui"
                  ? "ComfyUI (로컬)"
                  : p === "openai"
                    ? "OpenAI"
                    : "Gemini (Imagen)"}
              </button>
            ))}
          </div>
        </section>

        <ProviderCard
          title="ComfyUI (로컬)"
          active={image.active === "comfyui"}
          onTest={() => handleImageTest("comfyui")}
          testing={imageTesting === "comfyui"}
          result={imageTests.comfyui}
        >
          <Field label="Base URL">
            <input
              type="text"
              value={image.comfyui.baseUrl}
              onChange={(e) => updateComfyui({ baseUrl: e.target.value })}
              className="input-base font-mono text-[15px]"
              placeholder="http://localhost:8188"
            />
          </Field>

          <Field label="모델 종류">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["checkpoint", "Checkpoint (models/checkpoints)"],
                  ["flux", "Flux UNET (models/unet)"],
                  ["zimage", "Z-Image Turbo (models/diffusion_models)"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => updateComfyui({ modelType: key })}
                  className={
                    (image.comfyui.modelType ?? "checkpoint") === key
                      ? "btn-pill-primary"
                      : "btn-pill-ghost"
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="t-caption mt-2 text-[var(--text-muted)]">
              Flux 는 UNET + CLIP + VAE 가, Z-Image 는 diffusion + 텍스트 인코더
              + VAE 가 별도 파일로 존재합니다. 일반 SD/SDXL all-in-one 체크포인트는
              Checkpoint 모드를 선택하세요.
            </p>
          </Field>

          <Field
            label={
              (image.comfyui.modelType ?? "checkpoint") === "flux"
                ? "UNET 모델 (models/unet)"
                : (image.comfyui.modelType ?? "checkpoint") === "zimage"
                  ? "Diffusion 모델 (models/diffusion_models)"
                  : "Checkpoint 모델 (models/checkpoints)"
            }
          >
            <input
              type="text"
              value={image.comfyui.model}
              onChange={(e) => updateComfyui({ model: e.target.value })}
              className="input-base font-mono text-[15px]"
              placeholder={
                (image.comfyui.modelType ?? "checkpoint") === "flux"
                  ? "예: flux1-dev.safetensors"
                  : (image.comfyui.modelType ?? "checkpoint") === "zimage"
                    ? "예: z-image-turbo-fp8-e4m3fn.safetensors"
                    : "예: sd_xl_base_1.0.safetensors"
              }
            />
            {(() => {
              const mt = image.comfyui.modelType ?? "checkpoint";
              const list =
                mt === "flux" || mt === "zimage"
                  ? imageTests.comfyui?.unetModels
                  : imageTests.comfyui?.models;
              if (!list || list.length === 0) return null;
              return (
                <div className="mt-3">
                  <p className="t-fine mb-2 text-[var(--text-muted)]">
                    ComfyUI 에서 발견된 모델:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {list.slice(0, 16).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => updateComfyui({ model: m })}
                        className="btn-utility"
                        title={m}
                      >
                        {m.length > 28 ? `${m.slice(0, 26)}…` : m}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
            <p className="t-caption mt-2 text-[var(--text-muted)]">
              연결 테스트로 설치된 모델 목록을 받아 선택할 수 있습니다.
            </p>
          </Field>

          {(image.comfyui.modelType ?? "checkpoint") === "flux" && (
            <>
              <Field label="CLIP-L (models/clip)">
                <input
                  type="text"
                  value={image.comfyui.clipL ?? ""}
                  onChange={(e) => updateComfyui({ clipL: e.target.value })}
                  className="input-base font-mono text-[15px]"
                  placeholder="clip_l.safetensors"
                />
                {imageTests.comfyui?.clipFiles &&
                  imageTests.comfyui.clipFiles.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {imageTests.comfyui.clipFiles.slice(0, 12).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => updateComfyui({ clipL: m })}
                          className="btn-utility"
                          title={m}
                        >
                          {m.length > 28 ? `${m.slice(0, 26)}…` : m}
                        </button>
                      ))}
                    </div>
                  )}
              </Field>

              <Field label="T5 CLIP (models/clip)">
                <input
                  type="text"
                  value={image.comfyui.clipT5 ?? ""}
                  onChange={(e) => updateComfyui({ clipT5: e.target.value })}
                  className="input-base font-mono text-[15px]"
                  placeholder="t5xxl_fp16.safetensors"
                />
                {imageTests.comfyui?.clipFiles &&
                  imageTests.comfyui.clipFiles.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {imageTests.comfyui.clipFiles.slice(0, 12).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => updateComfyui({ clipT5: m })}
                          className="btn-utility"
                          title={m}
                        >
                          {m.length > 28 ? `${m.slice(0, 26)}…` : m}
                        </button>
                      ))}
                    </div>
                  )}
                <p className="t-caption mt-2 text-[var(--text-muted)]">
                  VRAM 이 부족하면 fp8 변형 (예: t5xxl_fp8_e4m3fn.safetensors)
                  사용 가능.
                </p>
              </Field>

              <Field label="VAE (models/vae)">
                <input
                  type="text"
                  value={image.comfyui.vae ?? ""}
                  onChange={(e) => updateComfyui({ vae: e.target.value })}
                  className="input-base font-mono text-[15px]"
                  placeholder="ae.safetensors"
                />
                {imageTests.comfyui?.vaeFiles &&
                  imageTests.comfyui.vaeFiles.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {imageTests.comfyui.vaeFiles.slice(0, 12).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => updateComfyui({ vae: m })}
                          className="btn-utility"
                          title={m}
                        >
                          {m.length > 28 ? `${m.slice(0, 26)}…` : m}
                        </button>
                      ))}
                    </div>
                  )}
              </Field>
            </>
          )}

          {(image.comfyui.modelType ?? "checkpoint") === "zimage" && (
            <>
              <Field label="텍스트 인코더 (models/text_encoders)">
                <input
                  type="text"
                  value={image.comfyui.textEncoder ?? ""}
                  onChange={(e) =>
                    updateComfyui({ textEncoder: e.target.value })
                  }
                  className="input-base font-mono text-[15px]"
                  placeholder="qwen_3_4b.safetensors"
                />
                {imageTests.comfyui?.clipFiles &&
                  imageTests.comfyui.clipFiles.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {imageTests.comfyui.clipFiles.slice(0, 12).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => updateComfyui({ textEncoder: m })}
                          className="btn-utility"
                          title={m}
                        >
                          {m.length > 28 ? `${m.slice(0, 26)}…` : m}
                        </button>
                      ))}
                    </div>
                  )}
                <p className="t-caption mt-2 text-[var(--text-muted)]">
                  Z-Image 의 Qwen 텍스트 인코더. CLIPLoader type 은 자동으로
                  &ldquo;lumina2&rdquo; 로 설정됩니다.
                </p>
              </Field>

              <Field label="VAE (models/vae)">
                <input
                  type="text"
                  value={image.comfyui.vae ?? ""}
                  onChange={(e) => updateComfyui({ vae: e.target.value })}
                  className="input-base font-mono text-[15px]"
                  placeholder="ae.safetensors"
                />
                {imageTests.comfyui?.vaeFiles &&
                  imageTests.comfyui.vaeFiles.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {imageTests.comfyui.vaeFiles.slice(0, 12).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => updateComfyui({ vae: m })}
                          className="btn-utility"
                          title={m}
                        >
                          {m.length > 28 ? `${m.slice(0, 26)}…` : m}
                        </button>
                      ))}
                    </div>
                  )}
                <p className="t-caption mt-2 text-[var(--text-muted)]">
                  Turbo 는 distilled 모델이라 8 steps · cfg 1.0 로 자동 생성됩니다
                  (guidance 불필요).
                </p>
              </Field>
            </>
          )}
        </ProviderCard>

        <ProviderCard
          title="OpenAI (gpt-image-1)"
          active={image.active === "openai"}
          onTest={() => handleImageTest("openai")}
          testing={imageTesting === "openai"}
          result={imageTests.openai}
        >
          <Field label="API Key">
            <input
              type="password"
              value={image.openai.apiKey}
              onChange={(e) => updateOpenaiImage({ apiKey: e.target.value })}
              className="input-base font-mono text-[15px]"
              placeholder="sk-..."
            />
            <p className="t-caption mt-2 text-[var(--text-muted)]">
              platform.openai.com 에서 발급. 브라우저 localStorage 에만 저장.
            </p>
          </Field>
          <Field label="Model">
            <input
              type="text"
              value={image.openai.model}
              onChange={(e) => updateOpenaiImage({ model: e.target.value })}
              className="input-base font-mono text-[15px]"
              placeholder="gpt-image-1"
            />
          </Field>
        </ProviderCard>

        <ProviderCard
          title="Gemini (Imagen)"
          active={image.active === "gemini_image"}
          onTest={() => handleImageTest("gemini_image")}
          testing={imageTesting === "gemini_image"}
          result={imageTests.gemini_image}
        >
          <Field label="API Key">
            <input
              type="password"
              value={image.gemini_image.apiKey}
              onChange={(e) => updateGeminiImage({ apiKey: e.target.value })}
              className="input-base font-mono text-[15px]"
              placeholder="AI..."
            />
            <p className="t-caption mt-2 text-[var(--text-muted)]">
              aistudio.google.com (텍스트 Gemini 와 동일 키 사용 가능).
              Imagen 이용 권한이 필요합니다.
            </p>
          </Field>
          <Field label="Model">
            <input
              type="text"
              value={image.gemini_image.model}
              onChange={(e) => updateGeminiImage({ model: e.target.value })}
              className="input-base font-mono text-[15px]"
              placeholder="imagen-3.0-generate-002"
            />
          </Field>
        </ProviderCard>

        <section className="mt-16 mb-6">
          <h2 className="t-display-md mb-4">주변 대지 분석 (V-World)</h2>
          <p className="t-body mb-6 text-[var(--text-muted)]">
            주변 대지 분석 페이지에서 사용. V-World 인증키는 키 발급 시 등록한
            도메인에서만 동작합니다 (자가 호스팅 시 ngrok 도메인 또는
            localhost 등록).
          </p>
        </section>
        <section className="mb-6 rounded-[18px] border border-[var(--hairline)] bg-[var(--surface-white)] p-6">
          <Field label="API Key">
            <input
              type="password"
              value={settings.vworld?.apiKey ?? ""}
              onChange={(e) =>
                update({
                  vworld: {
                    apiKey: e.target.value,
                    domain: settings.vworld?.domain ?? "",
                  },
                })
              }
              className="input-base font-mono text-[15px]"
              placeholder="발급받은 V-World 인증키"
            />
            <p className="t-caption mt-2 text-[var(--text-muted)]">
              vworld.kr 회원가입 → 인증키 발급(2D/WMS/WFS 권한). 브라우저
              localStorage 에만 저장됩니다.
            </p>
          </Field>
          <Field label="등록 도메인 (선택)">
            <input
              type="text"
              value={settings.vworld?.domain ?? ""}
              onChange={(e) =>
                update({
                  vworld: {
                    apiKey: settings.vworld?.apiKey ?? "",
                    domain: e.target.value,
                  },
                })
              }
              className="input-base font-mono text-[15px]"
              placeholder="예: localhost 또는 my-app.ngrok-free.app"
            />
            <p className="t-caption mt-2 text-[var(--text-muted)]">
              키 발급 때 입력한 도메인. 서버에서 V-World 호출 시 함께
              전달됩니다.
            </p>
          </Field>
        </section>

        <section className="mt-16 mb-6">
          <h2 className="t-display-md mb-4">라이브 웹 검색 (Tavily)</h2>
          <p className="t-body mb-6 text-[var(--text-muted)]">
            리서치 · 선례 조사의 <strong>⚡ 자동 조사</strong>에서 사용. 켜두면
            로컬 모델이 자기 지식으로만 답하지 않고, 먼저 Tavily로 실제 웹을
            검색해 모은 출처를 근거로 답하고 출처 URL을 붙입니다. 끄면 기존처럼
            모델 지식 기반으로 동작합니다.
          </p>
        </section>
        <section className="mb-6 rounded-[18px] border border-[var(--hairline)] bg-[var(--surface-white)] p-6">
          <Field label="웹 검색 사용">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.webSearch?.enabled ?? false}
                onChange={(e) =>
                  update({
                    webSearch: {
                      ...DEFAULT_SETTINGS.webSearch!,
                      ...(settings.webSearch ?? {}),
                      enabled: e.target.checked,
                    },
                  })
                }
                className="h-4 w-4"
              />
              <span className="t-body">
                자동 조사 시 라이브 웹 검색으로 보강
              </span>
            </label>
          </Field>
          <Field label="Tavily API Key">
            <input
              type="password"
              value={settings.webSearch?.apiKey ?? ""}
              onChange={(e) =>
                update({
                  webSearch: {
                    ...DEFAULT_SETTINGS.webSearch!,
                    ...(settings.webSearch ?? {}),
                    apiKey: e.target.value,
                  },
                })
              }
              className="input-base font-mono text-[15px]"
              placeholder="tvly-..."
            />
            <p className="t-caption mt-2 text-[var(--text-muted)]">
              tavily.com 가입 → API 키 발급(무료 월 1,000회). 브라우저
              localStorage 에만 저장됩니다. 키가 비어 있으면 웹 검색을 켜도
              모델 지식 기반으로 동작합니다.
            </p>
          </Field>
          <Field label="출처 개수">
            <input
              type="number"
              min={1}
              max={10}
              value={settings.webSearch?.maxResults ?? 5}
              onChange={(e) =>
                update({
                  webSearch: {
                    ...DEFAULT_SETTINGS.webSearch!,
                    ...(settings.webSearch ?? {}),
                    maxResults: Math.max(
                      1,
                      Math.min(Number(e.target.value) || 5, 10),
                    ),
                  },
                })
              }
              className="input-base font-mono text-[15px] w-28"
            />
            <p className="t-caption mt-2 text-[var(--text-muted)]">
              한 번의 자동 조사에서 모을 웹 출처 수 (1–10). 많을수록 근거는
              풍부하지만 느려집니다. 권장 5.
            </p>
          </Field>
        </section>

        <section className="mt-16 mb-6">
          <h2 className="t-display-md mb-4">일괄 생성 (P4→P5)</h2>
          <p className="t-body mb-6 text-[var(--text-muted)]">
            컨셉을 여러 개 자동 생성하고 각 컨셉마다 8장의 이미지를 만들어
            서버(앱 실행 PC)의 로컬 폴더에 저장합니다. 경로는 앱이 실행되는
            폴더 기준 상대경로 또는 절대경로로 입력하세요.
          </p>
        </section>
        <section className="mb-6 rounded-[18px] border border-[var(--hairline)] bg-[var(--surface-white)] p-6">
          <Field label="출력 폴더 경로">
            <input
              type="text"
              value={settings.batch?.outputDir ?? "./parti-output"}
              onChange={(e) =>
                update({ batch: { outputDir: e.target.value } })
              }
              className="input-base font-mono text-[15px]"
              placeholder="예: ./parti-output 또는 C:\\parti-output"
            />
            <p className="t-caption mt-2 text-[var(--text-muted)]">
              이 폴더 아래에 프로젝트별 폴더 → 순번 폴더(001, 002 …) 형식으로
              저장됩니다. 상대경로는 앱 실행 위치(cwd) 기준입니다.
            </p>
          </Field>
        </section>

        <div className="sticky bottom-0 -mx-8 mt-8 flex items-center gap-4 border-t border-[var(--hairline)] bg-[var(--surface-white)] px-8 py-6">
          <button onClick={handleSave} className="btn-pill-primary">
            저장
          </button>
          {saved && (
            <span className="t-caption text-[var(--accent-pressed)]">
              ✓ 저장되었습니다
            </span>
          )}
        </div>
      </div>
    </main>
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
    <label className="mb-5 block">
      <span className="t-caption-strong mb-2 block text-[var(--text-ink)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function ProviderCard({
  title,
  active,
  onTest,
  testing,
  result,
  children,
}: {
  title: string;
  active: boolean;
  onTest: () => void;
  testing: boolean;
  result: TestResult | null;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`mb-6 rounded-[18px] border p-6 ${
        active
          ? "border-[var(--accent)] bg-[var(--surface-white)]"
          : "border-[var(--hairline)] bg-[var(--surface-white)]"
      }`}
    >
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="t-tagline">{title}</h3>
          {active && (
            <span className="rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-[12px] font-semibold text-black">
              활성
            </span>
          )}
        </div>
        <button
          onClick={onTest}
          disabled={testing}
          className="btn-pill-ghost disabled:opacity-50"
        >
          {testing ? "확인 중…" : "연결 테스트"}
        </button>
      </div>
      {children}
      {result && (
        <div
          className={`mt-4 rounded-xl px-4 py-3 t-caption ${
            result.ok
              ? "bg-[var(--accent)]/10 text-[var(--accent-pressed)]"
              : "bg-[var(--error)]/10 text-[var(--error)]"
          }`}
        >
          {result.message}
        </div>
      )}
    </section>
  );
}
