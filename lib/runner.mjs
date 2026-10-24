// 수집 작업 실행기. 웹 요청은 run_id만 즉시 받고, 수집은 서버 프로세스 안에서 비동기로 진행한다.
// 동시에 하나만 실행해 버튼 중복 클릭으로 수집이 중복되지 않게 한다.
import { createHash, randomUUID } from "node:crypto";
import { QUESTION, SETTINGS } from "./config.mjs";
import { collect, hasApiKey } from "./providers/claude.mjs";
import { parseCollected } from "./extraction/parse.mjs";
import { analyze } from "./extraction/analyze.mjs";
import { saveRun } from "./store.mjs";

// 계산 예시 단가(USD). 실제 청구액이 아닌 추정치로만 표시한다.
const PRICE = { input_per_mtok: 2, output_per_mtok: 10, search_per_1k: 10 };

let active = null;

export function activeRunId() {
  return active;
}

function estimateCost(...usages) {
  let input = 0, output = 0, searches = 0;
  for (const u of usages) {
    if (!u) continue;
    input += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    output += u.output_tokens || 0;
    searches += u.server_tool_use?.web_search_requests || 0;
  }
  const usd = (input / 1e6) * PRICE.input_per_mtok + (output / 1e6) * PRICE.output_per_mtok + (searches / 1000) * PRICE.search_per_1k;
  return { input_tokens: input, output_tokens: output, web_searches: searches, usd: Math.round(usd * 10000) / 10000, basis: PRICE };
}

export async function startRun() {
  if (!hasApiKey()) return { error: "ANTHROPIC_API_KEY가 서버 환경변수에 없습니다.", status: 400 };
  if (active) return { run_id: active, status: 409, error: "이미 실행 중인 수집이 있습니다." };

  const run = {
    run_id: `run-${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}-${randomUUID().slice(0, 6)}`,
    data_kind: "api",
    status: "running",
    created_at: new Date().toISOString(),
    question: QUESTION,
    settings: SETTINGS,
  };
  active = run.run_id;
  await saveRun(run);
  execute(run).finally(() => {
    active = null;
  });
  return { run_id: run.run_id, status: 202 };
}

async function execute(run) {
  try {
    const c = await collect(QUESTION.text);
    const rawJson = JSON.stringify(c.raw_responses);
    run.collection = {
      collected_at: new Date().toISOString(),
      model_id: c.model_id,
      stop_reason: c.stop_reason,
      stop_details: c.stop_details,
      latency_ms: c.latency_ms,
      usage: c.usage,
      sha256: createHash("sha256").update(rawJson).digest("hex"),
      raw_responses: c.raw_responses,
    };
    if (c.stop_reason === "refusal") throw new Error("모델이 응답을 거절했습니다(refusal).");
    run.parsed = parseCollected(c.content);
    run.cost_estimate = estimateCost(c.usage);
    await saveRun(run);

    // 원본 수집과 분석을 분리: 분석이 실패해도 원문·citation은 남는다.
    try {
      const a = await analyze(run.parsed);
      run.analysis = { status: "succeeded", products: a.products, usage: a.usage };
      run.cost_estimate = estimateCost(c.usage, a.usage);
    } catch (err) {
      run.analysis = { status: "failed", error: String(err.message || err), products: [] };
    }
    run.status = c.stop_reason === "max_tokens" ? "partial" : "succeeded";
  } catch (err) {
    run.status = "failed";
    run.error = { message: String(err.message || err), type: err.type ?? null, http_status: err.status ?? null };
  }
  run.finished_at = new Date().toISOString();
  await saveRun(run);
}
