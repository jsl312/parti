/**
 * V-World helpers — layer codes, bbox math (meters ↔ degrees), and lon/lat →
 * pixel projection for the SVG overlay. No external dependency.
 */

export type LonLat = { lon: number; lat: number };
/** [minLon, minLat, maxLon, maxLat] in EPSG:4326. */
export type Bbox = [number, number, number, number];

/** V-World WFS feature types used for surrounding-site analysis. */
export const VWORLD_LAYERS = {
  /** 건물통합정보 (footprint + 층수/용도/높이 속성). */
  building: "lt_c_bldginfo",
  /** 연속지적도 (필지 경계). */
  parcel: "lp_pa_cbnd_bubun",
  /** 도로구간. */
  road: "lt_l_moctlink",
  /** 용도지역 (도시지역). */
  zoning: "lt_c_uq111",
} as const;

export type VworldLayerKey = keyof typeof VWORLD_LAYERS;

// ─── Land-use category grouping (for use-mix + overlay colors) ─────────────

export type UseGroup =
  | "주거"
  | "상업"
  | "업무"
  | "공업"
  | "공공"
  | "녹지"
  | "관리"
  | "기타";

export const USE_GROUP_COLOR: Record<UseGroup, string> = {
  주거: "#f6c945", // amber
  상업: "#ef5da8", // pink
  업무: "#4263eb", // strong blue (오피스)
  공업: "#7c6df2", // violet
  공공: "#15aabf", // cyan (공공·교육·의료·문화)
  녹지: "#37c871", // green
  관리: "#9aa0a6", // grey
  기타: "#adb5bd", // light grey (미상·기타)
};

/**
 * Map a 용도지역 name OR building 주용도 OR V-World code to a coarse group.
 * Order matters (관리 before 녹지; 공업 before generic).
 */
export function useGroupOf(name: string): UseGroup {
  const s = name ?? "";
  // Korean names — zoning districts + building main-use terms.
  if (/주거|주택|아파트|연립|다세대|다가구|단독|공동주택/.test(s)) return "주거";
  if (/상업|판매|근린생활|업무|오피스|사무|숙박|위락|상가/.test(s)) return "상업";
  if (/공업|공장|제조|산업/.test(s)) return "공업";
  if (/관리지역|계획관리|생산관리|보전관리/.test(s)) return "관리";
  if (/녹지|공원|보전|자연|생산|임야|농림|전답/.test(s)) return "녹지";
  // Code fallback — V-World 용도지역 codes (UQA1xx 주거 / 2xx 상업 / 3xx 공업 / 4xx 녹지).
  const c = s.toUpperCase();
  if (/UQA?1[1-3]/.test(c)) return "주거";
  if (/UQA?2[1-4]/.test(c)) return "상업";
  if (/UQA?3[1-3]/.test(c)) return "공업";
  if (/UQA?4[1-3]/.test(c)) return "녹지";
  return "기타";
}

/**
 * Classify a zoning feature by scanning ALL its string property values for a
 * 용도지역 keyword. Robust to unknown field names / code-vs-name fields.
 * Returns the group and the matched display name.
 */
export function classifyZoning(props: Record<string, unknown>): {
  group: UseGroup;
  name: string;
} {
  let name = "";
  for (const v of Object.values(props)) {
    if (typeof v !== "string" && typeof v !== "number") continue;
    const s = String(v);
    const g = useGroupOf(s);
    if (g !== "기타") return { group: g, name: name || s };
    // keep a fallback display name (prefer values mentioning 지역/지구)
    if (!name && typeof v === "string" && /지역|지구|구역/.test(v)) name = v;
  }
  return { group: "기타", name };
}

// ─── Building main-use code (lt_c_bldginfo.usability) → group + label ──────

const USE_CODE_GROUP: Record<string, UseGroup> = {
  "01": "주거", // 단독주택
  "02": "주거", // 공동주택
  "03": "상업", // 제1종근린생활
  "04": "상업", // 제2종근린생활
  "05": "공공", // 문화및집회
  "06": "공공", // 종교
  "07": "상업", // 판매
  "08": "기타", // 운수
  "09": "공공", // 의료
  "10": "공공", // 교육연구
  "11": "공공", // 노유자
  "12": "공공", // 수련
  "13": "상업", // 운동
  "14": "업무", // 업무시설(오피스)
  "15": "상업", // 숙박
  "16": "상업", // 위락
  "17": "공업", // 공장
  "18": "공업", // 창고
  "19": "공업", // 위험물저장처리
  "20": "공업", // 자동차관련
  "21": "기타", // 동식물관련
  "22": "공업", // 자원순환
  "23": "공공", // 교정및군사
  "24": "공공", // 방송통신
  "25": "공업", // 발전
  "26": "기타", // 묘지관련
  "27": "상업", // 관광휴게
  "28": "기타", // 장례
};

