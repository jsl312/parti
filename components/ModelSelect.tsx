"use client";

/**
 * Inline AI-model pickers used at the point of every AI action.
 *
 * Behavior (per product decision): "register in settings, select anywhere".
 * Changing a picker updates the page's settings state AND persists to
 * localStorage, so the choice is shared globally and sticky. The unit of
 * selection is the PROVIDER (each provider carries its own configured model).
 */

import {
  AppSettings,
  DEFAULT_IMAGE_SETTINGS,
  ImageProvider,
  LlmProvider,
} from "@/lib/types/settings";
import { saveSettings } from "@/lib/store/settings";

const TEXT_LABEL: Record<LlmProvider, string> = {
  ollama: "Ollama",
  anthropic: "Anthropic",
  gemini: "Gemini",
};
const IMG_LABEL: Record<ImageProvider, string> = {
  comfyui: "ComfyUI",
  openai: "OpenAI",
  gemini_image: "Gemini",
};

const SELECT_CLASS =
  "rounded-full border border-[var(--hairline)] bg-white px-3 py-1.5 t-caption text-[var(--text-ink)] focus:border-[var(--accent)] focus:outline-none cursor-pointer";

function Labeled({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  if (!label) return <>{children}</>;
  return (
    <label className="inline-flex items-center gap-2">
      <span className="t-caption text-[var(--text-muted)]">{label}</span>
      {children}
    </label>
  );
}

/** Text LLM picker — bound to settings.active. */
export function ProviderSelect({
  settings,
  onChange,
  label = "AI 모델",
  className,
  title = "이 작업에 사용할 AI 모델 (설정에 등록된 것 중 선택)",
}: {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  label?: string;
  className?: string;
  title?: string;
}) {
  return (
    <Labeled label={label}>
      <select
        value={settings.active}
        title={title}
        onChange={(e) => {
          const next = { ...settings, active: e.target.value as LlmProvider };
          saveSettings(next);
          onChange(next);
        }}
        className={className ?? SELECT_CLASS}
      >
        {(["ollama", "anthropic", "gemini"] as LlmProvider[]).map((p) => (
          <option key={p} value={p}>
            {TEXT_LABEL[p]} · {settings[p].model || "(모델 미설정)"}
          </option>
        ))}
      </select>
    </Labeled>
  );
}

/** Image generation picker — bound to settings.image.active. */
export function ImageProviderSelect({
  settings,
  onChange,
  label = "이미지 모델",
  className,
  title = "이 작업에 사용할 이미지 생성 모델 (설정에 등록된 것 중 선택)",
}: {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  label?: string;
  className?: string;
  title?: string;
}) {
  const image = settings.image ?? DEFAULT_IMAGE_SETTINGS;
  const modelOf = (p: ImageProvider) =>
    (p === "comfyui" ? image.comfyui.model : image[p].model) || "(모델 미설정)";
  return (
    <Labeled label={label}>
      <select
        value={image.active}
        title={title}
        onChange={(e) => {
          const p = e.target.value as ImageProvider;
          const next: AppSettings = {
            ...settings,
            image: { ...image, active: p },
          };
          saveSettings(next);
          onChange(next);
        }}
        className={className ?? SELECT_CLASS}
      >
        {(["comfyui", "openai", "gemini_image"] as ImageProvider[]).map((p) => (
          <option key={p} value={p}>
            {IMG_LABEL[p]} · {modelOf(p)}
          </option>
        ))}
      </select>
    </Labeled>
  );
}
