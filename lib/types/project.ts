export type Language = "ko" | "en";

export type ResearchArea =
  | "site_context"
  | "users_community"
  | "precedent_studies"
  | "socio_cultural"
  | "typology_limits";

export type Phase = "1" | "2A" | "2B" | "3" | "4" | "5";

export type ProjectInputs = {
  site: string;
  typology: string;
  scale?: string;
  client?: string;
  constraints?: string;
};

export type Phase1Prompt = {
  area: ResearchArea;
  title: string;
  body: string;
};

export type Phase1Result = {
  prompts: Phase1Prompt[];
  uploadScaffold: string;
  generatedAt: string;
};

export type Phase2ATagPreview = {
  area: ResearchArea;
  primary: number;
  secondary: number;
  unverified: number;
  note?: string;
};

export type Phase2ARisk = {
  finding: string;
  reason: string;
  verifyAt: string;
};

export type Phase2AGap = {
  area: ResearchArea | "general";
  description: string;
};

export type Phase2AReview = {
  tagPreview: Phase2ATagPreview[];
  headlineRisks: Phase2ARisk[];
  contentGaps: Phase2AGap[];
  reviewedAt: string;
  uploadHash?: string;
};

export type Phase2AChoice = "a" | "b";

export type SourceConfidence = "1차" | "2차" | "미확인";

export type FindingSource = {
  name: string;
  url?: string;
};

export type Finding = {
  id: string;
  area: ResearchArea;
  headline: string;
  detail: string;
  confidence: SourceConfidence;
  sources: FindingSource[];
  patternIds: string[];
};

export type PatternId = "p1" | "p2" | "p3" | "p4";
export type PatternLabel = "A" | "B" | "C" | "D";

export type Pattern = {
  id: PatternId;
  label: PatternLabel;
  title: string;
  rationale: string;
  findingIds: string[];
};

export type ProblemStatementCandidate = {
  text: string;
  rationale: string;
};

export type Phase2BResult = {
  findings: Finding[];
  patterns: Pattern[];
  candidates: ProblemStatementCandidate[];
  generatedAt: string;
};

export const PATTERN_LABEL: Record<PatternId, PatternLabel> = {
  p1: "A",
  p2: "B",
  p3: "C",
  p4: "D",
};

// ─── Phase 4 — Concept structuring ───────────────────────────────────────

export type SpatialStrategy = {
  /** Links to a cross-cutting Pattern (p1–p4). */
  patternId: PatternId;
  /** Denormalized pattern title for display stability. */
  patternTitle: string;
  /** The concrete design move that answers that pattern. */
  strategy: string;
};

// ─── Surrounding site analysis (V-World) ─────────────────────────────────

/**
 * 건폐율·용적률 계산기. 건축면적 / 대지면적 → 건폐율; 연면적 / 대지면적 →
 * 용적률. Areas may be entered manually or auto-filled from V-World polygons.
 * Legal caps are optional and only drive pass/over badges.
 */
export type ZoningCalc = {
  /** 대지면적 — site area (m²). */
  siteArea?: number;
  /** 건축면적 — building footprint area (m²). */
  buildingArea?: number;
  /** 층수 — number of floors (used when gross area is computed). */
  floors?: number;
  /** 연면적 직접 입력 (m²) when useManualGross is true. */
  grossAreaManual?: number;
  /** If true, use grossAreaManual; else gross = building area × floors. */
  useManualGross?: boolean;
  /** 법정 건폐율 상한 (%). */
  legalCoverage?: number;
  /** 법정 용적률 상한 (%). */
  legalFar?: number;
};

export type ConceptStructure = {
  /** 1–2 sentence design thesis answering the Problem Statement. */
  parti: string;
  /** 3–6 concept keywords / a guiding metaphor. */
  keywords: string[];
  /** One spatial strategy per cross-cutting pattern. */
  spatialStrategies: SpatialStrategy[];
  /** Material palette · light · tactility · mood. */
  materiality: string;
  /** Concrete visual elements an image must show. */
  sceneAnchors: string[];
  generatedAt?: string;
};

/** A named concept in a project's concept library (multiple per project). */
export type Concept = ConceptStructure & {
  id: string;
  name: string;
  createdAt: string;
};

