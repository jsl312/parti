/**
 * Robust JSON extraction from LLM text output.
 *
 * Handles:
 *  - Plain JSON
 *  - Markdown fenced JSON (```json ... ``` or ``` ... ```)
 *  - JSON with leading/trailing prose by locating outermost { ... } or [ ... ]
 *
 * Returns parsed JSON or throws SyntaxError with a snippet for debugging.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  // Strip surrounding markdown code fence if present
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  // Try direct parse
  try {
    return JSON.parse(candidate);
  } catch {
    // fall through
  }

  // Locate outermost JSON object or array
  const firstObj = candidate.indexOf("{");
  const firstArr = candidate.indexOf("[");
  const start =
    firstObj === -1
      ? firstArr
      : firstArr === -1
        ? firstObj
        : Math.min(firstObj, firstArr);
  if (start === -1) {
    throw new SyntaxError(
      `JSON 시작 토큰이 없습니다. raw: ${snippet(candidate)}`,
    );
  }

  const open = candidate[start];
  const close = open === "{" ? "}" : "]";
  // Walk to find matching close (naive — assumes no unescaped braces in strings;
  // good enough for LLM output that's mostly well-formed JSON)
  let depth = 0;
  let inStr = false;
  let escape = false;
  let end = -1;
  for (let i = start; i < candidate.length; i++) {
    const c = candidate[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    throw new SyntaxError(
      `JSON 닫는 토큰을 찾지 못했습니다. raw: ${snippet(candidate)}`,
    );
  }

  const slice = candidate.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (e) {
    throw new SyntaxError(
      `JSON 파싱 실패: ${(e as Error).message}. raw: ${snippet(slice)}`,
    );
  }
}

function snippet(s: string, n = 300): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…(+${s.length - n} chars)`;
}
