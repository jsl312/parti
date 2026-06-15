import { NextRequest, NextResponse } from "next/server";

/**
 * Representative photo lookup via the precedent's SOURCE URL.
 * Fetches the cited page server-side (avoids browser CORS) and extracts its
 * social-preview image (<meta property="og:image">, with twitter:image and
 * link[rel=image_src] fallbacks) — i.e. the lead photo the article itself
 * uses. The image is returned as a data URL. Returns { none, reason } when no
 * source URL is given or no preview image is found.
 */

export const runtime = "nodejs";

type Body = { sourceUrl?: string };

// A browser-like UA improves success on sites that reject unknown agents.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function attr(tag: string, name: string): string | null {
  const m = tag.match(
    new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"),
  );
  return m ? (m[2] ?? m[3] ?? null) : null;
}

function resolveUrl(src: string, base: string): string | null {
  try {
    return new URL(src, base).toString();
  } catch {
    return null;
  }
}

function extractPreviewImage(html: string, baseUrl: string): string | null {
  const head = html.slice(0, 1_000_000); // preview meta lives in <head>
  const metas = head.match(/<meta\b[^>]*>/gi) ?? [];
  const priorities = [
    "og:image:secure_url",
    "og:image:url",
    "og:image",
    "twitter:image",
    "twitter:image:src",
  ];
  for (const key of priorities) {
    for (const tag of metas) {
      const prop = (
        attr(tag, "property") ??
        attr(tag, "name") ??
        ""
      ).toLowerCase();
      if (prop !== key) continue;
      const content = attr(tag, "content");
      if (content) {
        const resolved = resolveUrl(content.trim(), baseUrl);
        if (resolved) return resolved;
      }
    }
  }
  const link = head.match(
    /<link\b[^>]*rel\s*=\s*["']image_src["'][^>]*>/i,
  );
  if (link) {
    const href = attr(link[0], "href");
    if (href) return resolveUrl(href.trim(), baseUrl);
  }
  return null;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sourceUrl = (body.sourceUrl ?? "").trim();
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
    return NextResponse.json({ none: true, reason: "no-source" });
  }

  try {
    const page = await fetch(sourceUrl, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en,ko;q=0.8",
      },
      redirect: "follow",
    });
    if (!page.ok) {
      return NextResponse.json({ none: true, reason: `page-${page.status}` });
    }
    const finalUrl = page.url || sourceUrl;
    const html = await page.text();
    const imgUrl = extractPreviewImage(html, finalUrl);
    if (!imgUrl) {
      return NextResponse.json({ none: true, reason: "no-og-image" });
    }

    const img = await fetch(imgUrl, {
      headers: { "User-Agent": UA, Referer: finalUrl },
    });
    if (!img.ok) {
      return NextResponse.json({ none: true, reason: "image-fetch-failed" });
    }
    const mime = img.headers.get("content-type") ?? "image/jpeg";
    if (!mime.startsWith("image/")) {
      return NextResponse.json({ none: true, reason: "not-image" });
    }
    const buf = Buffer.from(await img.arrayBuffer());
    if (buf.byteLength > 8_000_000) {
      return NextResponse.json({ none: true, reason: "too-large" });
    }
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    return NextResponse.json({ dataUrl, source: imgUrl });
  } catch (e) {
    return NextResponse.json({
      none: true,
      reason: "exception",
      error: (e as Error).message,
    });
  }
}
