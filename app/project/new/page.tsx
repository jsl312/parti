"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { loadSettings } from "@/lib/store/settings";
import { listProjects, saveProject } from "@/lib/store/projects";
import { AppSettings, DEFAULT_SETTINGS } from "@/lib/types/settings";
import { ProviderSelect } from "@/components/ModelSelect";
import {
  Language,
  Phase1Result,
  Project,
  ProjectInputs,
  makeReadableProjectId,
  projectPath,
} from "@/lib/types/project";

function detectLanguage(text: string): Language {
  return /[ㄱ-힝]/.test(text) ? "ko" : "en";
}

export default function NewProjectPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [inputs, setInputs] = useState<ProjectInputs>({
    site: "",
    typology: "",
    scale: "",
    client: "",
    constraints: "",
  });
  const [language, setLanguage] = useState<Language>("ko");
  const [languageTouched, setLanguageTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  useEffect(() => {
    if (languageTouched) return;
    const combined = `${inputs.site} ${inputs.typology}`.trim();
    if (combined) setLanguage(detectLanguage(combined));
  }, [inputs.site, inputs.typology, languageTouched]);

  const canSubmit = inputs.site.trim() && inputs.typology.trim() && !submitting;

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const cleaned: ProjectInputs = {
        site: inputs.site.trim(),
        typology: inputs.typology.trim(),
        scale: inputs.scale?.trim() || undefined,
        client: inputs.client?.trim() || undefined,
        constraints: inputs.constraints?.trim() || undefined,
      };

      const res = await fetch("/api/phase1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: settings[settings.active],
          inputs: cleaned,
          language,
        }),
      });
      const data = (await res.json()) as
        | { result: Phase1Result }
        | { error: string };

      if (!res.ok || "error" in data) {
        setError(("error" in data && data.error) || `HTTP ${res.status}`);
        return;
      }

      const id = makeReadableProjectId(
        cleaned,
        listProjects().map((p) => p.id),
      );
      const now = new Date().toISOString();
      const project: Project = {
        id,
        createdAt: now,
        updatedAt: now,
        language,
        inputs: cleaned,
        phase: "1",
        phase1: {
          ...data.result,
          generatedAt: now,
        },
      };
      saveProject(project);
      router.push(projectPath(id, "phase1"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="tile-light min-h-screen px-8 py-16">
      <div className="mx-auto max-w-2xl">
        <div className="mb-12 flex items-center justify-between">
          <Link
            href="/"
            className="t-caption text-[var(--text-muted)] hover:text-[var(--text-ink)]"
          >
            ← 홈
          </Link>
          <span className="rounded-full bg-[var(--surface-parchment)] px-3 py-1 t-fine font-mono">
            새 프로젝트
          </span>
        </div>

        <h1 className="t-display-md mb-3">새 프로젝트</h1>
        <p className="t-body text-[var(--text-muted)]">
          사이트와 공간 유형을 입력하면 Phase 1 의 5개 리서치 프롬프트를
          생성합니다.
        </p>

        <div className="mt-12 space-y-6">
          <Field
            label="사이트"
            required
            hint="가능한 한 구체적으로 (동·거리·랜드마크)."
          >
            <input
              type="text"
              value={inputs.site}
              onChange={(e) => setInputs({ ...inputs, site: e.target.value })}
              className="input-base"
              placeholder="예: 서울 성수동 연무장길 중간 골목 코너"
            />
          </Field>

          <Field
            label="공간 유형"
            required
            hint="예: 카페, 도서관, 코워킹, 갤러리."
          >
            <input
              type="text"
              value={inputs.typology}
              onChange={(e) =>
                setInputs({ ...inputs, typology: e.target.value })
              }
              className="input-base"
              placeholder="예: 카페"
            />
          </Field>

          <details className="rounded-[18px] border border-[var(--hairline)] p-6">
            <summary className="cursor-pointer t-caption-strong text-[var(--text-ink)]">
              선택 입력 (규모 · 클라이언트 · 알려진 제약)
            </summary>
            <div className="mt-6 space-y-5">
              <Field label="규모">
                <input
                  type="text"
                  value={inputs.scale}
                  onChange={(e) =>
                    setInputs({ ...inputs, scale: e.target.value })
                  }
                  className="input-base"
                  placeholder="예: 대지 200m², 연면적 150m²"
                />
              </Field>
              <Field label="건축주 / 클라이언트">
                <input
                  type="text"
                  value={inputs.client}
                  onChange={(e) =>
                    setInputs({ ...inputs, client: e.target.value })
                  }
                  className="input-base"
                />
              </Field>
              <Field label="이미 아는 제약">
                <textarea
                  value={inputs.constraints}
                  onChange={(e) =>
                    setInputs({ ...inputs, constraints: e.target.value })
                  }
                  rows={3}
                  className="input-base"
                  placeholder="예: 예산 5억, 보존구역 여부, 주차 요구"
                />
              </Field>
            </div>
          </details>

          <Field label="출력 언어">
            <div className="flex flex-wrap items-center gap-2">
              {(["ko", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => {
                    setLanguage(l);
                    setLanguageTouched(true);
                  }}
                  className={
                    language === l ? "btn-pill-primary" : "btn-pill-ghost"
                  }
                >
                  {l === "ko" ? "한국어" : "English"}
                </button>
              ))}
              <span className="ml-2 t-caption text-[var(--text-muted)]">
                {languageTouched ? "수동 선택" : "입력에서 자동 감지"}
              </span>
            </div>
          </Field>
        </div>

        <div className="mt-12 border-t border-[var(--hairline)] pt-8">
          <div className="mb-4">
            <ProviderSelect
              settings={settings}
              onChange={setSettings}
              label="Phase 1 생성 AI"
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="btn-pill-primary w-full"
          >
            {submitting
              ? "Phase 1 프롬프트 생성 중… (30~60초)"
              : "Phase 1 시작"}
          </button>
          {error && (
            <p className="mt-4 rounded-xl bg-[var(--error)]/10 px-4 py-3 t-caption text-[var(--error)]">
              {error}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="t-caption-strong mb-2 block text-[var(--text-ink)]">
        {label}
        {required && (
          <span className="ml-1 text-[var(--accent-pressed)]">*</span>
        )}
      </span>
      {children}
      {hint && (
        <span className="t-caption mt-2 block text-[var(--text-muted)]">
          {hint}
        </span>
      )}
    </label>
  );
}
