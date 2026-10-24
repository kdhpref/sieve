// 브랜드 조회 화면 집계 테스트. Claude·외부 DB는 가짜로 대체한다(실제 호출 없음).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openStore } from "../lib/interview/store.mjs";
import { createInterviewService } from "../lib/interview/service.mjs";
import { createRecommendService } from "../lib/recommend/service.mjs";
import { computeStats, evidenceFor } from "../lib/interview/stats.mjs";
import { createBrandService, reasonsByOutcome, recommendSeries } from "../lib/brand/overview.mjs";
import { createApiTestReader } from "../lib/brand/apitest.mjs";

const fakeClaude = () => ({
  model: "fake-model",
  async call(_purpose, input) {
    return { ok: true, data: { slot: input.next_slot.key, text: `${input.next_slot.key} 질문이에요?` }, raw: {}, usage: {}, cost_usd: 0.001, model_id: "fake-model", latency_ms: 1, stop_reason: "end_turn", error: null };
  },
});

// 보기 첫 번째로 끝까지 답한다. overrides로 슬롯별 답 지정.
async function answerAll(service, view, overrides = {}) {
  let v = view;
  for (let i = 0; v.question && i < 40; i++) {
    const q = v.question;
    const o = overrides[q.slot];
    const payload = o ?? (q.type === "scale" ? { kind: "option", value_num: 4 }
      : q.type === "text" || q.type === "text_list" ? { kind: "text", text: "토너 추천해줘" }
      : { kind: "option", codes: [q.options[0].code] });
    v = await service.answer(v.interview.id, { turn_id: q.turn_id, ...payload });
  }
  return v;
}

/** 조사 인터뷰 1건을 혜택 전 잠금 → 결과까지 끝낸다. */
async function completed(service, { category = "SK-TONER", market = "KR", lang = "ko", outcome, reasons }) {
  let v = await service.start({ lang, market, product_category: category });
  v = await answerAll(service, v);
  v = await service.lock(v.interview.id);
  v = await service.offer(v.interview.id, { shown: false });
  v = await answerAll(service, v, { outcome: { kind: "option", codes: [outcome] }, reason_codes: { kind: "option", codes: reasons } });
  assert.equal(v.interview.stage, "done");
  return v.interview.id;
}

function setup() {
  const store = openStore(":memory:");
  const service = createInterviewService({ store, claude: fakeClaude() });
  createRecommendService({ store, claude: null }); // recommendations 표 생성
  return { store, service };
}

test("제품 유형 필터: 집계·원문 조회가 고른 유형의 인터뷰만 센다", async () => {
  const { store, service } = setup();
  await completed(service, { category: "SK-TONER", outcome: "out_not_bought", reasons: ["r_price"] });
  await completed(service, { category: "SK-PAD", outcome: "out_bought_other", reasons: ["r_product"] });

  assert.equal(computeStats(store).header.pre_locked, 2);
  const toner = computeStats(store, { category: "SK-TONER" });
  assert.equal(toner.header.pre_locked, 1);
  assert.equal(toner.header.category, "SK-TONER");
  const outcome = toner.slots.find((s) => s.slot === "outcome");
  assert.equal(outcome.codes.find((c) => c.code === "out_not_bought").n_confirmed, 1);
  assert.equal(outcome.codes.find((c) => c.code === "out_bought_other").n_confirmed, 0);

  assert.equal(evidenceFor(store, { slot: "reason_codes", code: "r_product" }).length, 1);
  assert.equal(evidenceFor(store, { slot: "reason_codes", code: "r_product", category: "SK-TONER" }).length, 0);
});

test("결정 이유를 구매/미구매로 나눠 세고, 분모는 각 그룹에서 질문받은 사람이다", async () => {
  const { store, service } = setup();
  await completed(service, { outcome: "out_not_bought", reasons: ["r_price", "r_shipping"] });
  await completed(service, { outcome: "out_undecided", reasons: ["r_shipping"] });
  await completed(service, { outcome: "out_bought_ai_candidate", reasons: ["r_product"] });

  const r = reasonsByOutcome(store, { internal: true });
  assert.equal(r.asked_bought, 1);
  assert.equal(r.asked_not_bought, 2);
  const by = Object.fromEntries(r.codes.map((c) => [c.code, c]));
  assert.deepEqual([by.r_price.n_not_bought, by.r_shipping.n_not_bought, by.r_product.n_not_bought], [1, 2, 0]);
  assert.deepEqual([by.r_price.n_bought, by.r_product.n_bought], [0, 1]);
});

