// Claude Messages API 호출. npm 레지스트리 접근이 막혀 SDK 대신 fetch로 직접 호출한다.
// ANTHROPIC_API_KEY는 서버 환경변수로만 읽고 로그·응답에 절대 포함하지 않는다.
import { COLLECT_SYSTEM, SETTINGS } from "../config.mjs";

const API_URL = "https://api.anthropic.com/v1/messages";

export class ClaudeError extends Error {
  constructor(message, { status, type, retryable } = {}) {
    super(message);
    this.status = status;
    this.type = type;
    this.retryable = Boolean(retryable);
  }
}

export function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

async function postMessages(body, { betas = [] } = {}) {
  const headers = {
    "content-type": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
  };
  if (betas.length) headers["anthropic-beta"] = betas.join(",");

  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SETTINGS.request_timeout_ms),
      });
    } catch (err) {
      if (attempt < 2) continue; // 네트워크·타임아웃 일시 오류는 최대 2회 재시도
      throw new ClaudeError(`network: ${err.name}`, { type: "network", retryable: true });
    }
    if (res.ok) return res.json();

    const payload = await res.json().catch(() => ({}));
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < 2) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, (retryAfter > 0 ? retryAfter : 2 ** attempt * 2) * 1000));
      continue;
    }
    throw new ClaudeError(payload?.error?.message || `HTTP ${res.status}`, {
      status: res.status,
      type: payload?.error?.type,
      retryable,
    });
  }
}

function addUsage(total, usage = {}) {
  for (const [k, v] of Object.entries(usage)) {
    if (typeof v === "number") total[k] = (total[k] || 0) + v;
    else if (k === "server_tool_use" && v) {
      total.server_tool_use ??= {};
      for (const [sk, sv] of Object.entries(v)) {
        if (typeof sv === "number") total.server_tool_use[sk] = (total.server_tool_use[sk] || 0) + sv;
      }
    }
  }
  return total;
}

/**
 * 고정 질문 1건을 웹 검색과 함께 수집한다.
 * pause_turn이면 원래 작업 안에서 제한 횟수만큼 이어가며, 모든 원본 응답과 usage를 보관한다.
 */
export async function collect(questionText) {
  const tool = {
    type: SETTINGS.web_search_tool,
    name: "web_search",
    max_uses: SETTINGS.max_uses,
    user_location: SETTINGS.user_location,
  };
  const messages = [{ role: "user", content: questionText }];
  const rawResponses = [];
  const content = [];
  const usage = {};
  const started = Date.now();
  let last;

  for (let i = 0; i <= SETTINGS.max_pause_continues; i++) {
    last = await postMessages(
      {
        model: SETTINGS.model,
        max_tokens: SETTINGS.max_tokens,
        system: COLLECT_SYSTEM,
        tools: [tool],
        messages,
        fallbacks: "default",
      },
      { betas: ["server-side-fallback-2026-07-01"] },
    );
    rawResponses.push(last);
    content.push(...last.content);
    addUsage(usage, last.usage);
    if (last.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: last.content });
  }

  return {
    raw_responses: rawResponses,
    content,
    usage,
    stop_reason: last.stop_reason,
    stop_details: last.stop_details ?? null,
    model_id: last.model,
    latency_ms: Date.now() - started,
  };
}

/** 구조화 출력(JSON schema)으로 분석 호출. 응답 텍스트는 데이터로만 취급한다. */
export async function analyzeJson({ system, user, schema, maxTokens = 4000 }) {
  const res = await postMessages({
    model: SETTINGS.model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: { type: "json_schema", schema } },
  });
  if (res.stop_reason === "refusal") throw new ClaudeError("analysis refused", { type: "refusal" });
  if (res.stop_reason === "max_tokens") throw new ClaudeError("analysis truncated", { type: "max_tokens" });
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { json: JSON.parse(text), usage: res.usage, raw: res };
}
