"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  getProject,
  maybeMigrateLegacyId,
  migrateProject,
  saveProject,
} from "@/lib/store/projects";
import { loadSettings } from "@/lib/store/settings";
import { AppSettings, DEFAULT_SETTINGS } from "@/lib/types/settings";
import { ProviderSelect } from "@/components/ModelSelect";
import {
  Project,
  SiteAnalysis,
  SiteAnalysisMetrics,
  needsReadableIdMigration,
  projectPath,
  projectTitle,
} from "@/lib/types/project";
import {
  Bbox,
  LonLat,
  POI_CATEGORIES,
  POI_GROUP_OF,
  USE_GROUP_COLOR,
  UseGroup,
  VWORLD_LAYERS,
  VWORLD_WMS,
  bboxAround,
  bearing,
  buildingUseGroup,
  buildingUseLabel,
  classifyZoning,
  compass8,
  distanceM,
  project as projectPt,
  ringAreaM2,
  ringCentroid,
  walkMinutes,
} from "@/lib/vworld/vworld";

const SVG = 1000; // internal SVG coordinate space (square)
const RADII = [150, 300, 500];

const POI_COLOR: Record<string, string> = {
  subway: "#e8590c",
  bus: "#f08c00",
  food: "#e03131",
  cafe: "#1098ad",
  store: "#37b24d",
  public: "#7048e8",
};

type Ring = LonLat[];
type BuildingFeat = {
  id: string;
  ring: Ring;
  centroid: LonLat;
  floors: number | null;
  height: number | null;
  name: string;
  useGroup: UseGroup;
  useLabel: string;
  footprintM2: number | null;
  props: Record<string, unknown>;
};
type ParcelFeat = { id: string; ring: Ring };
type RoadFeat = {
  id: string;
  line: LonLat[];
  name: string;
  widthM: number | null;
  lanes: number | null;
};
type ZoningFeat = {
  id: string;
  ring: Ring;
  name: string;
  group: UseGroup;
};
type Poi = {
  title: string;
  lon: number;
  lat: number;
  category: string;
  dist: number;
};

type GeoFeature = {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
  id?: string | number;
};

// ─── GeoJSON helpers ──────────────────────────────────────────────────────

function toRing(coords: unknown): Ring | null {
  if (!Array.isArray(coords)) return null;
  const ring: Ring = [];
  for (const c of coords as unknown[]) {
    if (Array.isArray(c) && c.length >= 2) {
      const lon = Number(c[0]);
      const lat = Number(c[1]);
      if (Number.isFinite(lon) && Number.isFinite(lat)) ring.push({ lon, lat });
    }
  }
  return ring.length >= 3 ? ring : null;
}

/** Outer ring of a Polygon / first polygon of a MultiPolygon. */
function outerRing(geom: GeoFeature["geometry"]): Ring | null {
  if (!geom) return null;
  const c = geom.coordinates as unknown;
  if (geom.type === "Polygon" && Array.isArray(c)) return toRing(c[0]);
  if (geom.type === "MultiPolygon" && Array.isArray(c)) {
    const poly = c[0];
    if (Array.isArray(poly)) return toRing(poly[0]);
  }
  return null;
}

function toLine(coords: unknown): LonLat[] {
  if (!Array.isArray(coords)) return [];
  const out: LonLat[] = [];
  for (const c of coords as unknown[]) {
    if (Array.isArray(c) && c.length >= 2) {
      const lon = Number(c[0]);
      const lat = Number(c[1]);
      if (Number.isFinite(lon) && Number.isFinite(lat)) out.push({ lon, lat });
    }
  }
  return out;
}

function roadLines(geom: GeoFeature["geometry"]): LonLat[][] {
  if (!geom) return [];
  const c = geom.coordinates as unknown;
  if (geom.type === "LineString") {
    const l = toLine(c);
    return l.length >= 2 ? [l] : [];
  }
  if (geom.type === "MultiLineString" && Array.isArray(c)) {
    return (c as unknown[])
      .map((seg) => toLine(seg))
      .filter((l) => l.length >= 2);
  }
  return [];
}

function pickNumber(props: Record<string, unknown>, re: RegExp): number | null {
  let best: number | null = null;
  for (const [k, v] of Object.entries(props)) {
    if (!re.test(k)) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) best = best == null ? n : Math.max(best, n);
  }
  return best;
}

