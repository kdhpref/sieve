// 브랜드 담당자용 조회 화면의 집계. 세 계열(소비자 제출 자기보고 / 추천 요청의 Claude 웹 검색 후보 / Claude API 테스트)을
// 합산하지 않고 각각 따로 돌려준다(착수 문서 5장). 외부 데이터는 미연결이면 0이 아니라 "데이터 없음"으로 표시한다.
import { computeStats, researchWhere } from "../interview/stats.mjs";
import { slotDef } from "../codebook.mjs";
import { INTENTS } from "../recommend/query.mjs";
import { cleanUrl } from "../recommend/service.mjs";

const BOUGHT = new Set(["out_bought_ai_candidate", "out_bought_other"]);
const NOT_BOUGHT = new Set(["out_not_bought", "out_undecided"]);
const RECENT_LIMIT = 12;

// 연결 후보 외부 소스(착수 문서 6장). 고객 제공 파일·계약이 없으므로 모두 미연결이다.
export const EXTERNAL_SOURCES = [
  { source: "google_search_console", label: "Google Search Console", value: "생성형 AI 기능에 나타난 사이트 URL 노출", status: "not_connected", how: "소유 사이트의 공식 내보내기 CSV(P1)" },
  { source: "bing_webmaster", label: "Bing Webmaster Tools", value: "Copilot·Bing의 URL 인용", status: "not_connected", how: "고객 제공 파일(P1)" },
  { source: "ga4_clarity", label: "GA4 / Clarity", value: "AI 유입 세션과 전환", status: "not_connected", how: "고객 제공 집계(P1)" },
  { source: "affiliate", label: "제휴 판매처 정산", value: "제휴 링크 경유 구매·취소·반품", status: "not_connected", how: "제휴 계약 확보 후(P2)" },
];

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
const countBy = (rows, key) => rows.reduce((acc, r) => ((acc[r[key]] = (acc[r[key]] ?? 0) + 1), acc), {});

const labelOf = (o, lang) => o[lang] ?? o.ko ?? o.en ?? o.code;

function intentLabels(lang) {
  const labels = {};
  for (const o of slotDef("concern_codes").options) if (o.intent_id) (labels[o.intent_id] ??= []).push(labelOf(o, lang));
  return labels;
}

/** 결정 이유를 구매/미구매로 나눠 센다. 분모는 그 그룹에서 reason_codes를 질문받은 사람. */
export function reasonsByOutcome(store, opts) {
  const lang = opts.lang ?? "ko";
  const w = researchWhere(opts);
  const rows = store.db.prepare(`SELECT v.interview_id, v.slot, v.value_code, v.status, v.review_required
    FROM interview_values v JOIN interviews i ON i.id = v.interview_id WHERE ${w.where} AND v.slot IN ('outcome', 'reason_codes')`).all(...w.params);
  const per = new Map();
  for (const r of rows) {
    const e = per.get(r.interview_id) ?? { outcome: null, asked: false, reasons: new Set(), pending: new Set() };
    if (r.slot === "outcome" && r.status === "answered" && r.value_code && !r.review_required) e.outcome = r.value_code;
    if (r.slot === "reason_codes") {
      if (r.status === "answered" || r.status === "skipped") e.asked = true;
      if (r.value_code) (r.review_required ? e.pending : e.reasons).add(r.value_code);
    }
    per.set(r.interview_id, e);
  }
  const group = (set) => [...per.values()].filter((e) => e.asked && set.has(e.outcome));
  const bought = group(BOUGHT);
  const notBought = group(NOT_BOUGHT);
  const codes = slotDef("reason_codes").options.map((o) => ({
    code: o.code, label: labelOf(o, lang),
    n_bought: bought.filter((e) => e.reasons.has(o.code)).length,
    n_not_bought: notBought.filter((e) => e.reasons.has(o.code)).length,
    n_pending: [...bought, ...notBought].filter((e) => e.pending.has(o.code)).length,
  }));
  return { asked_bought: bought.length, asked_not_bought: notBought.length, codes };
}

