/**
 * Tavily live web search (server-side only).
 *
 * Used to ground 자동 조사 in real web sources before the local model
 * synthesizes an answer. Tavily is purpose-built for LLM retrieval: one call
 * returns ranked results with relevant text snippets so we don't have to fetch
 * and scrape pages ourselves.
 *
 * Docs: https://docs.tavily.com/  — POST https://api.tavily.com/search
 */

export type TavilyResult = {
  title: string;
  url: string;
  /** Tavily-extracted relevant snippet for the query. */
  content: string;
  score?: number;
};

export type TavilySearchOptions = {
  apiKey: string;
  query: string;
  /** 1–10. Defaults to 5. */
  maxResults?: number;
  /** "basic" (fast) or "advanced" (deeper, better for research). */
  searchDepth?: "basic" | "advanced";
  signal?: AbortSignal;
};

const ENDPOINT = "https://api.tavily.com/search";

export class TavilyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TavilyError";
  }
}

export async function tavilySearch(
  opts: TavilySearchOptions,
): Promise<TavilyResult[]> {
  const apiKey = opts.apiKey?.trim();
  if (!apiKey) throw new TavilyError("Tavily API 키가 비어 있습니다.");
  const query = opts.query.trim().slice(0, 380); // Tavily caps query length
  if (!query) return [];

  const maxResults = Math.max(1, Math.min(opts.maxResults ?? 5, 10));

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: maxResults,
        search_depth: opts.searchDepth ?? "advanced",
        include_answer: false,
        include_raw_content: false,
      }),
      signal: opts.signal,
    });
  } catch (e) {
    throw new TavilyError(
      `Tavily 요청 실패 (네트워크): ${(e as Error).message}`,
    );
  }

  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: string; detail?: string };
      detail = j.error || j.detail || "";
    } catch {
      /* ignore */
    }
    if (res.status === 401) {
      throw new TavilyError(
        "Tavily 인증 실패 (401). API 키를 확인하세요.",
        401,
      );
    }
    if (res.status === 429) {
      throw new TavilyError(
        "Tavily 사용량 한도 초과 (429). 잠시 후 다시 시도하세요.",
        429,
      );
    }
    throw new TavilyError(
      `Tavily 오류 ${res.status}${detail ? `: ${detail}` : ""}`,
      res.status,
    );
  }

  const data = (await res.json()) as { results?: TavilyResult[] };
  return (data.results ?? [])
    .filter((r) => r.url && (r.content || r.title))
    .map((r) => ({
      title: (r.title ?? "").trim(),
      url: r.url,
      content: (r.content ?? "").trim(),
      score: r.score,
    }));
}

/**
 * De-duplicate by URL, preserving first (highest-ranked) occurrence.
 */
export function dedupeByUrl(results: TavilyResult[]): TavilyResult[] {
  const seen = new Set<string>();
  const out: TavilyResult[] = [];
  for (const r of results) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
  }
  return out;
}
