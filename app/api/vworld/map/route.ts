import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy V-World WMS GetMap → PNG for a bbox. Server-side so the key stays
 * hidden. Returns the image bytes directly (use as <img src> via the same URL
 * with a GET, or fetch+blob). We accept POST with JSON for consistency and
 * return a data URL.
 */

export const runtime = "nodejs";

type Body = {
  key: string;
  domain?: string;
  /** [minLon, minLat, maxLon, maxLat] EPSG:4326. */
  bbox: [number, number, number, number];
  layers?: string;
  width?: number;
  height?: number;
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
  if (!Array.isArray(body.bbox) || body.bbox.length !== 4) {
    return NextResponse.json({ error: "bbox 가 필요합니다." }, { status: 400 });
  }

  const [minLon, minLat, maxLon, maxLat] = body.bbox;
  const width = body.width ?? 1024;
  const height = body.height ?? 1024;
  // WMS 1.3.0 with EPSG:4326 expects bbox in lat,lon order.
  const params = new URLSearchParams({
    service: "WMS",
    request: "GetMap",
    version: "1.3.0",
    key,
    layers: body.layers ?? "Satellite",
    crs: "EPSG:4326",
    bbox: `${minLat},${minLon},${maxLat},${maxLon}`,
    width: String(width),
    height: String(height),
    format: "image/png",
    transparent: "false",
  });
  if (body.domain) params.set("domain", body.domain);

  try {
    const res = await fetch(`https://api.vworld.kr/req/wms?${params}`);
    const ctype = res.headers.get("content-type") ?? "";
    if (!res.ok || !ctype.startsWith("image/")) {
      const txt = await res.text().catch(() => "");
      return NextResponse.json(
        {
          error:
            "V-World WMS 이미지를 받지 못했습니다 (키/도메인/권한 확인).",
          raw: txt.slice(0, 400),
        },
        { status: 502 },
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const dataUrl = `data:${ctype};base64,${buf.toString("base64")}`;
    return NextResponse.json({ dataUrl });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "WMS 요청 실패" },
      { status: 502 },
    );
  }
}
