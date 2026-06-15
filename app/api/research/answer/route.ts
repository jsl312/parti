import { NextRequest, NextResponse } from "next/server";
import { ProviderConfig } from "@/lib/types/settings";
import { Language } from "@/lib/types/project";
import { LlmError } from "@/lib/types/llm";
import { complete } from "@/lib/llm/router";
import {
  tavilySearch,
  dedupeByUrl,
  TavilyError,
  TavilyResult,
} from "@/lib/web/tavily";

/**
 * Run a research / precedent-search prompt through the CONFIGURED LLM and
 * return the answer as plain text — so the user can auto-fill the "paste
 * result" boxes instead of going to an external AI by hand.
 *
 * Two modes:
 *  - KNOWLEDGE (default): the model answers from its own knowledge (no web).
 *    The system prompt asks it to flag uncertain facts (추정/미확인).
 *  - WEB (when `webSearch.apiKey` is given): the server first runs the prompt
 *    through Tavily live web search, then feeds the gathered sources to the
 *    local model and asks it to answer ONLY from those sources, citing [n].
 *
 * Either way the output flows into the existing [1차]/[2차]/[미확인] confidence
 * funnel, which already expects verification.
 */

type Body = {
  provider: ProviderConfig;
  language: Language;
  prompt: string;
  kind?: "research" | "precedents";
  /** When present + apiKey set, do live web search first. */
  webSearch?: { apiKey: string; maxResults?: number };
};

// ─── System prompts ────────────────────────────────────────────────────────

function buildKnowledgeSystem(language: Language, kind?: string): string {
  const lang = language === "en" ? "English" : "Korean";
  const base = `You are a meticulous research assistant for an architectural pre-design brief. Answer the user's research prompt as fully and concretely as possible, written IN ${lang}. Follow whatever structure, sections, or table format the prompt asks for.
- When you state a specific statistic, date, figure, proper name, or factual claim, include its source; add a URL when you know one.
- You are answering from your OWN KNOWLEDGE without live web access. If you are not confident a fact is accurate or current, explicitly mark it (추정) or (미확인) instead of presenting it as established fact. NEVER fabricate sources, URLs, or precise numbers.`;
  if (kind === "precedents") {
    return `${base}

This is a PRECEDENT search. List real, built architectural precedents. For each give: 프로젝트명 · 건축가/사무소 · 완공 연도 · 위치 · 핵심 공간 전략 · 본 프로젝트와의 연관성 · 출처 URL. If you are unsure whether a project actually exists, say so rather than inventing it.`;
  }
  return base;
}

function buildWebSystem(language: Language, kind?: string): string {
  const lang = language === "en" ? "English" : "Korean";
  const base = `You are a meticulous research assistant for an architectural pre-design brief. You are given the user's research prompt AND a numbered list of WEB SOURCES retrieved by live search. Answer the prompt as fully and concretely as possible, written IN ${lang}, following whatever structure/table format the prompt asks for.
- Base your answer ONLY on the provided sources. After each specific fact (statistic, date, figure, proper name, claim), cite the source number(s) like [1] or [2][3].
- If the sources do not cover part of the prompt, say so explicitly (자료 부족) instead of filling it from memory. NEVER fabricate facts, numbers, or URLs that are not in the sources.
- Prefer the most recent and authoritative sources when they disagree, and note the disagreement.`;
  if (kind === "precedents") {
    return `${base}

This is a PRECEDENT search. List only real, built architectural precedents that appear in the sources. For each give: 프로젝트명 · 건축가/사무소 · 완공 연도 · 위치 · 핵심 공간 전략 · 본 프로젝트와의 연관성 · 출처 번호([n]).`;
  }
  return base;
}

// ─── Web search helpers ────────────────────────────────────────────────────

/**
 * Turn a (possibly long, instruction-laden) research prompt into 1–3 concise
 * web search queries. Uses a cheap plain-text model call; falls back to a
 * truncated version of the prompt if parsing fails.
 */
