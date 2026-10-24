// 제품 추천 받기(recommendation-spec.md): 확정 조건 → 질문 조립 → Claude 웹 검색 수집 → 분석 → 코드 검증 → 사진 찾기.
// POST는 작업을 만들고 바로 돌려주며(202), 수집은 같은 프로세스 안에서 이어서 돈다. 화면은 GET으로 진행을 조회한다.
// 서버리스(Vercel)는 응답 뒤 함수가 멈추고 요청마다 인스턴스·/tmp DB가 다를 수 있어, 그때는 POST 안에서 끝까지 기다린다.
// 원본 응답과 sha256은 불변 저장하고 판정(분석·검증 결과)은 따로 둔다. 조사 집계(interview_values)와 섞지 않는다.
import { createHash, randomBytes } from "node:crypto";
import { buildQuery } from "./query.mjs";
import { RECOMMEND_PROMPT_HASH } from "./claude.mjs";
import { findProductImage } from "./image.mjs";
import { HttpError } from "../interview/service.mjs";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL REFERENCES interviews(id),
  status TEXT NOT NULL,
  failure TEXT,
  question_text TEXT NOT NULL,
  intent_id TEXT,
  conditions_json TEXT NOT NULL,
  template_version TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  analysis_prompt_hash TEXT NOT NULL,
  model_id TEXT,
  search_country TEXT NOT NULL,
  lang TEXT NOT NULL,
  collected_at TEXT,
  raw_json TEXT,
  raw_sha256 TEXT,
  answer_text TEXT,
  citations_json TEXT,
  search_results_json TEXT,
  search_used INTEGER,
  analysis_raw_json TEXT,
  candidates_json TEXT,
  review_json TEXT,
  usage_json TEXT,
  cost_usd REAL,
  error TEXT,
  is_internal_test INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rec_interview ON recommendations(interview_id);
`;

// 착수 문서 10장: 누적 $50에서 새 작업 중지
const BUDGET_STOP_USD = 50;
const ACTIVE = new Set(["queued", "collecting", "analyzing"]);
const now = () => new Date().toISOString();
const newId = () => `rec-${now().replace(/\D/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;

// 추적·제휴 매개변수는 지운다(착수 문서 6장, 추천 화면에는 제휴 링크를 넣지 않는다). 제품 변형 값은 남긴다.
const TRACKING = /^(utm_.*|tag|ref|ref_|refsrc|aff.*|affiliate.*|irclickid|clickid|gclid|fbclid|msclkid|mc_.*|ascsubtag|linkcode|linkid|camp|creative|creativeasin|srsltid|spm|scm|_branch_match_id)$/i;
export function cleanUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!["http:", "https:"].includes(u.protocol)) return null;
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.pathname = u.pathname.replace(/\/ref=[^/]*$/i, "");
  u.hash = "";
  return u.href;
}

// 근거 문장 비교: 공백과 마크다운 강조 기호는 무시한다.
const norm = (s) => String(s ?? "").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const inAnswer = (answer, s) => Boolean(s) && norm(s).length > 0 && norm(answer).includes(norm(s));

/**
 * 분석 결과를 코드로 검증한다(명세 2.5). 통과한 후보만 화면에 나간다.
 * 가격·판매처·확인일은 원문에 그대로 있을 때만 붙이고, 아니면 그 칸만 비운다(근거 없는 가격 자동 완성 금지).
 */