const USE_CODE_LABEL: Record<string, string> = {
  "01": "단독주택",
  "02": "공동주택",
  "03": "제1종근린생활",
  "04": "제2종근린생활",
  "05": "문화·집회",
  "06": "종교",
  "07": "판매",
  "08": "운수",
  "09": "의료",
  "10": "교육·연구",
  "11": "노유자",
  "12": "수련",
  "13": "운동",
  "14": "업무",
  "15": "숙박",
  "16": "위락",
  "17": "공장",
  "18": "창고",
  "19": "위험물",
  "20": "자동차",
  "21": "동·식물",
  "22": "자원순환",
  "23": "교정·군사",
  "24": "방송통신",
  "25": "발전",
  "26": "묘지",
  "27": "관광휴게",
  "28": "장례",
};

/** Map a building main-use code (e.g. "17000") to a coarse group. */
export function buildingUseGroup(code: string | number | undefined): UseGroup {
  const k = String(code ?? "").trim().slice(0, 2);
  return USE_CODE_GROUP[k] ?? "기타";
}

/** Map a building main-use code to a short Korean label. */
export function buildingUseLabel(code: string | number | undefined): string {
  const k = String(code ?? "").trim().slice(0, 2);
  return USE_CODE_LABEL[k] ?? "";
}

// ─── POI categories (V-World Search API) — grouped for flow/customer reading ─

export type PoiGroup = "transit" | "commercial" | "public" | "amenity";

export const POI_CATEGORIES: {
  key: string;
  label: string;
  /** Multiple query variants — V-World place search is keyword-based, so we
   *  try several terms per category and merge to maximise hits. */
  queries: string[];
  group: PoiGroup;
}[] = [
  {
    key: "subway",
    label: "지하철역",
    queries: ["지하철역", "전철역", "도시철도역"],
    group: "transit",
  },
  {
    key: "bus",
    label: "버스정류장",
    queries: ["버스정류장", "버스정류소", "정류장"],
    group: "transit",
  },
  {
    key: "food",
    label: "음식점",
    queries: ["음식점", "식당"],
    group: "commercial",
  },
  { key: "cafe", label: "카페", queries: ["카페", "커피"], group: "commercial" },
  {
    key: "store",
    label: "편의점",
    queries: ["편의점", "마트", "슈퍼마켓"],
    group: "commercial",
  },
  {
    key: "public",
    label: "공공기관",
    queries: ["주민센터", "행정복지센터", "구청", "동사무소", "도서관"],
    group: "public",
  },
];

export const POI_GROUP_OF: Record<string, PoiGroup> = Object.fromEntries(
  POI_CATEGORIES.map((c) => [c.key, c.group]),
);

const COMPASS_8 = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];

/** Bearing (deg, 0=N clockwise) from `a` to `b`. */
export function bearing(a: LonLat, b: LonLat): number {
  const dLon = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const dLat = b.lat - a.lat;
  let deg = (Math.atan2(dLon, dLat) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

/** 8-point Korean compass label for a bearing in degrees. */
export function compass8(deg: number): string {
  return COMPASS_8[Math.round(deg / 45) % 8];
}

/** Rough walking time (minutes) for a distance in meters (~75 m/min). */
export function walkMinutes(m: number): number {
  return Math.max(1, Math.round(m / 75));
}

/** WMS base-map layer + style for the aerial photo backdrop. */
export const VWORLD_WMS = {
  /** 항공사진(정사영상). */
  photoLayer: "Satellite",
  baseLayer: "Base",
} as const;

const M_PER_DEG_LAT = 111_320;

/** Build a square bbox of `radiusM` around a center point (EPSG:4326). */
export function bboxAround(center: LonLat, radiusM: number): Bbox {
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLon =
    radiusM / (M_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180));
  return [
    center.lon - dLon,
    center.lat - dLat,
    center.lon + dLon,
    center.lat + dLat,
  ];
}

/** Approximate meter distance between two lon/lat points (equirectangular). */
export function distanceM(a: LonLat, b: LonLat): number {
  const dLat = (b.lat - a.lat) * M_PER_DEG_LAT;
  const dLon =
    (b.lon - a.lon) *
    M_PER_DEG_LAT *
    Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

/**
 * Project a lon/lat to pixel coords within a [width × height] viewport that
 * exactly covers `bbox`. Y is flipped (north = top). Latitude is treated
 * linearly — fine for the small extents used here.
 */
export function project(
  pt: LonLat,
  bbox: Bbox,
  width: number,
  height: number,
): { x: number; y: number } {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const x = ((pt.lon - minLon) / (maxLon - minLon)) * width;
  const y = (1 - (pt.lat - minLat) / (maxLat - minLat)) * height;
  return { x, y };
}

/** Shoelace area (m²) of a lon/lat ring, using local meter scaling. */
export function ringAreaM2(ring: LonLat[]): number {
  if (ring.length < 3) return 0;
  const lat0 = ring[0].lat;
  const mx = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  const my = M_PER_DEG_LAT;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const xi = ring[i].lon * mx;
    const yi = ring[i].lat * my;
    const xj = ring[j].lon * mx;
    const yj = ring[j].lat * my;
    a += xi * yj - xj * yi;
  }
  return Math.abs(a) / 2;
}

/** Centroid of a lon/lat ring (simple average of vertices). */
export function ringCentroid(ring: LonLat[]): LonLat {
  const n = ring.length || 1;
  let lon = 0;
  let lat = 0;
  for (const p of ring) {
    lon += p.lon;
    lat += p.lat;
  }
  return { lon: lon / n, lat: lat / n };
}
