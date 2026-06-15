import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Serve a single batch image from
 * <outputDir>/<rootName>/<runId>/<NNN>/images/<name>. Every path segment is
 * sanitized and the resolved path is verified to stay under the output base,
 * so it cannot be used to read arbitrary files.
 */

function sanitizeSegment(s: string): string {
  return (
    (s || "")
      .replace(/[\\/]+/g, "_")
      .replace(/\.\.+/g, "_")
      .replace(/[:*?"<>|]/g, "_")
      .replace(/^\.+/, "_")
      .trim()
      .slice(0, 120) || "_"
  );
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const outputDir = q.get("outputDir") ?? "";
  const rootName = q.get("rootName") ?? "";
  const runId = q.get("runId") ?? "";
  const index = q.get("index") ?? "";
  const name = q.get("name") ?? "";
  if (!outputDir || !rootName || !runId || !index || !name) {
    return NextResponse.json({ error: "필수 파라미터 누락" }, { status: 400 });
  }

  const base = path.resolve(process.cwd(), outputDir);
  const filePath = path.join(
    base,
    sanitizeSegment(rootName),
    sanitizeSegment(runId),
    sanitizeSegment(index),
    "images",
    sanitizeSegment(name),
  );
  // Defense in depth: ensure we never escaped the output base.
  if (!filePath.startsWith(base)) {
    return NextResponse.json({ error: "잘못된 경로" }, { status: 400 });
  }

  try {
    const buf = await readFile(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const body = new Uint8Array(buf);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": MIME[ext] ?? "application/octet-stream",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
  }
}

export const runtime = "nodejs";
