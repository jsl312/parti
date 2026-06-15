"use client";

import {
  Concept,
  Project,
  makeReadableProjectId,
  needsReadableIdMigration,
  newConceptId,
} from "@/lib/types/project";

const KEY = "research-brief-app:projects";

function readAll(): Project[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Project[]) : [];
  } catch {
    return [];
  }
}

function writeAll(projects: Project[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(projects));
}

export function listProjects(): Project[] {
  return readAll().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProject(id: string): Project | undefined {
  const all = readAll();
  let hit = all.find((p) => p.id === id);
  if (!hit) {
    // The route param may arrive percent-encoded (Korean / spaces) while the
    // stored id is decoded — try a decoded match too. Also try the reverse.
    try {
      const decoded = decodeURIComponent(id);
      hit = all.find((p) => p.id === decoded);
    } catch {
      /* malformed URI — ignore */
    }
    if (!hit) {
      try {
        const encoded = encodeURIComponent(id);
        hit = all.find((p) => p.id === encoded);
      } catch {
        /* ignore */
      }
    }
  }
  return hit;
}

export function saveProject(project: Project): void {
  const all = readAll();
  const idx = all.findIndex((p) => p.id === project.id);
  const updated = { ...project, updatedAt: new Date().toISOString() };
  if (idx >= 0) all[idx] = updated;
  else all.push(updated);
  writeAll(all);
}

/**
 * Change a project's id in place (localStorage array element) and re-index
 * its IndexedDB images. No-op if ids equal or newId already taken.
 */
export function renameProject(oldId: string, newId: string): void {
  if (oldId === newId) return;
  const all = readAll();
  const idx = all.findIndex((p) => p.id === oldId);
  if (idx < 0) return;
  if (all.some((p) => p.id === newId)) return; // don't clobber another project
  all[idx] = { ...all[idx], id: newId };
  writeAll(all);
  if (typeof window !== "undefined") {
    import("@/lib/store/images")
      .then((m) => m.reindexProjectImages(oldId, newId))
      .catch(() => {
        /* ignore — image reindex is best-effort */
      });
  }
}

/**
 * If the project still has a legacy random id, migrate it to a readable
 * slug derived from its inputs. Returns the (possibly new) id.
 */
export function maybeMigrateLegacyId(project: Project): string {
  if (!needsReadableIdMigration(project.id)) return project.id;
  const taken = readAll()
    .map((p) => p.id)
    .filter((x) => x !== project.id);
  const newId = makeReadableProjectId(project.inputs, taken);
  renameProject(project.id, newId);
  return newId;
}

/**
 * One-time shape migration: older projects stored image-generation data under
 * `project.phase4` (the old Phase4Result shape with images/promptDraft/params).
 * Phase 4 now means concept structuring, so move that payload to
 * `project.phase5`. Idempotent — safe to call on every load.
 */
export function migratePhaseShape(project: Project): Project {
  const p4 = project.phase4 as unknown;
  const looksLikeImageResult =
    !!p4 &&
    typeof p4 === "object" &&
    ("images" in (p4 as object) ||
      "promptDraft" in (p4 as object) ||
      "params" in (p4 as object)) &&
    // a real ConceptStructure never has these keys
    !("parti" in (p4 as object)) &&
    !("spatialStrategies" in (p4 as object));
  if (!looksLikeImageResult) return project;
  const migrated: Project = {
    ...project,
    phase5: project.phase5 ?? (p4 as Project["phase5"]),
    phase4: undefined,
  };
  saveProject(migrated);
  return migrated;
}

/**
 * Migrate the legacy single `project.phase4` ConceptStructure into the
 * `project.concepts` library. Idempotent. Run AFTER migratePhaseShape (which
 * strips old image-shaped phase4); a remaining phase4 is a real concept.
 */
export function migrateConcepts(project: Project): Project {
  if (project.concepts && project.concepts.length > 0) return project;
  const legacy = project.phase4;
  if (
    !legacy ||
    typeof legacy !== "object" ||
    !("parti" in legacy) ||
    !("spatialStrategies" in legacy)
  ) {
    // No legacy concept and no library — nothing to do (concepts created
    // explicitly via the management page).
    return project;
  }
  const concept: Concept = {
    ...legacy,
    id: newConceptId(),
    name: "컨셉 1",
    createdAt: legacy.generatedAt ?? new Date().toISOString(),
  };
  const migrated: Project = {
    ...project,
    concepts: [concept],
    activeConceptId: concept.id,
    phase4: undefined,
  };
  saveProject(migrated);
  return migrated;
}

/**
 * Backfill `conceptId` on Phase 6 images generated before image↔concept
 * linking existed. Best-effort: assign untagged images to the active concept
 * (or the first concept). Idempotent — only touches images missing a
 * conceptId, and only when a concept exists to attribute them to.
 */
export function migrateImageConcepts(project: Project): Project {
  const images = project.phase5?.images;
  if (!images || images.length === 0) return project;
  const fallbackId = project.activeConceptId ?? project.concepts?.[0]?.id;
  if (!fallbackId) return project;
  if (images.every((img) => img.conceptId)) return project;
  const migrated: Project = {
    ...project,
    phase5: {
      ...project.phase5!,
      images: images.map((img) =>
        img.conceptId ? img : { ...img, conceptId: fallbackId },
      ),
    },
  };
  saveProject(migrated);
  return migrated;
}

/** Run all shape migrations in the correct order. */
export function migrateProject(project: Project): Project {
  return migrateImageConcepts(migrateConcepts(migratePhaseShape(project)));
}

/**
 * Merge imported projects into the store by id: existing ids are overwritten
 * with the imported version, new ids are added. Returns counts.
 */
export function importProjects(incoming: Project[]): {
  added: number;
  updated: number;
} {
  const all = readAll();
  const byId = new Map(all.map((p) => [p.id, p]));
  let added = 0;
  let updated = 0;
  for (const p of incoming) {
    if (byId.has(p.id)) updated++;
    else added++;
    byId.set(p.id, p);
  }
  writeAll([...byId.values()]);
  return { added, updated };
}

export function deleteProject(id: string): void {
  writeAll(readAll().filter((p) => p.id !== id));
  // Best-effort: also drop the project's image blobs from IndexedDB.
  // Imported lazily to avoid pulling IDB code into SSR paths.
  if (typeof window !== "undefined") {
    import("@/lib/store/images")
      .then((m) => m.deleteImagesForProject(id))
      .catch(() => {
        /* ignore — orphans are harmless */
      });
  }
}
