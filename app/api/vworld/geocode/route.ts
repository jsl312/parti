import { NextRequest, NextResponse } from "next/server";

/**
 * Geocode a site string to lon/lat via V-World. Site inputs are often informal
 * (neighbourhood + program), so we try, in order: road-address coord →
 * parcel-address coord → place/district search. Returns { lon, lat, matched }.
 */

export const runtime = "nodejs";

type Body = { query: string; key: string; domain?: string };

type CoordResp = {
  response?: {
    status?: string;
    result?: { point?: { x?: string; y?: string } };
  };
};
type SearchResp = {
  response?: {
    status?: string;
    result?: {
      items?: { point?: { x?: string; y?: string }; title?: string }[];
    };
  };
};

const BASE = "https://api.vworld.kr/req";

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function coordFrom(d: CoordResp): { lon: number; lat: number } | null {
  if (d.response?.status !== "OK") return null;
  const p = d.response.result?.point;
  const lon = Number(p?.x);
  const lat = Number(p?.y);
  return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat } : null;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const query = (body.query ?? "").trim();
  const key = (body.key ?? "").trim();
  if (!key) {
    return NextResponse.json(
      { error: "V-World 인증키가 필요합니다. 설정에서 입력해 주세요." },
      { status: 400 },
    );
  }
  if (!query) {
    return NextResponse.json({ error: "주소가 필요합니다." }, { status: 400 });
  }

  const dom = body.domain ? `&domain=${encodeURIComponent(body.domain)}` : "";
  const q = encodeURIComponent(query);

  // 1) road address
  const road = (await getJson(
    `${BASE}/address?service=address&request=getcoord&version=2.0&crs=epsg:4326&type=road&address=${q}&key=${key}${dom}`,
  )) as CoordResp | null;
  let hit = road ? coordFrom(road) : null;
  let matched = query;

  // 2) parcel (지번) address
  if (!hit) {
    const parcel = (await getJson(
      `${BASE}/address?service=address&request=getcoord&version=2.0&crs=epsg:4326&type=parcel&address=${q}&key=${key}${dom}`,
    )) as CoordResp | null;
    hit = parcel ? coordFrom(parcel) : null;
  }

  // 3) place / district search
  if (!hit) {
    for (const type of ["place", "district"]) {
      const s = (await getJson(
        `${BASE}/search?service=search&request=search&version=2.0&crs=epsg:4326&size=1&query=${q}&type=${type}&format=json&key=${key}${dom}`,
      )) as SearchResp | null;
      const item = s?.response?.result?.items?.[0];
      const lon = Number(item?.point?.x);
      const lat = Number(item?.point?.y);
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        hit = { lon, lat };
        if (item?.title) matched = item.title;
        break;
      }
    }
  }

  if (!hit) {
    return NextResponse.json(
      {
        error:
          "주소를 좌표로 변환하지 못했습니다. 더 구체적인 주소를 입력하거나 지도를 직접 이동해 중심을 지정해 주세요.",
      },
      { status: 404 },
    );
  }
  return NextResponse.json({ lon: hit.lon, lat: hit.lat, matched });
}