export function verifyCandidates(data, parsed) {
  const answer = parsed.text;
  const cites = new Map(parsed.citations.map((c) => [c.id, c]));
  const shown = [];
  const review = [];
  for (const [i, c] of (Array.isArray(data?.candidates) ? data.candidates : []).entries()) {
    const reasons = [];
    if (!c || typeof c.product_name !== "string" || !c.product_name.trim()) reasons.push("no_product_name");
    if (!["recommended", "discouraged", "neutral", "uncertain"].includes(c?.mention_type)) reasons.push("bad_mention_type");
    else if (c.mention_type !== "recommended") reasons.push(`not_recommended:${c.mention_type}`);
    if (!inAnswer(answer, c?.reason_text)) reasons.push("reason_not_in_answer");
    const ids = Array.isArray(c?.citation_ids) ? c.citation_ids : [];
    if (ids.some((id) => !cites.has(id))) reasons.push("unknown_citation_id");
    if (c?.buy_citation_id != null && !cites.has(c.buy_citation_id)) reasons.push("unknown_buy_citation_id");
    if (reasons.length) { review.push({ index: i, product_name: c?.product_name ?? null, reasons }); continue; }

    const notes = [];
    let price = null;
    if (c.price_text != null) {
      const amountOk = c.price_amount == null || (Number.isFinite(c.price_amount) && c.price_amount >= 0
        && norm(c.price_text).replace(/,/g, "").includes(String(c.price_amount).replace(/\.0+$/, "")));
      if (inAnswer(answer, c.price_text) && amountOk) {
        price = {
          text: c.price_text.trim(),
          amount: c.price_amount,
          currency: typeof c.currency === "string" && /^[A-Z]{3}$/.test(c.currency) ? c.currency : null,
          seller: inAnswer(answer, c.seller) ? c.seller.trim() : null,
          checked_date_text: inAnswer(answer, c.checked_date_text) ? c.checked_date_text.trim() : null,
        };
      } else notes.push("price_not_in_answer");
    }
    const buy = c.buy_citation_id ? cites.get(c.buy_citation_id) : null;
    shown.push({
      position: shown.length + 1,
      brand: inAnswer(answer, c.brand) ? c.brand.trim() : null,
      product_name: c.product_name.trim(),
      explicit_rank: Number.isInteger(c.explicit_rank) && c.explicit_rank > 0 ? c.explicit_rank : null,
      reason_text: c.reason_text.trim(),
      unverified_text: inAnswer(answer, c.unverified_text) ? c.unverified_text.trim() : null,
      price,
      buy: buy ? { url: cleanUrl(buy.url), title: buy.title, citation_id: buy.id } : null,
      sources: ids.map((id) => cites.get(id)).map((s) => ({ id: s.id, url: cleanUrl(s.url), title: s.title })).filter((s) => s.url),
      image: null,
      notes,
    });
  }
  return { shown, review };
}