test("추천 요청 계열: 완료된 추천의 검증 통과 후보에서 브랜드·출처를 세고, 조사 집계와 섞지 않는다", async () => {
  const { store, service } = setup();
  const itv = await service.start({ lang: "en", market: "US", product_category: "SK-TONER", mode: "recommend" });
  const cand = (brand, name, pos, extra = {}) => ({ position: pos, brand, product_name: name, explicit_rank: null, reason_text: "x", unverified_text: null,
    price: extra.price ?? null, buy: extra.buy ?? null, sources: extra.sources ?? [], image: null, notes: [] });
  const insert = (id, status, candidates, failure = null) => store.db.prepare(`INSERT INTO recommendations (id, interview_id, status, failure, question_text, intent_id, conditions_json,
    template_version, prompt_hash, analysis_prompt_hash, search_country, lang, candidates_json, review_json, cost_usd, is_internal_test, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, itv.interview.id, status, failure, "Q?", "06", JSON.stringify([{ slot: "concern_codes", code: "skin_oily", label: "지성" }]),
    "rec-q-v0.1", "h", "h", "US", "en", candidates ? JSON.stringify(candidates) : null, "[]", 0.05, 1, `2026-10-24T0${id.at(-1)}:00:00.000Z`, "2026-10-24T00:00:00.000Z");
  insert("rec-1", "done", [
    cand("Round Lab", "1025 Dokdo Toner", 1, { price: { text: "$15.90" }, buy: { url: "https://www.amazon.com/dp/B0TEST?tag=aff-20" }, sources: [{ url: "https://www.amazon.com/dp/B0TEST" }] }),
    cand("Anua", "Heartleaf 77", 2, { sources: [{ url: "https://example.com/review" }] }),
  ]);
  insert("rec-2", "done", [cand("ROUND LAB", "Dokdo Toner 500ml", 1), cand(null, "Some Toner", 2)]);
  insert("rec-3", "failed", null, "search_not_used");

  const s = recommendSeries(store, { internal: true });
  assert.deepEqual([s.requests.total, s.requests.done, s.requests.failed], [3, 2, 1]);
  assert.equal(s.requests.by_failure.search_not_used, 1);
  const rl = s.brands.find((b) => b.brand === "Round Lab"); // 먼저 본 표기(rec-1)가 대표 이름
  assert.ok(rl, "대소문자·공백이 달라도 같은 브랜드로 묶는다");
  assert.deepEqual([rl.n_candidates, rl.n_requests, rl.n_first, rl.n_price, rl.n_buy, rl.pct_requests], [2, 2, 2, 1, 1, 100]);
  assert.equal(s.brands.find((b) => b.brand === "(브랜드 미표기)").n_candidates, 1);
  assert.deepEqual(s.sources.map((x) => x.host), ["amazon.com", "example.com"]);
  assert.equal(s.recent[0].id, "rec-3", "최근 요청이 먼저");
  assert.equal(s.recent.find((r) => r.id === "rec-1").candidates[0].buy_url, "https://www.amazon.com/dp/B0TEST", "추적 매개변수는 지운다");

  // 조사 집계에는 추천 모드가 들어가지 않는다
  const o = createBrandService({ store }).overview({ internal: true });
  assert.equal(o.consumer.header.pre_locked, 0);
  assert.equal(o.consumer.header.recommend_excluded, 1);
  assert.equal(o.api_test.status, "not_connected");
  assert.ok(o.external.every((e) => e.status === "not_connected"));
});

/** 이전 API 측정 데모의 최소 스키마로 가짜 sieve.db를 만든다. */
function legacyDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE projects (project_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE runs (run_id TEXT PRIMARY KEY, settings TEXT NOT NULL, question_set_version TEXT NOT NULL);
    CREATE TABLE responses (response_id TEXT PRIMARY KEY, run_id TEXT, question_id TEXT, country TEXT, collected_at TEXT, model_id TEXT, text TEXT, parsed TEXT, search_used INTEGER, error TEXT, cost_usd REAL, outcome TEXT);
    CREATE TABLE analyses (analysis_id TEXT PRIMARY KEY, response_id TEXT, version TEXT, created_at TEXT, status TEXT, products TEXT, cost_usd REAL);`);
  db.prepare("INSERT INTO projects VALUES (?,?,?)").run("prj", JSON.stringify({ project_id: "prj", name: "토너", category: "toner", brands: [
    { brand_id: "b-own", role: "own", canonical_name: "라운드랩", aliases_ko: ["라운드랩"], aliases_en: ["Round Lab"] },
    { brand_id: "b-c1", role: "competitor", canonical_name: "아누아", aliases_ko: [], aliases_en: ["Anua"] },
  ] }), "2026-10-24T00:00:00Z");
  db.prepare("INSERT INTO runs VALUES (?,?,?)").run("run1", JSON.stringify({ model: "m", web_search_tool: "web_search_20250305", max_uses: 3 }), "v1");
  const resp = (id, qid, country, outcome, cites = []) => db.prepare("INSERT INTO responses VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, "run1", qid, country, `2026-10-24T0${id.at(-1)}:00:00Z`, "m", "원문 라운드랩 추천 아누아 언급", JSON.stringify({ text: "원문 라운드랩 추천 아누아 언급", citations: cites }), 1, null, 0.1, outcome);
  const ana = (id, rid, products, created = "2026-10-24T01:00:00Z", version = "a3") => db.prepare("INSERT INTO analyses VALUES (?,?,?,?,?,?,?)")
    .run(id, rid, version, created, "succeeded", JSON.stringify(products), 0.01);
  const p = (brand, mention_type, review_required = false, list_position = 1) => ({ brand, product: "P", mention_type, evidence_text: "라운드랩", start_offset: 3, end_offset: 7, review_required, list_position, citation_ids: [], issues: [] });
  resp("r1", "q01-ko", "KR", "valid", [{ id: "c1", url: "https://www.kurly.com/x", title: "t" }]);
  resp("r2", "q01-ko", "KR", "valid");
  resp("r3", "q05-ko", "KR", "valid");
  resp("r4", "q06-ko", "KR", "error");
  resp("r5", "q01-ja", "JP", "valid"); // 범위 밖(일본어)
  ana("a1", "r1", [p("라운드랩", "recommended"), p("Anua", "neutral", false, 2)]);
  ana("a1-old", "r2", [p("라운드랩", "neutral")], "2026-10-24T00:30:00Z", "a1");
  ana("a1-new", "r2", [p("라운드랩", "recommended", true), p("마녀공장", "recommended", false, 2)]); // 최신 분석이 이전을 대체
  ana("a3", "r3", [p("아누아", "recommended")]);
  ana("a5", "r5", [p("라운드랩", "recommended")]);
  return db;
}

test("API 테스트 읽기: 한국어·유효 응답만, 최신 분석만, 확정 추천과 검수 대기를 분리해 센다", () => {
  const reader = createApiTestReader(legacyDb());
  const o = reader.overview({});
  assert.equal(o.status, "connected");
  assert.deepEqual([o.header.n_valid, o.header.n_error, o.header.n_questions], [3, 1, 3]);
  const own = o.brands.find((b) => b.brand_id === "b-own");
  // r1 추천 확정, r2 추천 검수 대기(최신 분석), r3 없음 → 언급 2/3, 추천 확정 1/3
  assert.deepEqual([own.n_mentioned, own.n_recommended, own.n_pending], [2, 1, 1]);
  assert.equal(own.mention_rate, 66.7);
  assert.equal(own.recommend_rate, 33.3);
  // 문항별 평균: q01 추천 1/2=50%, q05 0%, q06 유효 응답 없음 → (50+0)/2
  assert.equal(own.recommend_rate_qmean, 25);
  const anua = o.brands.find((b) => b.brand_id === "b-c1");
  assert.deepEqual([anua.n_mentioned, anua.n_recommended], [2, 1], "영어 별칭 Anua도 같은 브랜드");
  assert.equal(own.share + anua.share, 100);
  const q01 = o.questions.find((q) => q.question_id === "q01-ko");
  assert.deepEqual(q01.brands["b-own"], ["recommended", "pending"]);
  assert.deepEqual(o.questions.find((q) => q.question_id === "q06-ko").n_error, 1);
  assert.deepEqual(o.other_brands, [{ name: "마녀공장", n: 1 }]);
  assert.deepEqual(o.cited_hosts, [{ host: "kurly.com", n: 1 }]);
  assert.equal(reader.overview({ category: "SK-PAD" }).status, "no_data");
  assert.equal(reader.overview({ category: "SK-TONER" }).status, "connected");

  const r = reader.response("r2");
  assert.equal(r.analysis_version, "a3");
  assert.equal(r.products.length, 2);
  assert.equal(reader.response("nope"), null);
});
