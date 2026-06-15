"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { projectPath } from "@/lib/types/project";

/**
 * Phase 2 (formerly 2-A) is merged into the Phase 1 page (per-area paste UX).
 * Redirect any saved bookmark / older project state pointing here.
 */
export default function Phase2ARedirect() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(projectPath(params.id, "phase1"));
  }, [params.id, router]);

  return (
    <div className="p-8 text-sm text-neutral-700">
      Phase 1 페이지로 이동 중…
    </div>
  );
}