async function deriveQueries(
  provider: ProviderConfig,
  prompt: string,
  language: Language,
): Promise<string[]> {
  const fallback = [prompt.replace(/\s+/g, " ").trim().slice(0, 200)];
  try {
    const res = await complete(provider, {
      system: `You convert a research request into web search queries. Output ONLY the queries, one per line, no numbering, no commentary. Give 1–3 short keyword-style queries (each under 15 words) that would surface the facts the request needs. Use the same language as the request (${language === "en" ? "English" : "Korean"}); add an English variant if it would find better sources.`,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      maxTokens: 256,
    });
    const lines = (res.text ?? "")
      .split("\n")
      .map((l) => l.replace(/^[\s\-*0-9.)]+/, "").trim())
      .filter((l) => l.length >= 3 && l.length <= 160)
      .slice(0, 3);
    return lines.length > 0 ? lines : fallback;
  } catch {
    return fallback;
  }
}

function renderSourcesBlock(sources: TavilyResult[]): string {
  return sources
    .map((s, i) => {
      const snippet = s.content.slice(0, 1200);
      return `[${i + 1}] ${s.title || s.url}\nURL: ${s.url}\n${snippet}`;
    })
    .join("\n\n");
}

function renderSourcesList(sources: TavilyResult[]): string {
  const lines = sources.map(
    (s, i) => `[${i + 1}] ${s.title || s.url} — ${s.url}`,
  );
  return `\n\n---\n참고한 웹 출처 (Tavily 라이브 검색):\n${lines.join("\n")}`;
}

// ─── Route ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.provider || !body.prompt?.trim()) {
    return NextResponse.json(
      { error: "provider, prompt 필드가 필요합니다." },
      { status: 400 },
    );
  }

  const useWeb = !!body.webSearch?.apiKey?.trim();

  try {
    // ── WEB mode: gather sources first ──────────────────────────────────
    let sources: TavilyResult[] = [];
    if (useWeb) {
      const queries = await deriveQueries(
        body.provider,
        body.prompt,
        body.language,
      );
      const perQuery = Math.max(
        2,
        Math.ceil((body.webSearch!.maxResults ?? 5) / queries.length),
      );
      const batches = await Promise.all(
        queries.map((q) =>
          tavilySearch({
            apiKey: body.webSearch!.apiKey,
            query: q,
            maxResults: perQuery,
            searchDepth: "advanced",
          }).catch((e) => {
            // One failing query shouldn't sink the whole run; surface auth/quota.
            if (
              e instanceof TavilyError &&
              (e.status === 401 || e.status === 429)
            ) {
              throw e;
            }
            return [] as TavilyResult[];
          }),
        ),
      );
      sources = dedupeByUrl(batches.flat()).slice(
        0,
        body.webSearch!.maxResults ?? 5,
      );
      if (sources.length === 0) {
        return NextResponse.json(
          {
            error:
              "웹 검색에서 사용할 만한 출처를 찾지 못했습니다. 프롬프트를 더 구체화하거나, 웹 검색을 끄고 모델 지식 기반으로 시도해 보세요.",
          },
          { status: 502 },
        );
      }
    }

    const system = useWeb
      ? buildWebSystem(body.language, body.kind)
      : buildKnowledgeSystem(body.language, body.kind);

    const userContent = useWeb
      ? `# 연구 요청\n${body.prompt}\n\n# 웹 출처\n${renderSourcesBlock(sources)}`
      : body.prompt;

    const res = await complete(body.provider, {
      system,
      messages: [{ role: "user", content: userContent }],
      temperature: useWeb ? 0.3 : 0.4,
      maxTokens: 4096,
    });
    let text = (res.text ?? "").trim();
    if (!text) {
      return NextResponse.json(
        {
          error:
            "모델이 빈 응답을 반환했습니다. 다시 시도하거나 다른 모델로 전환해 주세요.",
        },
        { status: 502 },
      );
    }
    if (useWeb) text += renderSourcesList(sources);

    return NextResponse.json({ text, mode: useWeb ? "web" : "knowledge" });
  } catch (e) {
    if (e instanceof TavilyError) {
      return NextResponse.json(
        { error: e.message },
        { status: e.status === 401 ? 401 : 502 },
      );
    }
    if (e instanceof LlmError) {
      return NextResponse.json(
        { error: e.message, kind: e.kind },
        { status: e.kind === "auth" ? 401 : 502 },
      );
    }
    return NextResponse.json(
      { error: (e as Error).message || "알 수 없는 오류" },
      { status: 500 },
    );
  }
}

export const runtime = "nodejs";
export const maxDuration = 600;
