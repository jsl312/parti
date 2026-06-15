"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { projectPath } from "@/lib/types/project";

/**
 * The synthesis screen now lives at /phase2b (kept as the route name) but is
 * displayed to the user as "Phase 3". /phase3 is a back-compat redirect.
 */
export default function Phase3Redirect() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(projectPath(params.id, "phase2b"));
  }, [params.id, router]);

  return (
    <div className="p-8 text-sm text-neutral-700">
      Phase 3 페이지로 이동 중…
    </div>
  );
}