/** 추천 요청 계열: Claude 웹 검색 결과에서 검증을 통과한 후보에 등장한 브랜드·출처. 브랜드명은 답변 표기 그대로다(제품 키 매핑 전). */
export function recommendSeries(store, { internal = true, category = null } = {}) {
  const has = store.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'recommendations'").get();
  const empty = { requests: { total: 0, done: 0, failed: 0, active: 0, by_failure: {}, by_country: {} }, period: null, cost_usd: 0, brands: [], sources: [], recent: [] };
  if (!has) return empty;
  const where = ["r.is_internal_test = ?"];
  const params = [internal ? 1 : 0];
  if (category) { where.push("i.product_category = ?"); params.push(category); }
  const rows = store.db.prepare(`SELECT r.*, i.product_category FROM recommendations r JOIN interviews i ON i.id = r.interview_id
    WHERE ${where.join(" AND ")} ORDER BY r.created_at DESC`).all(...params);
  if (!rows.length) return empty;

  const done = rows.filter((r) => r.status === "done");
  const failed = rows.filter((r) => r.status === "failed");
  const brands = new Map();
  const hosts = {};
  for (const r of [...done].reverse()) { // 오래된 것부터: 처음 본 표기를 대표 이름으로 쓴다
    const seenHosts = new Set();
    for (const c of parse(r.candidates_json, [])) {
      const name = (c.brand ?? "").trim() || "(브랜드 미표기)";
      const key = name.normalize("NFC").replace(/\s+/g, "").toLowerCase();
      const b = brands.get(key) ?? { brand: name, n_candidates: 0, requests: new Set(), n_first: 0, n_price: 0, n_buy: 0, products: new Set() };
      b.n_candidates++;
      b.requests.add(r.id);
      if ((c.explicit_rank ?? c.position) === 1) b.n_first++;
      if (c.price) b.n_price++;
      if (c.buy?.url) b.n_buy++;
      b.products.add(c.product_name);
      brands.set(key, b);
      for (const s of c.sources ?? []) { const h = host(s.url); if (h) seenHosts.add(h); }
      if (c.buy?.url) { const h = host(c.buy.url); if (h) seenHosts.add(h); }
    }
    for (const h of seenHosts) hosts[h] = (hosts[h] ?? 0) + 1;
  }
  const dates = rows.map((r) => r.created_at).sort();
  return {
    requests: {
      total: rows.length, done: done.length, failed: failed.length, active: rows.length - done.length - failed.length,
      by_failure: countBy(failed, "failure"), by_country: countBy(rows, "search_country"),
    },
    period: { from: dates[0], to: dates.at(-1) },
    cost_usd: Number(rows.reduce((s, r) => s + (r.cost_usd ?? 0), 0).toFixed(4)),
    brands: [...brands.values()].map((b) => ({
      brand: b.brand, n_candidates: b.n_candidates, n_requests: b.requests.size, pct_requests: pct(b.requests.size, done.length),
      n_first: b.n_first, n_price: b.n_price, n_buy: b.n_buy, products: [...b.products].slice(0, 4),
    })).sort((a, b) => b.n_requests - a.n_requests || b.n_candidates - a.n_candidates || a.brand.localeCompare(b.brand)),
    sources: Object.entries(hosts).map(([h, n]) => ({ host: h, n })).sort((a, b) => b.n - a.n).slice(0, 12),
    recent: rows.slice(0, RECENT_LIMIT).map((r) => ({
      id: r.id, created_at: r.created_at, status: r.status, failure: r.failure, lang: r.lang, search_country: r.search_country,
      intent_id: r.intent_id, product_category: r.product_category, question_text: r.question_text, model_id: r.model_id,
      search_used: r.search_used == null ? null : Boolean(r.search_used), review_count: parse(r.review_json, []).length,
      conditions: parse(r.conditions_json, []).map((c) => c.label),
      candidates: r.status === "done" ? parse(r.candidates_json, []).map((c) => ({
        position: c.position, explicit_rank: c.explicit_rank ?? null, brand: c.brand ?? null, product_name: c.product_name,
        price_text: c.price?.text ?? null, seller: c.price?.seller ?? null,
        buy_url: c.buy?.url ? cleanUrl(c.buy.url) : null, sources: (c.sources ?? []).map((s) => ({ url: s.url, title: s.title ?? null })),
      })) : [],
    })),
  };
}

export function createBrandService({ store, apiTest = null }) {
  return {
    overview({ internal = true, category = null, lang = "ko" } = {}) {
      const w = researchWhere({ internal });
      const categories = store.db.prepare(`SELECT i.product_category AS code, COUNT(*) AS started, SUM(i.pre_locked_at IS NOT NULL) AS locked
        FROM interviews i WHERE ${w.where} GROUP BY 1 ORDER BY locked DESC, started DESC`).all(...w.params);
      const consumer = computeStats(store, { internal, category, lang });
      const labels = intentLabels(lang);
      return {
        generated_at: new Date().toISOString(),
        filters: { dataset: internal ? "internal_test" : "real", category, lang },
        categories,
        consumer: {
          ...consumer,
          intents: consumer.intents.map((r) => ({
            ...r, labels: labels[r.intent_id] ?? [],
            question_ko: INTENTS[r.intent_id]?.ko ?? null, question_en: INTENTS[r.intent_id]?.en ?? null,
          })),
          reasons_by_outcome: reasonsByOutcome(store, { internal, category, lang }),
        },
        recommend: recommendSeries(store, { internal, category }),
        api_test: apiTest ? apiTest.overview({ category }) : { status: "not_connected", note: "API 테스트 결과 파일(data/sieve.db)이 이 서버에 없어요. 저장된 실행 결과가 있는 환경에서만 보여요." },
        external: EXTERNAL_SOURCES,
      };
    },
    apiTestResponse(id) {
      return apiTest ? apiTest.response(id) : null;
    },
  };
}
