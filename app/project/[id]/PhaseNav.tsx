"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getProject, migrateProject } from "@/lib/store/projects";
import { Project, projectPath } from "@/lib/types/project";

type StepState = "done" | "current" | "available" | "locked";

type Step = {
  no: number;
  label: string;
  sub: string;
  /** Route sub-path to navigate to. */
  route: string;
  /** Last path segments that count as "this step is current". */
  segs: string[];
  available: boolean;
  done: boolean;
  lockHint?: string;
};

export default function PhaseNav() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const [project, setProject] = useState<Project | null>(null);

  // Re-read on every route change so lock/done states stay fresh after a page
  // mutates the project (same-tab writes don't fire storage events).
  useEffect(() => {
    if (!params?.id) return;
    let p = getProject(params.id);
    if (p) p = migrateProject(p);
    setProject(p ?? null);
  }, [params?.id, pathname]);

  const id = params?.id ?? "";
  const seg = (pathname ?? "").split("/").pop() ?? "";

  // The report page has its own sticky toolbar + is print-focused — skip.
  if (seg === "report") return null;

  const finalPS = !!project?.finalPS;
  const hasConcepts = (project?.concepts?.length ?? 0) > 0;
  const hasImages = (project?.phase5?.images?.length ?? 0) > 0;

  const lockPS = "Problem Statement 확정 후 이용 가능";
  const lockConcept = "컨셉을 먼저 만들어 주세요";

  const steps: Step[] = [
    {
      no: 1,
      label: "리서치",
      sub: "P1·2",
      route: "phase1",
      segs: ["phase1", "phase2a"],
      available: !!project?.phase1 || !!project,
      done: !!(project?.phase2A || finalPS),
    },
    {
      no: 2,
      label: "문제정의",
      sub: "P3",
      route: "phase2b",
      segs: ["phase2b"],
      available: !!project,
      done: finalPS,
    },
    {
      no: 3,
      label: "컨셉",
      sub: "P4",
      route: "concepts",
      segs: ["concepts", "phase4"],
      available: finalPS,
      done: hasConcepts,
      lockHint: lockPS,
    },
    {
      no: 4,
      label: "이미지",
      sub: "P5",
      route: "phase5",
      segs: ["phase5"],
      available: finalPS && hasConcepts,
      done: hasImages,
      lockHint: finalPS ? lockConcept : lockPS,
    },
  ];

  function stateOf(s: Step): StepState {
    if (s.segs.includes(seg)) return "current";
    if (!s.available) return "locked";
    if (s.done) return "done";
    return "available";
  }

  const aside = [
    {
      label: "주변분석",
      route: "site-analysis",
      segs: ["site-analysis"],
      available: !!project,
    },
    {
      label: "선례",
      route: "precedents",
      segs: ["precedents"],
      available: !!project,
    },
    {
      label: "리포트",
      route: "report",
      segs: ["report"],
      available: !!project,
    },
  ];

  return (
    <nav className="print-hide sticky top-0 z-40 border-b border-[var(--hairline)] bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-2.5">
        <Link
          href="/"
          className="shrink-0 t-caption text-[var(--text-muted)] hover:text-[var(--text-ink)]"
          aria-label="홈으로"
        >
          ← 홈
        </Link>

        {/* Main flow */}
        <ol className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {steps.map((s, i) => {
            const st = stateOf(s);
            return (
              <li key={s.no} className="flex shrink-0 items-center">
                {i > 0 && (
                  <span className="mx-1 h-px w-4 bg-[var(--hairline)]" />
                )}
                <StepPill step={s} state={st} id={id} />
              </li>
            );
          })}
        </ol>

        {/* Cross-cutting artifacts */}
        <div className="flex shrink-0 items-center gap-1 border-l border-[var(--hairline)] pl-3">
          {aside.map((a) => {
            const current = a.segs.includes(seg);
            return a.available && id ? (
              <Link
                key={a.route}
                href={projectPath(id, a.route)}
                className={`rounded-full px-2.5 py-1 t-fine transition-colors ${
                  current
                    ? "bg-[var(--surface-near-black)] text-[var(--accent)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--surface-parchment)] hover:text-[var(--text-ink)]"
                }`}
              >
                {a.label}
              </Link>
            ) : (
              <span
                key={a.route}
                className="rounded-full px-2.5 py-1 t-fine text-[var(--text-muted)] opacity-40"
              >
                {a.label}
              </span>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

function StepPill({
  step,
  state,
  id,
}: {
  step: Step;
  state: StepState;
  id: string;
}) {
  const badge = (
    <span
      className={[
        "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold",
        state === "done"
          ? "bg-[var(--accent)] text-black"
          : state === "current"
            ? "bg-[var(--surface-near-black)] text-[var(--accent)] ring-2 ring-[var(--accent)]"
            : state === "available"
              ? "border border-[var(--text-muted)] text-[var(--text-muted)]"
              : "bg-[var(--surface-parchment)] text-[var(--text-muted)]",
      ].join(" ")}
    >
      {state === "done" ? "✓" : step.no}
    </span>
  );

  const text = (
    <span className="flex items-baseline gap-1">
      <span className="t-fine text-[var(--text-muted)]">{step.sub}</span>
      <span
        className={
          state === "current"
            ? "t-caption-strong text-[var(--text-ink)]"
            : "t-caption text-[var(--text-muted)]"
        }
      >
        {step.label}
      </span>
    </span>
  );

  const inner = (
    <span className="flex items-center gap-1.5">
      {badge}
      {text}
    </span>
  );

  if (state === "locked" || !id) {
    return (
      <span
        className="flex cursor-not-allowed items-center rounded-full px-2 py-1 opacity-40"
        title={step.lockHint ?? "아직 진행할 수 없습니다"}
      >
        {inner}
      </span>
    );
  }

  return (
    <Link
      href={projectPath(id, step.route)}
      className={`flex items-center rounded-full px-2 py-1 transition-colors ${
        state === "current"
          ? "bg-[var(--accent)]/10"
          : "hover:bg-[var(--surface-parchment)]"
      }`}
    >
      {inner}
    </Link>
  );
}