function pickString(props: Record<string, unknown>, re: RegExp): string {
  for (const [k, v] of Object.entries(props)) {
    if (re.test(k) && typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** Coarse context label from dominant zoning + commercial POI density. */
function deriveContext(topUse: string | undefined, commercial: number): string {
  const dense = commercial >= 12 ? "밀집" : commercial >= 5 ? "보통" : "한산";
  if (topUse === "업무") return `오피스(업무) 밀집 · 상권 ${dense}`;
  if (topUse === "상업") return `상업 중심 · 상권 ${dense}`;
  if (topUse === "주거")
    return commercial >= 8 ? "주거+상업 혼합" : `주거 중심 · 상권 ${dense}`;
  if (topUse === "공업") return "공업 지역";
  if (topUse === "공공") return "공공·교육·의료 인접";
  if (topUse === "녹지") return "녹지 인접";
  return commercial >= 8 ? `상업 혼합 · 상권 ${dense}` : `혼합 · 상권 ${dense}`;
}

export default function SiteAnalysisPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  const [center, setCenter] = useState<LonLat | null>(null);
  const [radius, setRadius] = useState<number>(300);
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [buildings, setBuildings] = useState<BuildingFeat[]>([]);
  const [parcels, setParcels] = useState<ParcelFeat[]>([]);
  const [roads, setRoads] = useState<RoadFeat[]>([]);
  const [zoningFeats, setZoningFeats] = useState<ZoningFeat[]>([]);
  const [pois, setPois] = useState<Poi[]>([]);
  const [codeHist, setCodeHist] = useState<
    { code: string; label: string; group: string; count: number }[]
  >([]);
  const [show, setShow] = useState({
    building: true,
    parcel: true,
    road: true,
    zoning: false,
    poi: true,
  });
  const [selected, setSelected] = useState<BuildingFeat | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [layerStatus, setLayerStatus] = useState<
    { label: string; count: number; error?: string }[]
  >([]);

  const [metrics, setMetrics] = useState<SiteAnalysisMetrics | null>(null);
  const [note, setNote] = useState<string>("");
  const [noteBusy, setNoteBusy] = useState(false);

  const [latInput, setLatInput] = useState("");
  const [lonInput, setLonInput] = useState("");

  useEffect(() => {
    let p = getProject(params.id);
    if (p && needsReadableIdMigration(p.id)) {
      const newId = maybeMigrateLegacyId(p);
      router.replace(projectPath(newId, "site-analysis"));
      return;
    }
    if (p) p = migrateProject(p);
    setProject(p ?? null);
    setSettings(loadSettings());
    const sa = p?.siteAnalysis;
    if (sa?.center) {
      setCenter(sa.center);
      setLonInput(String(sa.center.lon));
      setLatInput(String(sa.center.lat));
    }
    if (sa?.radiusM) setRadius(sa.radiusM);
    if (sa?.note) setNote(sa.note);
    if (sa?.metrics) setMetrics(sa.metrics);
    setLoaded(true);
  }, [params.id, router]);

  const bbox: Bbox | null = useMemo(
    () => (center ? bboxAround(center, radius) : null),
    [center, radius],
  );

  const vw = settings.vworld;
  const hasKey = !!vw?.apiKey;

  function persist(patch: Partial<SiteAnalysis>) {
    if (!project) return;
    const next: Project = {
      ...project,
      siteAnalysis: { ...(project.siteAnalysis ?? {}), ...patch },
    };
    saveProject(next);
    setProject(next);
  }

  async function handleGeocode() {
    if (!project || !vw?.apiKey) return;
    setGeocoding(true);
    setError(null);
    try {
      const res = await fetch("/api/vworld/geocode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: project.inputs.site,
          key: vw.apiKey,
          domain: vw.domain,
        }),
      });
      const data = (await res.json()) as
        | { lon: number; lat: number; matched: string }
        | { error: string };
      if (!res.ok || "error" in data) {
        setError(("error" in data && data.error) || `HTTP ${res.status}`);
        return;
      }
      const c = { lon: data.lon, lat: data.lat };
      setCenter(c);
      setLonInput(String(c.lon));
      setLatInput(String(c.lat));
      persist({ center: c, address: data.matched });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGeocoding(false);
    }
  }

  function applyManualCenter() {
    const lon = Number(lonInput);
    const lat = Number(latInput);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      setError("유효한 경도/위도를 입력해 주세요.");
      return;
    }
    const c = { lon, lat };
    setCenter(c);
    persist({ center: c });
  }

  async function wfs(
    typename: string,
  ): Promise<{ features: GeoFeature[]; error?: string }> {
    if (!bbox || !vw?.apiKey) return { features: [] };
    const res = await fetch("/api/vworld/wfs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: vw.apiKey,
        domain: vw.domain,
        typename,
        bbox,
        maxFeatures: 800,
      }),
    });
    const data = (await res.json()) as {
      features?: GeoFeature[];
      error?: string;
    };
    return {
      features: Array.isArray(data.features) ? data.features : [],
      error: data.error,
    };
  }

  async function runAnalysis() {
    if (!project || !bbox || !vw?.apiKey) return;
    setBusy(true);
    setError(null);
    setSelected(null);
    try {
      // WMS aerial backdrop (best-effort; overlay still works without it).
      fetch("/api/vworld/map", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: vw.apiKey,
          domain: vw.domain,
          bbox,
          layers: VWORLD_WMS.photoLayer,
          width: 1024,
          height: 1024,
        }),
      })
        .then((r) => r.json())
        .then((d: { dataUrl?: string }) => setMapUrl(d.dataUrl ?? null))
        .catch(() => setMapUrl(null));

      // Sequential (free V-World keys throttle concurrent requests).
      const bldRes = await wfs(VWORLD_LAYERS.building);
      const parRes = await wfs(VWORLD_LAYERS.parcel);
      const rdsRes = await wfs(VWORLD_LAYERS.road);
      const zonRes = await wfs(VWORLD_LAYERS.zoning);
      const bld = bldRes.features;
      const par = parRes.features;
      const rds = rdsRes.features;
      const zon = zonRes.features;
      setLayerStatus([
        { label: "건물", count: bld.length, error: bldRes.error },
        { label: "지적", count: par.length, error: parRes.error },
        { label: "도로", count: rds.length, error: rdsRes.error },
        { label: "용도지역", count: zon.length, error: zonRes.error },
      ]);

      const bFeats: BuildingFeat[] = [];
      bld.forEach((f, i) => {
        const ring = outerRing(f.geometry);
        if (!ring) return;
        const props = f.properties ?? {};
        const useCode = props.usability;
        const useLabel = buildingUseLabel(useCode as string | number);
        const archarea = pickNumber(props, /archarea/i);
        bFeats.push({
          id: String(f.id ?? `b${i}`),
          ring,
          centroid: ringCentroid(ring),
          floors: pickNumber(props, /grnd_flr|gro_flo|flo|층|floor/i),
          height: pickNumber(props, /height|높이|heit|elev/i),
          name: pickString(props, /bld_nm|buld_nm|dong_nm|nm|name|명/i) || "건물",
          useGroup: buildingUseGroup(useCode as string | number),
          useLabel,
          footprintM2: archarea ?? Math.round(ringAreaM2(ring)),
          props,
        });
      });

      const pFeats: ParcelFeat[] = [];
      par.forEach((f, i) => {
        const ring = outerRing(f.geometry);
        if (ring) pFeats.push({ id: String(f.id ?? `p${i}`), ring });
      });

      const rFeats: RoadFeat[] = [];
      rds.forEach((f, i) => {
        const lines = roadLines(f.geometry);
        const props = f.properties ?? {};
        const name = pickString(props, /road_nm|도로명|nm|name|명/i);
        const widthM = pickNumber(props, /width|폭|wdth|wid/i);
        const lanes = pickNumber(props, /lane|차로|lane_co|차선/i);
        lines.forEach((line, j) =>
          rFeats.push({
            id: String(f.id ?? `r${i}_${j}`),
            line,
            name,
            widthM,
            lanes,
          }),
        );
      });

      const zFeats: ZoningFeat[] = [];
      zon.forEach((f, i) => {
        const ring = outerRing(f.geometry);
        if (!ring) return;
        const { group, name } = classifyZoning(f.properties ?? {});
        zFeats.push({ id: String(f.id ?? `z${i}`), ring, name, group });
      });

      setBuildings(bFeats);
      setParcels(pFeats);
      setRoads(rFeats);
      setZoningFeats(zFeats);

      // Usability code histogram (diagnostic: what 주용도 codes are present).
      const codeCount = new Map<string, number>();
      for (const f of bld) {
        const raw = String((f.properties ?? {}).usability ?? "").trim();
        const key = raw || "(미상)";
        codeCount.set(key, (codeCount.get(key) ?? 0) + 1);
      }
      setCodeHist(
        [...codeCount.entries()]
          .map(([code, count]) => ({
            code,
            label:
              code === "(미상)" ? "용도미상" : buildingUseLabel(code) || "기타",
            group: code === "(미상)" ? "기타" : buildingUseGroup(code),
            count,
          }))
          .sort((a, b) => b.count - a.count),
      );

      // Metrics (interior-architecture lens).
      const floorVals = bFeats
        .map((b) => b.floors)
        .filter((n): n is number => n != null);
      const avgFloors = floorVals.length
        ? Math.round(
            (floorVals.reduce((a, b) => a + b, 0) / floorVals.length) * 10,
          ) / 10
        : undefined;
      const maxFloors = floorVals.length ? Math.max(...floorVals) : undefined;
      // Avg completion year from useapr_day (YYYYMMDD).
      const years: number[] = [];
      for (const f of bld) {
        const v = (f.properties ?? {}).useapr_day;
        const y = Number(String(v ?? "").slice(0, 4));
        if (y >= 1900 && y <= 2100) years.push(y);
      }
      const avgBuildYear = years.length
        ? Math.round(years.reduce((a, b) => a + b, 0) / years.length)
        : undefined;
      const c = center!;
      let nearest = Infinity;
      for (const b of bFeats) {
        const d = distanceM(c, b.centroid);
        if (d > 1 && d < nearest) nearest = d; // exclude the site building itself
      }
      const roadNames = [
        ...new Set(rFeats.map((r) => r.name).filter(Boolean)),
      ].slice(0, 8);

      // Use-mix from BUILDING main-use codes, AREA-weighted by 건축면적 (㎡).
      // (Reliable building 'usability' code → 주거/상업/공업; zoning layer is
      // sparse/code-only and unreliable for this.)
      const areaByGroup = new Map<string, number>();
      for (const b of bFeats) {
        const a = b.footprintM2 ?? 0;
        if (a <= 0) continue;
        areaByGroup.set(b.useGroup, (areaByGroup.get(b.useGroup) ?? 0) + a);
      }
      const totalArea =
        [...areaByGroup.values()].reduce((a, b) => a + b, 0) || 1;
      const useMix = [...areaByGroup.entries()]
        .map(([label, area]) => ({
          label,
          count: Math.round((area / totalArea) * 100),
        }))
        .filter((m) => m.count > 0)
        .sort((a, b) => b.count - a.count);

      // POIs — fetch and compute distance/bearing, then derive transit/context.
      let poiItems: Poi[] = [];
      try {
        const r = await fetch("/api/vworld/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            key: vw.apiKey,
            domain: vw.domain,
            bbox,
            categories: POI_CATEGORIES,
          }),
        });
        const d = (await r.json()) as { items?: Omit<Poi, "dist">[] };
        poiItems = (d.items ?? [])
          .map((p) => ({ ...p, dist: Math.round(distanceM(c, p)) }))
          .filter((p) => p.dist <= radius * 1.6)
          .sort((a, b) => a.dist - b.dist);
      } catch {
        poiItems = [];
      }
      setPois(poiItems);

      // Nearest transit (subway/bus) = primary arrival point.
      const transit = poiItems.filter(
        (p) => POI_GROUP_OF[p.category] === "transit",
      );
      const nt = transit[0];
      const nearestTransit = nt
        ? {
            title: nt.title,
            label: POI_CATEGORIES.find((x) => x.key === nt.category)?.label ?? "",
            dist: nt.dist,
            walkMin: walkMinutes(nt.dist),
            bearingDeg: Math.round(bearing(c, nt)),
            compass: compass8(bearing(c, nt)),
          }
        : undefined;

      // Surrounding context from use-mix + commercial POI density.
      const commercialCount = poiItems.filter(
        (p) => POI_GROUP_OF[p.category] === "commercial",
      ).length;
      const topUse = useMix[0]?.label;
      const contextType = deriveContext(topUse, commercialCount);

      const m: SiteAnalysisMetrics = {
        buildingCount: bFeats.length,
        avgFloors,
        maxFloors,
        avgBuildYear,
        nearestBuildingM:
          nearest === Infinity ? undefined : Math.round(nearest),
        useMix: useMix.length ? useMix : undefined,
        nearestTransit,
        entranceCompass: nearestTransit?.compass,
        contextType,
        commercialCount,
      };
      setMetrics(m);

      persist({
        center: c,
        radiusM: radius,
        metrics: m,
        generatedAt: new Date().toISOString(),
      });
      setRoadNames(roadNames);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const [roadNamesState, setRoadNames] = useState<string[]>([]);

  async function generateNote() {
    if (!project || !metrics) return;
    setNoteBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/site-analysis/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: settings[settings.active],
          language: project.language,
          inputs: project.inputs,
          finalPS: project.finalPS,
          metrics,
          roads: roadNamesState,
        }),
      });
      const data = (await res.json()) as { note?: string; error?: string };
      if (!res.ok || data.error) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      setNote(data.note ?? "");
      persist({ note: data.note ?? "" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setNoteBusy(false);
    }
  }


  if (!loaded) {
    return (
      <div className="tile-light min-h-screen p-12">
        <p className="t-body text-[var(--text-muted)]">불러오는 중…</p>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="tile-light min-h-screen p-12">
        <p className="t-body text-[var(--error)]">
          프로젝트를 찾을 수 없습니다.
        </p>
        <Link href="/" className="mt-6 inline-block btn-pill-ghost">
          ← 홈
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <section className="tile-light px-8 pt-12 pb-8">
        <div className="mx-auto max-w-5xl">
          <h1 className="t-display-md">{projectTitle(project)}</h1>
          <p className="mt-3 t-body text-[var(--text-muted)]">
            V-World 데이터로 사이트 주변(건물·지적·도로)을 불러와 실내건축
            관점(채광·시선·소음·접근·주변 용도)에서 분석합니다.
          </p>
          <div className="mt-5">
            <ProviderSelect
              settings={settings}
              onChange={setSettings}
              label="분석 AI"
            />
          </div>
        </div>
      </section>

      {!hasKey && (
        <section className="tile-parchment px-8 py-8">
          <div className="mx-auto max-w-5xl rounded-[18px] border border-[var(--warning)] bg-white p-6">
            <p className="t-body-strong text-[var(--text-ink)]">
              V-World 인증키가 필요합니다.
            </p>
            <p className="mt-2 t-caption text-[var(--text-muted)]">
              설정에서 V-World API 키(및 등록 도메인)를 입력해 주세요.
            </p>
            <Link href="/settings" className="btn-pill-primary mt-4">
              설정으로
            </Link>
          </div>
        </section>
      )}

      {/* Center + controls */}
      <section className="tile-parchment px-8 py-8">
        <div className="mx-auto max-w-5xl rounded-[18px] border border-[var(--hairline)] bg-white p-6">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className="t-caption text-[var(--text-muted)]">대상 사이트</p>
              <p className="t-body-strong">{project.inputs.site}</p>
            </div>
            <button
              onClick={handleGeocode}
              disabled={!hasKey || geocoding}
              className="btn-pill-primary"
            >
              {geocoding ? "좌표 찾는 중…" : "주소로 중심 찾기"}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="t-caption text-[var(--text-muted)]">
              경도(lon)
              <input
                value={lonInput}
                onChange={(e) => setLonInput(e.target.value)}
                className="input-base ml-2 inline-block w-36 !py-2 !text-[14px]"
                placeholder="127.05"
              />
            </label>
            <label className="t-caption text-[var(--text-muted)]">
              위도(lat)
              <input
                value={latInput}
                onChange={(e) => setLatInput(e.target.value)}
                className="input-base ml-2 inline-block w-36 !py-2 !text-[14px]"
                placeholder="37.54"
              />
            </label>
            <button onClick={applyManualCenter} className="btn-pill-ghost">
              좌표 적용
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="t-caption text-[var(--text-muted)]">분석 반경</span>
            <div className="flex gap-1 rounded-full bg-[var(--surface-parchment)] p-1">
              {RADII.map((r) => (
                <button
                  key={r}
                  onClick={() => setRadius(r)}
                  className={`rounded-full px-3 py-1 t-caption ${
                    radius === r
                      ? "bg-white font-semibold text-[var(--text-ink)] shadow-sm"
                      : "text-[var(--text-muted)]"
                  }`}
                >
                  {r}m
                </button>
              ))}
            </div>
            <button
              onClick={runAnalysis}
              disabled={!hasKey || !center || busy}
              className="btn-pill-primary"
            >
              {busy ? "불러오는 중…" : "주변 데이터 불러오기"}
            </button>
            {center && (
              <span className="t-fine text-[var(--text-muted)]">
                중심 {center.lon.toFixed(5)}, {center.lat.toFixed(5)}
              </span>
            )}
          </div>

          {error && (
            <p className="mt-4 rounded-xl bg-[var(--error)]/10 px-4 py-3 t-caption text-[var(--error)]">
              {error}
            </p>
          )}

          {layerStatus.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {layerStatus.map((s) => (
                <span
                  key={s.label}
                  className={`rounded-full px-3 py-1 t-fine ${
                    s.error
                      ? "bg-[var(--error)]/10 text-[var(--error)]"
                      : s.count > 0
                        ? "bg-[var(--accent)]/10 text-[var(--accent-pressed)]"
                        : "bg-[var(--surface-parchment)] text-[var(--text-muted)]"
                  }`}
                  title={s.error ?? ""}
                >
                  {s.label}: {s.count}
                  {s.error ? " ⚠" : ""}
                </span>
              ))}
            </div>
          )}

        </div>
      </section>

      {/* Map + detail */}
      {bbox && (buildings.length > 0 || parcels.length > 0 || mapUrl) && (
        <section className="tile-light px-8 py-8">
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                {(
                  [
                    ["building", "건물"],
                    ["parcel", "지적"],
                    ["road", "도로"],
                    ["zoning", "용도지역"],
                    ["poi", "주변시설"],
                  ] as const
                ).map(([k, label]) => (
                  <label
                    key={k}
                    className="flex items-center gap-1.5 t-caption text-[var(--text-muted)]"
                  >
                    <input
                      type="checkbox"
                      checked={show[k]}
                      onChange={(e) =>
                        setShow((s) => ({ ...s, [k]: e.target.checked }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div className="relative aspect-square w-full overflow-hidden rounded-[18px] border border-[var(--hairline)] bg-[var(--surface-parchment)]">
                {mapUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mapUrl}
                    alt="항공사진"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )}
                <svg
                  viewBox={`0 0 ${SVG} ${SVG}`}
                  className="absolute inset-0 h-full w-full"
                  preserveAspectRatio="none"
                >
                  {show.zoning &&
                    zoningFeats.map((z) => (
                      <polygon
                        key={z.id}
                        points={ringToPoints(z.ring, bbox)}
                        fill={USE_GROUP_COLOR[z.group]}
                        fillOpacity={0.28}
                        stroke={USE_GROUP_COLOR[z.group]}
                        strokeOpacity={0.6}
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                  {show.parcel &&
                    parcels.map((p) => (
                      <polygon
                        key={p.id}
                        points={ringToPoints(p.ring, bbox)}
                        fill="none"
                        stroke="#ffd000"
                        strokeWidth={2}
                        strokeOpacity={0.95}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                  {show.road &&
                    roads.map((r) => {
                      // Stroke width by 폭원(m) → fallback 차로수 → default.
                      const w = r.widthM
                        ? Math.max(2, Math.min(10, r.widthM / 3))
                        : r.lanes
                          ? Math.max(2, Math.min(10, r.lanes * 1.5))
                          : 3;
                      return (
                        <polyline
                          key={r.id}
                          points={lineToPoints(r.line, bbox)}
                          fill="none"
                          stroke="rgba(83,157,245,0.9)"
                          strokeWidth={w}
                          strokeLinecap="round"
                          vectorEffect="non-scaling-stroke"
                        />
                      );
                    })}
                  {show.building &&
                    buildings.map((b) => {
                      const isSel = selected?.id === b.id;
                      const f = b.floors ?? 2;
                      const op = Math.min(0.9, 0.45 + f * 0.05);
                      return (
                        <polygon
                          key={b.id}
                          points={ringToPoints(b.ring, bbox)}
                          fill={USE_GROUP_COLOR[b.useGroup]}
                          fillOpacity={op}
                          stroke={isSel ? "var(--accent)" : "rgba(0,0,0,0.45)"}
                          strokeWidth={isSel ? 4 : 1}
                          vectorEffect="non-scaling-stroke"
                          className="cursor-pointer"
                          onClick={() => setSelected(b)}
                        />
                      );
                    })}
                  {/* Approach path: nearest transit → site (primary arrival) */}
                  {center &&
                    show.poi &&
                    (() => {
                      const t = pois.find(
                        (p) => POI_GROUP_OF[p.category] === "transit",
                      );
                      if (!t) return null;
                      const a = projectPt(t, bbox, SVG, SVG);
                      const s = projectPt(center, bbox, SVG, SVG);
                      return (
                        <line
                          x1={a.x}
                          y1={a.y}
                          x2={s.x}
                          y2={s.y}
                          stroke="var(--accent)"
                          strokeWidth={3}
                          strokeDasharray="10 8"
                          strokeLinecap="round"
                          vectorEffect="non-scaling-stroke"
                        />
                      );
                    })()}
                  {/* POI markers */}
                  {show.poi &&
                    pois.map((p, i) => {
                      const { x, y } = projectPt(p, bbox, SVG, SVG);
                      return (
                        <circle
                          key={`poi${i}`}
                          cx={x}
                          cy={y}
                          r={6}
                          fill="#fff"
                          stroke={POI_COLOR[p.category] ?? "#539df5"}
                          strokeWidth={3}
                          vectorEffect="non-scaling-stroke"
                        >
                          <title>{p.title}</title>
                        </circle>
                      );
                    })}
                  {/* Site center marker */}
                  {center && (
                    <circle
                      cx={projectPt(center, bbox, SVG, SVG).x}
                      cy={projectPt(center, bbox, SVG, SVG).y}
                      r={10}
                      fill="var(--accent)"
                      stroke="#000"
                      strokeWidth={2}
                    />
                  )}
                </svg>
              </div>
              <p className="mt-2 t-fine text-[var(--text-muted)]">
                건물 색 = 용도(주거·상업·공업…), 진할수록 층수가 높음. 건물을
                클릭하면 상세가 표시됩니다. 노란 선 = 지적, 파란 선 = 도로.
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                {(
                  [
                    "주거",
                    "상업",
                    "업무",
                    "공업",
                    "공공",
                    "기타",
                  ] as UseGroup[]
                ).map((g) => (
                    <span
                      key={g}
                      className="flex items-center gap-1.5 t-fine text-[var(--text-muted)]"
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm"
                        style={{ background: USE_GROUP_COLOR[g] }}
                      />
                      {g}
                    </span>
                  ),
                )}
              </div>
            </div>

            {/* Detail panel */}
            <aside className="lg:sticky lg:top-20 lg:self-start">
              {selected ? (
                <div className="rounded-[18px] border border-[var(--accent)] bg-white p-5">
                  <p className="t-caption-strong">
                    {selected.name || "건물"}
                  </p>
                  <dl className="mt-3 space-y-1.5 t-caption">
                    <Row
                      label="주용도"
                      value={
                        selected.useLabel
                          ? `${selected.useLabel} (${selected.useGroup})`
                          : `용도미상 — 코드 ${propStr(selected.props, "usability")}`
                      }
                    />
                    <Row label="지상 층수" value={selected.floors != null ? `${selected.floors}층` : "—"} />
                    <Row label="높이" value={selected.height != null ? `${selected.height} m` : "—"} />
                    <Row
                      label="건축면적"
                      value={
                        selected.footprintM2 != null
                          ? `${selected.footprintM2.toLocaleString()} ㎡`
                          : "—"
                      }
                    />
                    <Row
                      label="건폐율 / 용적률"
                      value={`${propStr(selected.props, "bc_rat", "%")} / ${propStr(selected.props, "vl_rat", "%")}`}
                    />
                    <Row
                      label="중심까지"
                      value={
                        center
                          ? `${Math.round(distanceM(center, selected.centroid))} m`
                          : "—"
                      }
                    />
                  </dl>
                  <details className="mt-3">
                    <summary className="cursor-pointer t-fine text-[var(--text-muted)]">
                      원본 속성 보기
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-[var(--surface-parchment)] p-3 t-fine">
                      {JSON.stringify(selected.props, null, 1)}
                    </pre>
                  </details>
                  <button
                    onClick={() => setSelected(null)}
                    className="btn-pill-ghost mt-3"
                  >
                    닫기
                  </button>
                </div>
              ) : (
                <div className="rounded-[18px] border border-dashed border-[var(--hairline)] bg-[var(--surface-parchment)] px-5 py-10 text-center t-caption text-[var(--text-muted)]">
                  건물을 클릭하면 층수·높이·거리 등 상세가 표시됩니다.
                </div>
              )}
            </aside>
          </div>
        </section>
      )}

      {/* Accessibility / flow + target-customer reading */}
      {metrics && (
        <section className="tile-parchment px-8 py-10">
          <div className="mx-auto max-w-5xl space-y-6">
            {/* A. 접근성 · 진입 동선 */}
            <div>
              <h2 className="t-display-md mb-1">접근성 · 진입 동선</h2>
              <p className="t-caption mb-5 text-[var(--text-muted)]">
                가장 가까운 교통 결절점에서 사이트로 향하는 주 접근 방향을
                읽어 주출입구 · 로비 · 파사드 배치의 근거로 삼습니다. (지도의
                초록 점선 = 주 진입 동선)
              </p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-[18px] border border-[var(--accent)] bg-white p-5">
                  <p className="t-fine text-[var(--accent-pressed)]">
                    주 진입 결절점
                  </p>
                  {metrics.nearestTransit ? (
                    <>
                      <p className="mt-1 t-body-strong text-[var(--text-ink)]">
                        {metrics.nearestTransit.title}
                      </p>
                      <p className="mt-1 t-caption text-[var(--text-muted)]">
                        {metrics.nearestTransit.label} · {metrics.nearestTransit.dist}m
                        · 도보 {metrics.nearestTransit.walkMin}분
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 t-caption text-[var(--text-muted)]">
                      반경 내 지하철·버스 결절점 없음
                    </p>
                  )}
                </div>
                <div className="rounded-[18px] border border-[var(--hairline)] bg-white p-5">
                  <p className="t-fine text-[var(--text-muted)]">
                    주출입구 권장 방향
                  </p>
                  <p className="mt-1 t-tagline font-mono text-[var(--text-ink)]">
                    {metrics.entranceCompass ?? "—"}
                    {metrics.nearestTransit
                      ? ` (${metrics.nearestTransit.bearingDeg}°)`
                      : ""}
                  </p>
                  <p className="mt-1 t-fine text-[var(--text-muted)]">
                    사용자가 오는 방향 = 시선·진입이 모이는 면
                  </p>
                </div>
                <div className="rounded-[18px] border border-[var(--hairline)] bg-white p-5">
                  <p className="t-fine text-[var(--text-muted)]">
                    주변 건물 규모
                  </p>
                  <p className="mt-1 t-tagline font-mono text-[var(--text-ink)]">
                    평균 {metrics.avgFloors ?? "—"}층
                  </p>
                  <p className="mt-1 t-fine text-[var(--text-muted)]">
                    최고 {metrics.maxFloors ?? "—"}층
                    {metrics.avgBuildYear
                      ? ` · 평균 준공 ${metrics.avgBuildYear}년`
                      : ""}
                  </p>
                </div>
              </div>

            </div>

            {/* B. 타겟 고객 · 프로그램 */}
            <div>
              <h2 className="t-display-md mb-1">타겟 고객 · 프로그램 조닝</h2>
              <p className="t-caption mb-5 text-[var(--text-muted)]">
                주변 용도와 상권 밀도로 사용자 성격을 추정해 내부 프로그램 ·
                조닝 방향을 잡습니다. (예: 오피스 밀집 → 테이크아웃 효율 동선 /
                주거 밀집 → 체류형 좌석 조닝)
              </p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-[18px] border border-[var(--hairline)] bg-white p-5">
                  <p className="t-fine text-[var(--text-muted)]">주변 맥락</p>
                  <p className="mt-1 t-tagline text-[var(--text-ink)]">
                    {metrics.contextType ?? "—"}
                  </p>
                  {metrics.useMix && metrics.useMix.length > 0 && (
                    <div className="mt-4">
                      <p className="t-fine text-[var(--text-muted)] mb-2">
                        법적 주용도 분포 (건축물대장 · 건축면적 기준)
                      </p>
                      <UseMixBar mix={metrics.useMix} />
                      <p className="mt-2 t-fine text-[var(--text-muted)]">
                        ※ 건축물대장상 <b>법적 용도</b>입니다. 옛 공업지역
                        (예: 성수동)은 카페·오피스로 쓰여도 법적 용도가
                        &ldquo;공장&rdquo;인 경우가 많아 공업 비중이 높게
                        나올 수 있습니다.
                      </p>
                      {codeHist.length > 0 && (
                        <details className="mt-2">
                          <summary className="cursor-pointer t-fine text-[var(--text-muted)]">
                            용도 코드 분포 보기 (진단)
                          </summary>
                          <ul className="mt-2 space-y-1">
                            {codeHist.map((h) => (
                              <li
                                key={h.code}
                                className="flex items-center justify-between gap-2 t-fine"
                              >
                                <span className="flex items-center gap-1.5">
                                  <span
                                    className="inline-block h-2 w-2 rounded-sm"
                                    style={{
                                      background:
                                        USE_GROUP_COLOR[h.group as UseGroup] ??
                                        USE_GROUP_COLOR["기타"],
                                    }}
                                  />
                                  {h.label}{" "}
                                  <span className="font-mono text-[var(--text-muted)]">
                                    {h.code}
                                  </span>
                                </span>
                                <span className="font-mono text-[var(--text-muted)]">
                                  {h.count}동
                                </span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  )}
                </div>
                <div className="rounded-[18px] border border-[var(--hairline)] bg-white p-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="t-caption-strong">AI 설계 제언</p>
                    <button
                      onClick={generateNote}
                      disabled={noteBusy}
                      className="btn-pill-primary"
                    >
                      {noteBusy ? "생성 중…" : note ? "다시 생성" : "제언 생성"}
                    </button>
                  </div>
                  {note ? (
                    <p className="whitespace-pre-line t-caption text-[var(--text-ink)]">
                      {note}
                    </p>
                  ) : (
                    <p className="t-caption text-[var(--text-muted)]">
                      주출입구 · 로비 동선과 타겟 고객 기반 프로그램 조닝
                      제언을 생성합니다.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function ringToPoints(ring: Ring, bbox: Bbox): string {
  return ring
    .map((p) => {
      const { x, y } = projectPt(p, bbox, SVG, SVG);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
function lineToPoints(line: LonLat[], bbox: Bbox): string {
  return line
    .map((p) => {
      const { x, y } = projectPt(p, bbox, SVG, SVG);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function propStr(
  props: Record<string, unknown>,
  key: string,
  suffix = "",
): string {
  const v = props[key];
  if (v == null || v === "") return "—";
  return `${v}${suffix}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd className="font-mono text-[var(--text-ink)]">{value}</dd>
    </div>
  );
}

function UseMixBar({ mix }: { mix: { label: string; count: number }[] }) {
  const total = mix.reduce((a, b) => a + b.count, 0) || 1;
  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded-full">
        {mix.map((m) => (
          <div
            key={m.label}
            style={{
              width: `${(m.count / total) * 100}%`,
              background:
                USE_GROUP_COLOR[m.label as UseGroup] ?? USE_GROUP_COLOR["기타"],
            }}
            title={`${m.label} ${Math.round((m.count / total) * 100)}%`}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {mix.map((m) => (
          <span
            key={m.label}
            className="flex items-center gap-1.5 t-fine text-[var(--text-muted)]"
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{
                background:
                  USE_GROUP_COLOR[m.label as UseGroup] ??
                  USE_GROUP_COLOR["기타"],
              }}
            />
            {m.label} {Math.round((m.count / total) * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}

