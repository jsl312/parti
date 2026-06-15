import { NextRequest, NextResponse } from "next/server";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * List all batch-generated concepts for a project by scanning
 * <outputDir>/<rootName>/<runId>/<NNN>/concept.json. Disk is the source of
 * truth, so the in-app viewer never bloats browser storage.
 */

type Body = { outputDir: string; rootName: string };

function sanitizeSegment(s: string): string {
  return (
    (s || "")
      .replace(/[\\/]+/g, "_")
      .replace(/\.\.+/g, "_")
      .replace(/[:*?"<>|]/g, "_")
      .replace(/^\.+/, "_")
      .trim()
      .slice(0, 100) || "project"
  );
}

type ConceptRecord = {
  runId: string;
  index: number;
  createdAt?: string;
  concept: unknown;
  prompts?: { role: string; prompt: string }[];
  images?: string[];
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.outputDir || !body.rootName) {
    return NextResponse.json(
      { error: "outputDir, rootName 필드가 필요합니다." },
      { status: 400 },
    );
  }

  const base = path.resolve(process.cwd(), body.outputDir);
  const root = path.join(base, sanitizeSegment(body.rootName));

  const items: ConceptRecord[] = [];
  try {
    const runs = await readdir(root, { withFileTypes: true });
    for (const run of runs) {
      if (!run.isDirectory()) continue;
      const runDir = path.join(root, run.name);
      const indices = await readdir(runDir, { withFileTypes: true });
      for (const idx of indices) {
        if (!idx.isDirectory()) continue;
        const jsonPath = path.join(runDir, idx.name, "concept.json");
        try {
          await stat(jsonPath);
          const raw = await readFile(jsonPath, "utf8");
          const rec = JSON.parse(raw) as ConceptRecord;
          items.push({ ...rec, runId: rec.runId ?? run.name });
        } catch {
          // no concept.json in this folder — skip
        }
      }
    }
  } catch {
    // root folder doesn't exist yet → empty list
    return NextResponse.json({ items: [], rootExists: false });
  }

  // Newest run first, then by index ascending.
  items.sort((a, b) => {
    if (a.runId !== b.runId) return a.runId < b.runId ? 1 : -1;
    return (a.index ?? 0) - (b.index ?? 0);
  });

  return NextResponse.json({ items, rootExists: true });
}

export const runtime = "nodejs";
