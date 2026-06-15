"use client";

import {
  AppSettings,
  DEFAULT_IMAGE_SETTINGS,
  DEFAULT_SETTINGS,
} from "@/lib/types/settings";

const KEY = "research-brief-app:settings";

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const parsedImage = parsed.image;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      ollama: { ...DEFAULT_SETTINGS.ollama, ...(parsed.ollama ?? {}) },
      anthropic: { ...DEFAULT_SETTINGS.anthropic, ...(parsed.anthropic ?? {}) },
      gemini: { ...DEFAULT_SETTINGS.gemini, ...(parsed.gemini ?? {}) },
      image: {
        ...DEFAULT_IMAGE_SETTINGS,
        ...(parsedImage ?? {}),
        comfyui: {
          ...DEFAULT_IMAGE_SETTINGS.comfyui,
          ...(parsedImage?.comfyui ?? {}),
        },
        openai: {
          ...DEFAULT_IMAGE_SETTINGS.openai,
          ...(parsedImage?.openai ?? {}),
        },
        gemini_image: {
          ...DEFAULT_IMAGE_SETTINGS.gemini_image,
          ...(parsedImage?.gemini_image ?? {}),
        },
      },
      batch: { ...DEFAULT_SETTINGS.batch!, ...(parsed.batch ?? {}) },
      webSearch: {
        ...DEFAULT_SETTINGS.webSearch!,
        ...(parsed.webSearch ?? {}),
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(settings));
}

export function clearSettings(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}
