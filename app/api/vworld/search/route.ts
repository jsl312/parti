import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy V-World Search API (type=place) for POIs near a bbox. Runs one search
 * per category keyword and returns flattened items {title, lon, lat, category}.
 * Server-side to hide the key and avoid CORS.
 */

export const runtime = "nodejs";

type Cat = { key: string; label: string; queries: string[] };
type Body = {
  key: string;
  domain?: string;
  bbox: [number, number, number, number];
  categories: Cat[];
};

type SearchResp = {
  response?: {
    status?: string;
    result?: {
      items?: { title?: string; point?: { x?: string; y?: string } }[];
    };
  };
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
  const bboxParam = `${minLon},${minLat},${maxLon},${maxLat}`;
  const dom = body.domain ? `&domain=${encodeURIComponent(body.domain)}` : "";

  const out: {
    title: string;
    lon: number;
    lat: number;
    category: string;
  }[] = [];
  // Dedupe by category + rounded coordinate (same POI returned by variants).
  const seen = new Set<string>();

  for (const cat of body.categories ?? []) {
    for (const query of cat.queries ?? []) {
      const url =
        `https://api.vworld.kr/req/search?service=search&request=search` +
        `&version=2.0&crs=epsg:4326&size=30&page=1&type=place&format=json` +
        `&query=${encodeURIComponent(query)}&bbox=${bboxParam}` +
        `&key=${key}${dom}`;
      try {
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
        });
        const text = await res.text();
        let data: SearchResp;
        try {
          data = JSON.parse(text) as SearchResp;
        } catch {
          continue;
        }
        const items = data.response?.result?.items ?? [];
        for (const it of items) {
          const lon = Number(it.point?.x);
          const lat = Number(it.point?.y);
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
          const dedupe = `${cat.key}:${lon.toFixed(5)},${lat.toFixed(5)}`;
          if (seen.has(dedupe)) continue;
          seen.add(dedupe);
          out.push({
            title: it.title ?? cat.label,
            lon,
            lat,
            category: cat.key,
          });
        }
      } catch {
        // skip this query on failure
      }
    }
  }

  return NextResponse.json({ items: out });
}
