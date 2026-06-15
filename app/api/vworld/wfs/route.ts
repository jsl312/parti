import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy V-World WFS GetFeature → GeoJSON for a bbox. Server-side so the key
 * stays hidden and CORS/domain restrictions don't bite. Returns the raw
 * GeoJSON FeatureCollection (or { features: [] } on miss).
 */

export const runtime = "nodejs";

type Body = {
  key: string;
  domain?: string;
  /** WFS typename (e.g. lt_c_bldginfo). */
  typename: string;
  /** [minLon, minLat, maxLon, maxLat] EPSG:4326. */
  bbox: [number, number, number, number];
  maxFeatures?: number;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const key = (body.key ?? "").trim();
  if (!key) {
    return NextResponse.json(
      { error: "V-World 인증키가 필요합니다." },
      { status: 400 },
    );
  }
  if (!body.typename || !Array.isArray(body.bbox) || body.bbox.length !== 4) {
    return NextResponse.json(
      { error: "typename, bbox 가 필요합니다." },
      { status: 400 },
    );
  }

  // V-World WFS bbox order for EPSG:4326 is lat,lon (miny,minx,maxy,maxx).
  const [minLon, minLat, maxLon, maxLat] = body.bbox;
  const bboxParam = `${minLat},${minLon},${maxLat},${maxLon},EPSG:4326`;
  const params = new URLSearchParams({
    service: "WFS",
    request: "GetFeature",
    version: "2.0.0",
    key,
    typename: body.typename,
    bbox: bboxParam,
    srsName: "EPSG:4326",
    output: "application/json",
    maxFeatures: String(body.maxFeatures ?? 500),
  });
  if (body.domain) params.set("domain", body.domain);
  const url = `https://api.vworld.kr/req/wfs?${params}`;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Free V-World keys throttle concurrent/rapid requests; retry transient
  // failures a couple of times. Always return 200 with a per-layer error so
  // the client can show which layer failed and why (vs. silently empty).
  let lastErr = "";
  let lastRaw = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(500 * attempt);
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const text = await res.text();
      try {
        const fc = JSON.parse(text) as { features?: unknown[] };
        return NextResponse.json({
          type: "FeatureCollection",
          features: Array.isArray(fc.features) ? fc.features : [],
        });
      } catch {
        // XML/HTML error envelope — capture and retry (often transient throttle).
        lastRaw = text.slice(0, 500);
        lastErr = "WFS 응답이 JSON 이 아닙니다 (throttle/권한/데이터없음).";
      }
    } catch (e) {
      lastErr = (e as Error).message || "WFS 요청 실패";
    }
  }
  return NextResponse.json(
    { type: "FeatureCollection", features: [], error: lastErr, raw: lastRaw },
    { status: 200 },
  );
}
