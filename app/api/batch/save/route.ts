import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Write one batch run (concept + prompts + images) to disk as a numbered
 * folder under <outputDir>/<rootName>/<NNN>/. Self-hosted only (Node fs).
 */

type ImageIn = { name: string; dataUrl: string };
type Body = {
  outputDir: string;
  rootName: string;
  /** Per-run subfolder (timestamp) so re-runs never overwrite earlier folders. */
  runId: string;
  index: number;
  conceptMd: string;
  promptsMd: string;
  images: ImageIn[];
  /** Structured concept + prompts so the in-app viewer can read it back. */
  concept?: unknown;
  prompts?: { role: string; prompt: string }[];
};

/** Strip anything that could escape the target folder. */
function sanitizeSegment(s: string): string {
  return (s || "")
    .replace(/[\\/]+/g, "_")
    .replace(/\.\.+/g, "_")
    .replace(/[:*?"<>|]/g, "_")
    .replace(/^\.+/, "_")
    .trim()
    .slice(0, 100) || "project";
}

function dataUrlToBuffer(dataUrl: string): { buf: Buffer; ext: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1];
  const ext = mime.split("/")[1]?.replace("+xml", "") || "png";
  return { buf: Buffer.from(match[2], "base64"), ext };
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.outputDir || !body.rootName || !body.runId || !body.index) {
    return NextResponse.json(
      { error: "outputDir, rootName, runId, index 필드가 필요합니다." },
      { status: 400 },
    );
  }

  try {
    const base = path.resolve(process.cwd(), body.outputDir);
    const root = path.join(
      base,
      sanitizeSegment(body.rootName),
      sanitizeSegment(body.runId),
    );
    const idx = String(body.index).padStart(3, "0");
    const runDir = path.join(root, idx);
    const imagesDir = path.join(runDir, "images");
    await mkdir(imagesDir, { recursive: true });

    await writeFile(
      path.join(runDir, "concept.md"),
      body.conceptMd ?? "",
      "utf8",
    );
    await writeFile(
      path.join(runDir, "prompts.md"),
      body.promptsMd ?? "",
      "utf8",
    );

    const writtenNames: string[] = [];
    for (const img of body.images ?? []) {
      const decoded = dataUrlToBuffer(img.dataUrl);
      if (!decoded) continue;
      const safeName = sanitizeSegment(
        img.name.replace(/\.[a-z0-9]+$/i, ""),
      );
      const fileName = `${safeName}.${decoded.ext}`;
      await writeFile(path.join(imagesDir, fileName), decoded.buf);
      writtenNames.push(fileName);
    }

    // Structured record so the in-app viewer (/api/batch/list) can read it back.
    const record = {
      runId: body.runId,
      index: body.index,
      createdAt: new Date().toISOString(),
      concept: body.concept ?? null,
      prompts: body.prompts ?? [],
      images: writtenNames,
    };
    await writeFile(
      path.join(runDir, "concept.json"),
      JSON.stringify(record, null, 2),
      "utf8",
    );

    return NextResponse.json({ dir: runDir, imagesWritten: writtenNames.length });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json(
      { error: err.message || "파일 저장 실패" },
      { status: 500 },
    );
  }
}

export const runtime = "nodejs";
export const maxDuration = 600;