export function newConceptId(): string {
  return `cpt_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

export function emptyConcept(
  name: string,
  patterns: { id: PatternId; title: string }[],
): Concept {
  return {
    id: newConceptId(),
    name,
    createdAt: new Date().toISOString(),
    parti: "",
    keywords: [],
    spatialStrategies: patterns.map((p) => ({
      patternId: p.id,
      patternTitle: p.title,
      strategy: "",
    })),
    materiality: "",
    sceneAnchors: [],
  };
}

// ─── Phase 5 — Concept image generation ──────────────────────────────────

export type ViewpointKind =
  | "human_eye"
  | "aerial"
  | "section_perspective"
  | "interior_eye";

export type Mood =
  | "cold_morning"
  | "overcast_afternoon"
  | "golden_hour"
  | "blue_hour"
  | "night";

export type RenderStyle =
  | "photoreal"
  | "watercolor"
  | "bw_diagram"
  | "ink_sketch"
  | "isometric_diagram"
  | "clay_render";

// Each may be a preset key (ViewpointKind/Mood/RenderStyle) OR a free-form
// string the user typed in. Stored as string; label lookup falls back to the
// raw value when it isn't a known preset.
export type ConceptParams = {
  viewpoint: ViewpointKind | string;
  mood: Mood | string;
  style: RenderStyle | string;
  extras?: string;
};

export type ImageProviderKind = "comfyui" | "gemini_image" | "openai";

export type ConceptImage = {
  id: string;
  /** The concept this image was generated for (links image → concept). */
  conceptId?: string;
  prompt: string;
  params: ConceptParams;
  providerKind: ImageProviderKind;
  model: string;
  createdAt: string;
  /** Key into the IndexedDB `concept_images` store. Bytes are not in localStorage. */
  blobKey: string;
  /** Optional mime hint for download / display. */
  mime?: string;
};

export type Phase5Result = {
  params?: ConceptParams;
  promptDraft?: string;
  images: ConceptImage[];
};

// ─── Reference precedents — external-AI search prompts + collected notes ──

export type PrecedentPrompt = {
  /** Angle code (typology_scale, design_approach, …). */
  angle: string;
  /** Visible header (Korean/English), forced from the angle definition. */
  title: string;
  /** Self-contained search prompt the user pastes into an external AI. */
  body: string;
};

/** A structured precedent collected from external-AI research results. */
export type PrecedentItem = {
  id: string;
  /** Which search-prompt angle (PrecedentPrompt.angle) this precedent came from. */
  angle?: string;
  /** 프로젝트명 */
  name: string;
  /** 건축가 / 사무소 */
  architect?: string;
  /** 완공 연도 */
  year?: string;
  /** 위치 */
  location?: string;
  /** 핵심 공간 전략 */
  strategy?: string;
  /** 본 프로젝트와의 연관성 */
  relevance?: string;
  /** 출처 URL */
  sourceUrl?: string;
  /** Optional photo stored in the IndexedDB image store. */
  photoBlobKey?: string;
  photoMime?: string;
  createdAt: string;
};

export type PrecedentStudy = {
  prompts: PrecedentPrompt[];
  /** Structured precedents parsed from pasted research results. */
  items?: PrecedentItem[];
  /** @deprecated Free-text notes (older projects). Superseded by `items`. */
  notes?: string;
  generatedAt: string;
  /** Which concept (if any) informed the prompt generation. */
  basedOnConceptId?: string;
};

// ─── Surrounding site analysis (V-World) — persisted summary ──────────────

export type SiteAnalysisMetrics = {
  buildingCount?: number;
  avgFloors?: number;
  maxFloors?: number;
  /** Average completion year of surrounding buildings (노후도). */
  avgBuildYear?: number;
  /** Distance (m) from the site center to the nearest neighbouring building. */
  nearestBuildingM?: number;
  /** Surrounding land-use mix (zoning category → parcel count). */
  useMix?: { label: string; count: number }[];
  /** Nearest transit (subway/bus) — primary arrival point. */
  nearestTransit?: {
    title: string;
    label: string;
    dist: number;
    walkMin: number;
    bearingDeg: number;
    compass: string;
  };
  /** Recommended main-entrance facing (toward the dominant arrival). */
  entranceCompass?: string;
  /** Coarse surrounding context label (e.g. 상업 혼합 · 음식점 밀집). */
  contextType?: string;
  /** Surrounding commercial POI count within radius. */
  commercialCount?: number;
};

export type SiteAnalysis = {
  /** Geocoded site center. */
  center?: { lon: number; lat: number };
  /** Analysis radius in meters. */
  radiusM?: number;
  /** Geocoded / resolved address string. */
  address?: string;
  /** 건폐율·용적률 계산기 상태. */
  zoning?: ZoningCalc;
  /** Computed surrounding metrics (interior-architecture lens). */
  metrics?: SiteAnalysisMetrics;
  /** LLM 실내건축 관점 종합 코멘트. */
  note?: string;
  generatedAt?: string;
};

export type Project = {
  id: string;
  createdAt: string;
  updatedAt: string;
  language: Language;
  inputs: ProjectInputs;
  phase: Phase;
  /** Reference precedent search prompts + collected notes (project-level). */
  precedents?: PrecedentStudy;
  /** Surrounding site analysis (V-World) — persisted summary. */
  siteAnalysis?: SiteAnalysis;
  phase1?: Phase1Result;
  /** Per-area pasted research from external AIs. Keyed by ResearchArea. */
  phase1AreaResults?: Partial<Record<ResearchArea, string>>;
  /**
   * User-verified supplementary material (primary-source lookups done after
   * Phase 2-A flagged risks: 토지이음, 통계청, 공식 보도자료 등). Treated as
   * [1차] evidence by the synthesis prompt — does NOT form a 6th research area.
   */
  phase1Supplement?: string;
  /** Concatenated markdown built from phase1AreaResults + supplement; passed to Phase 2-A. */
  uploadedResearch?: string;
  phase2A?: Phase2AReview;
  phase2AChoice?: Phase2AChoice;
  phase2B?: Phase2BResult;
  /** Final Problem Statement chosen / edited by the user. */
  finalPS?: string;
  /**
   * @deprecated Legacy single concept. Migrated into `concepts` on load.
   * Kept only so `migrateConcepts` can detect & convert old projects.
   */
  phase4?: ConceptStructure;
  /** Phase 4 — concept library (multiple structured concepts per project). */
  concepts?: Concept[];
  /** Id of the concept currently being edited / fed into Phase 5. */
  activeConceptId?: string;
  /** Phase 5 — concept image generation results. */
  phase5?: Phase5Result;
  /**
   * Curation metadata for batch-generated concepts (star rating + tags),
   * keyed by `${runId}-${index}`. The concepts themselves live on disk
   * (parti-output); only this lightweight curation lives in the project.
   */
  batchCuration?: Record<string, BatchCuration>;
};

/** Star rating + tags a user attaches to a batch-generated concept. */
export type BatchCuration = {
  /** 0–5; 0 = unrated. */
  rating?: number;
  tags?: string[];
};

/** The concept Phase 4 edits and Phase 5 consumes. */
export function getActiveConcept(p: Project): Concept | undefined {
  if (!p.concepts || p.concepts.length === 0) return undefined;
  return (
    p.concepts.find((c) => c.id === p.activeConceptId) ?? p.concepts[0]
  );
}

/**
 * Concatenate per-area pasted results into the unified scaffold markdown
 * that the skill expects ("# ① 사이트 맥락\n...\n\n# ② ..."). Optional supplement
 * content is appended as a final "# 보완 자료 (사용자 검증)" section.
 */
export function buildUploadedResearch(
  prompts: Phase1Prompt[],
  areaResults: Partial<Record<ResearchArea, string>>,
  supplement?: string,
): string {
  const sections = prompts.map((p) => {
    const body = (areaResults[p.area] ?? "").trim();
    return `# ${p.title}\n${body || "답변 없음"}`;
  });
  const supp = (supplement ?? "").trim();
  if (supp) {
    sections.push(`# 보완 자료 (사용자 검증)\n${supp}`);
  }
  return sections.join("\n\n");
}