export function createRecommendService({ store, claude, imageFinder = findProductImage, waitInRequest = Boolean(process.env.VERCEL) }) {
  const db = store.db;
  db.exec(SCHEMA);
  const running = new Map(); // id → Promise (테스트에서 완료를 기다릴 때 씀)

  const get = (id) => db.prepare("SELECT * FROM recommendations WHERE id = ?").get(id);
  const update = (id, fields) => {
    const f = { ...fields, updated_at: now() };
    const keys = Object.keys(f);
    db.prepare(`UPDATE recommendations SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => f[k] ?? null), id);
  };
  const spentUsd = () => {
    const a = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM recommendations").get().s;
    const b = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM llm_calls").get().s;
    return a + b;
  };

  function view(row) {
    const parse = (s, d) => (s ? JSON.parse(s) : d);
    return {
      id: row.id,
      interview_id: row.interview_id,
      status: row.status,
      failure: row.failure,
      error: row.error ? String(row.error).slice(0, 80) : null, // 원인 코드(예: http_400:invalid_request_error). 키·원문은 없음
      question_text: row.question_text,
      conditions: parse(row.conditions_json, []),
      candidates: row.status === "done" ? parse(row.candidates_json, []) : [],
      review_count: parse(row.review_json, []).length,
      answer_text: row.answer_text,
      sources: parse(row.citations_json, []).map((c) => ({ id: c.id, url: cleanUrl(c.url), title: c.title })).filter((c) => c.url),
      search_result_count: parse(row.search_results_json, []).length,
      collection: {
        collected_at: row.collected_at, model_id: row.model_id, search_country: row.search_country,
        search_used: row.search_used == null ? null : Boolean(row.search_used), template_version: row.template_version,
        prompt_hash: row.prompt_hash, tool: "web_search_20260209",
      },
      is_internal_test: Boolean(row.is_internal_test),
      created_at: row.created_at,
    };
  }

  async function run(id) {
    const row = get(id);
    const totalUsage = {};
    let cost = 0;
    const addCost = (r) => {
      cost += r.cost_usd ?? 0;
      for (const [k, v] of Object.entries(r.usage ?? {})) totalUsage[k] = (totalUsage[k] ?? 0) + v;
    };
    try {
      update(id, { status: "collecting" });
      const col = await claude.collect({ question: row.question_text, country: row.search_country });
      addCost(col);
      const raw = JSON.stringify(col.raws ?? []);
      update(id, {
        raw_json: raw, raw_sha256: createHash("sha256").update(raw).digest("hex"), model_id: col.model_id, collected_at: now(),
        usage_json: JSON.stringify(totalUsage), cost_usd: cost,
      });
      if (!col.ok && !col.parsed) {
        console.error("[recommend]", id, "collect failed:", col.error);
        return update(id, { status: "failed", failure: col.error === "timeout" ? "timeout" : "search_failed", error: col.error });
      }
      const parsed = col.parsed;
      update(id, {
        answer_text: parsed.text, citations_json: JSON.stringify(parsed.citations),
        search_results_json: JSON.stringify(parsed.search_results), search_used: parsed.search_used ? 1 : 0,
      });
      if (!col.ok) return update(id, { status: "failed", failure: "search_failed", error: col.error });
      if (!parsed.search_used) return update(id, { status: "failed", failure: "search_not_used" });
      if (parsed.search_errors && !parsed.search_results.length) return update(id, { status: "failed", failure: "search_failed", error: "web_search_tool_error" });

      update(id, { status: "analyzing" });
      const an = await claude.analyze({
        lang: row.lang, answer_text: parsed.text,
        citations: parsed.citations.map((c) => ({ id: c.id, url: c.url, title: c.title, cited_text: c.cited_texts[0] ?? null })),
      });
      addCost(an);
      update(id, { analysis_raw_json: JSON.stringify(an.raws ?? []), usage_json: JSON.stringify(totalUsage), cost_usd: cost });
      if (!an.ok) return update(id, { status: "failed", failure: "analysis_failed", error: an.error, review_json: JSON.stringify([{ reasons: [an.error] }]) });

      const { shown, review } = verifyCandidates(an.data, parsed);
      // 사진: 판매 페이지의 og:image. 못 찾으면 사진 없이 보여준다.
      await Promise.all(shown.map(async (c) => {
        if (!c.buy?.url) return;
        const img = await imageFinder(c.buy.url);
        if (img) c.image = { url: img, source_page: c.buy.url };
      }));
      update(id, {
        status: shown.length ? "done" : "failed", failure: shown.length ? null : "no_verified_candidates",
        candidates_json: JSON.stringify(shown), review_json: JSON.stringify(review),
      });
    } catch (err) {
      console.error("[recommend]", id, err.message);
      update(id, { status: "failed", failure: "error", error: String(err.message).slice(0, 200), usage_json: JSON.stringify(totalUsage), cost_usd: cost });
    }
  }

  return {
    /** 같은 인터뷰에 진행 중이거나 완료된 추천이 있으면 그것을 돌려준다(중복 요청 방지). 실패한 것만 다시 만든다. */
    async create({ interview_id } = {}) {
      const itv = typeof interview_id === "string" ? store.getInterview(interview_id) : null;
      if (!itv) throw new HttpError(404, "인터뷰를 찾을 수 없습니다");
      if (itv.mode !== "recommend") throw new HttpError(409, "추천 모드 인터뷰가 아닙니다");
      if (itv.stage !== "confirmed") throw new HttpError(409, "조건을 먼저 확정해 주세요");
      const existing = db.prepare("SELECT * FROM recommendations WHERE interview_id = ? AND status != 'failed' ORDER BY created_at DESC LIMIT 1").get(itv.id);
      if (existing) return { status: 200, body: view(existing) };
      if (!claude) throw new HttpError(503, "ANTHROPIC_API_KEY가 없어 웹 검색을 실행할 수 없습니다");
      if (spentUsd() >= BUDGET_STOP_USD) throw new HttpError(429, "데모 비용 한도에 도달해 새 검색을 멈췄습니다");

      const q = buildQuery(itv);
      const id = newId();
      const ts = now();
      db.prepare(`INSERT INTO recommendations (id, interview_id, status, question_text, intent_id, conditions_json, template_version, prompt_hash,
        analysis_prompt_hash, search_country, lang, is_internal_test, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, itv.id, "queued", q.question_text, q.intent_id, JSON.stringify(q.conditions), q.template_version, q.prompt_hash,
          RECOMMEND_PROMPT_HASH, q.search_country, itv.lang, itv.is_internal_test ? 1 : 0, ts, ts);
      const job = run(id).finally(() => running.delete(id));
      running.set(id, job);
      if (waitInRequest) {
        await job;
        return { status: 200, body: view(get(id)) };
      }
      return { status: 202, body: view(get(id)) };
    },

    get(id) {
      const row = typeof id === "string" ? get(id) : null;
      if (!row) throw new HttpError(404, "추천 기록을 찾을 수 없습니다");
      // 프로세스가 다시 시작되어 진행 중 작업이 사라졌으면 실패로 알린다(저장된 다른 응답으로 채우지 않음).
      if (ACTIVE.has(row.status) && !running.has(id)) {
        update(id, { status: "failed", failure: "interrupted" });
        return view(get(id));
      }
      return view(row);
    },

    /** 테스트용: 진행 중 작업 완료 대기 */
    settle(id) {
      return running.get(id) ?? Promise.resolve();
    },
  };
}