export function newProjectId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Old random ids look like "p_mof4qv5a_fvlvq8". Readable ids derived from
// site + typology don't match this shape.
const LEGACY_ID_RE = /^p_[a-z0-9]+_[a-z0-9]+$/i;

export function isLegacyProjectId(id: string): boolean {
  return LEGACY_ID_RE.test(id);
}

/**
 * True if the id should be (re)generated into a clean slug — covers both old
 * random ids ("p_xxx_yyy") and earlier space-containing slugs that encode
 * into ugly "%20" in the address bar.
 */
export function needsReadableIdMigration(id: string): boolean {
  return isLegacyProjectId(id) || /[\s%]/.test(id);
}

/**
 * Build a human-readable, URL-clean project id from the inputs, e.g.
 * "서울_성동구_연무장11길_8_코워킹". Korean is kept (browsers show it decoded);
 * whitespace becomes "_" so the address bar has no "%20". Collisions get a
 * "_2" suffix.
 */
export function makeReadableProjectId(
  inputs: ProjectInputs,
  takenIds: string[] = [],
): string {
  const clean = (s: string): string =>
    s
      .trim()
      // drop characters that break URL path segments
      .replace(/[\\/#?%&]/g, " ")
      // whitespace → single underscore
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
  const site = clean(inputs.site || "") || "사이트미정";
  const typology = clean(inputs.typology || "") || "유형미정";
  const base = `${site}_${typology}`.slice(0, 80) || "project";
  let id = base;
  let n = 2;
  while (takenIds.includes(id)) id = `${base}_${n++}`;
  return id;
}

/**
 * Build an app route for a project. Idempotent w.r.t. encoding: decodes
 * first (so an already-encoded id isn't double-encoded), then encodes once.
 * Plain Korean/underscore ids decode to themselves, so this is safe.
 */
export function projectPath(id: string, sub: string): string {
  let raw = id;
  try {
    raw = decodeURIComponent(id);
  } catch {
    /* malformed escape — use as-is */
  }
  return `/project/${encodeURIComponent(raw)}/${sub}`;
}

export function projectTitle(p: Project): string {
  const site = p.inputs.site || "(사이트 미정)";
  const typology = p.inputs.typology || "(유형 미정)";
  return `${site} · ${typology}`;
}
