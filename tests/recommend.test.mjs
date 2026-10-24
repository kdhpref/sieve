// 제품 추천 받기 테스트. Claude·사진 찾기는 가짜로 대체한다(실제 호출 없음).
import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../lib/interview/store.mjs";
import { createInterviewService } from "../lib/interview/service.mjs";
import { createRecommendService, verifyCandidates, cleanUrl } from "../lib/recommend/service.mjs";
import { buildQuery } from "../lib/recommend/query.mjs";
import { parseCollected } from "../lib/recommend/claude.mjs";
import { publicUrl, extractImage, isPrivateAddress } from "../lib/recommend/image.mjs";

const ANSWER = "1. **Round Lab 1025 Dokdo Toner** — lightweight and fragrance-free. Price: $15.90 at Amazon (checked Oct 24, 2026).\n"
  + "2. Anua Heartleaf 77% Toner — popular for oily skin. Price not confirmed.\n";

// 웹 검색 응답 모양(server_tool_use → web_search_tool_result → 인용 붙은 text)
const COLLECT_CONTENT = [
  { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "korean toner" } },
  { type: "web_search_tool_result", tool_use_id: "s1", content: [
    { type: "web_search_result", url: "https://www.amazon.com/dp/B0TEST/ref=sr_1_1?tag=aff-20&th=1", title: "Round Lab Dokdo Toner", page_age: null },
    { type: "web_search_result", url: "https://example.com/review", title: "Review", page_age: null },
  ] },
  { type: "text", text: ANSWER.split("\n")[0] + "\n", citations: [
    { type: "web_search_result_location", url: "https://www.amazon.com/dp/B0TEST/ref=sr_1_1?tag=aff-20&th=1", title: "Round Lab Dokdo Toner", cited_text: "$15.90" },
  ] },
  { type: "text", text: ANSWER.split("\n")[1] + "\n", citations: [
    { type: "web_search_result_location", url: "https://example.com/review", title: "Review", cited_text: "heartleaf" },
  ] },
];

const GOOD = {
  brand: "Round Lab", product_name: "1025 Dokdo Toner", mention_type: "recommended",
  reason_text: "lightweight and fragrance-free", price_text: "$15.90", price_amount: 15.9, currency: "USD", seller: "Amazon",
  checked_date_text: "checked Oct 24, 2026", unverified_text: null, citation_ids: ["c1"], buy_citation_id: "c1", explicit_rank: null,
};

function fakeClaude({ collect, analyze } = {}) {
  const calls = [];
  return {
    model: "fake-model",
    calls,
    async collect(input) {
      calls.push({ purpose: "collect", input });
      return collect ? collect(input) : { ok: true, error: null, raws: [{ fake: true }], usage: { input_tokens: 10 }, cost_usd: 0.03, model_id: "fake-model", parsed: parseCollected(COLLECT_CONTENT) };
    },
    async analyze(input) {
      calls.push({ purpose: "analyze", input });
      const data = analyze ? analyze(input) : { candidates: [GOOD, { ...GOOD, product_name: "Made Up Toner", reason_text: "not in the answer" }] };
      return { ok: true, error: null, data, raws: [{ fake: true }], usage: { input_tokens: 5 }, cost_usd: 0.01, model_id: "fake-model" };
    },
  };
}

function itvClaude() {
  return {
    model: "fake-model",
    async call(purpose, input) {
      return { ok: true, data: { slot: input.next_slot.key, text: `${input.next_slot.key} 질문이에요?` }, raw: {}, usage: {}, cost_usd: 0, model_id: "fake-model", latency_ms: 1, stop_reason: "end_turn", error: null };
    },
  };
}

async function confirmedInterview(service, { lang = "en", overrides = {} } = {}) {
  let v = await service.start({ lang, market: "US", product_category: "SK-TONER", mode: "recommend" });
  const answers = {
    concern_codes: { kind: "option", codes: ["skin_oily", "avoid_fragrance"] },
    primary_concern_code: { kind: "option", codes: ["skin_oily"] },
    budget_band: { kind: "option", codes: ["bud_2"] },
    planned_channel: { kind: "option", codes: ["ch_amazon_us"] },
    ...overrides,
  };
  for (let i = 0; v.question && i < 30; i++) {
    const q = v.question;
    const payload = answers[q.slot] ?? (q.type === "text" || q.type === "text_list" ? { kind: "text", text: "need a toner" } : { kind: "option", codes: [q.options[0].code] });
    v = await service.answer(v.interview.id, { turn_id: q.turn_id, ...payload });
  }
  return service.lock(v.interview.id);
}

function setup(recClaude = fakeClaude(), imageFinder = async () => "https://m.media-amazon.com/images/I/test.jpg") {
  const store = openStore(":memory:");
  const interviews = createInterviewService({ store, claude: itvClaude() });
  const recommend = createRecommendService({ store, claude: recClaude, imageFinder });
  return { store, interviews, recommend, recClaude };
}

test("질문 조립: 확정 조건만 고정 템플릿으로 붙이고, 같은 조건이면 같은 질문·해시", async () => {
  const { store, interviews } = setup();
  const v = await confirmedInterview(interviews);
  const q1 = buildQuery(store.getInterview(v.interview.id));
  assert.equal(q1.intent_id, "06");
  assert.equal(q1.search_country, "US");
  assert.match(q1.question_text, /^Among Korean-brand toners available to buy in the US, compare lightweight products suited to oily skin\./);
  assert.match(q1.question_text, /Skin type: Oily\. I want to avoid: fragrance\. Budget for one product: \$10–20\. I plan to buy at Amazon\./);
  assert.match(q1.question_text, /Name 3 candidates.*product page URL\.$/);
  assert.deepEqual(q1.conditions.map((c) => c.code), ["skin_oily", "avoid_fragrance", "bud_2", "ch_amazon_us"]);
  assert.deepEqual(q1, buildQuery(store.getInterview(v.interview.id)));
});

test("질문 조립: 검수 대기 값과 '정하지 않음·아직 모름'은 질문에 넣지 않는다", async () => {
  const { store, interviews } = setup();
  const v = await confirmedInterview(interviews, { overrides: { budget_band: { kind: "option", codes: ["bud_none"] }, planned_channel: { kind: "option", codes: ["ch_undecided"] } } });
  const itv = store.getInterview(v.interview.id);
  itv.state.slots.concern_codes.review_required = true;
  const q = buildQuery(itv);
  assert.doesNotMatch(q.question_text, /Budget|plan to buy|Skin type|avoid/);
  assert.ok(q.conditions.every((c) => c.slot !== "budget_band" && c.slot !== "planned_channel"));
});

test("검증: 원문에 없는 이름·이유와 비추천은 빼고, 인용 없는 후보는 '검색 확인 안 됨'으로 보여준다", () => {
  const parsed = parseCollected(COLLECT_CONTENT);
  const { shown, review } = verifyCandidates({ candidates: [
    GOOD,
    { ...GOOD, product_name: "Fake", reason_text: "made up reason" },
    { ...GOOD, product_name: "Heartleaf 77% Toner", brand: "Anua", reason_text: "popular for oily skin", price_text: "$12.00", price_amount: 12, buy_citation_id: null, citation_ids: ["c9"] },
    { ...GOOD, product_name: "Dokdo", mention_type: "discouraged" },
  ] }, parsed, { channel: "ch_amazon_us", country: "US" });
  assert.deepEqual(shown.map((c) => c.product_name), ["1025 Dokdo Toner", "Heartleaf 77% Toner"]);
  assert.deepEqual(review.map((r) => r.reasons), [["name_not_in_answer", "reason_not_in_answer"], ["discouraged"]]);
  assert.equal(shown[0].verified, true);
  assert.equal(shown[0].price.text, "$15.90");
  assert.equal(shown[0].price.seller, "Amazon");
  assert.deepEqual(shown[0].buy, { url: "https://www.amazon.com/dp/B0TEST?th=1", title: "Round Lab Dokdo Toner", kind: "cited_page" }); // 제휴 tag·ref 경로 제거
  // 없는 인용 ID는 버리고, 출처가 없으니 검색 확인 안 됨 + 가격 숨김 + 구매처 검색 링크
  assert.equal(shown[1].verified, false);
  assert.deepEqual(shown[1].sources, []);
  assert.equal(shown[1].price, null);
  assert.deepEqual(shown[1].notes, ["price_without_source"]);
  assert.deepEqual(shown[1].buy, { url: "https://www.amazon.com/s?k=Anua%20Heartleaf%2077%25%20Toner", title: null, kind: "store_search" });
});

test("구매 링크: 인용이 없으면 검색 결과에 있던 판매 페이지만 쓰고, 목록에 없는 URL은 버린다", () => {
  const parsed = parseCollected(COLLECT_CONTENT);
  const base = { ...GOOD, buy_citation_id: null, citation_ids: [] };
  const ok = verifyCandidates({ candidates: [{ ...base, buy_search_result_url: "https://example.com/review" }] }, parsed, { channel: "ch_coupang", country: "KR" });
  assert.equal(ok.shown[0].buy.kind, "search_result_page");
  assert.equal(ok.shown[0].verified, true);
  const made = verifyCandidates({ candidates: [{ ...base, buy_search_result_url: "https://made.up/product" }] }, parsed, { channel: "ch_coupang", country: "KR" });
  assert.equal(made.shown[0].buy.kind, "store_search");
  assert.match(made.shown[0].buy.url, /^https:\/\/www\.coupang\.com\/np\/search\?q=/);
  // 제품명에 브랜드가 이미 있으면 검색어에 두 번 넣지 않는다
  const dup = verifyCandidates({ candidates: [{ ...base, brand: "Round Lab", product_name: "Round Lab 1025 Dokdo Toner" }] }, parsed, { channel: "ch_coupang", country: "KR" });
  assert.equal(new URL(dup.shown[0].buy.url).searchParams.get("q"), "Round Lab 1025 Dokdo Toner");
});

test("추천 흐름: 확정 전에는 거절, 확정 후 202 → 완료 시 검증 통과 후보만 사진·가격·구매 링크와 함께", async () => {
  const { store, interviews, recommend, recClaude } = setup();
  const started = await interviews.start({ lang: "en", market: "US", product_category: "SK-TONER", mode: "recommend" });
  await assert.rejects(recommend.create({ interview_id: started.interview.id }), { status: 409 });

  const v = await confirmedInterview(interviews);
  const first = await recommend.create({ interview_id: v.interview.id });
  assert.equal(first.status, 202);
  // 진행 중 중복 요청은 같은 기록을 돌려준다
  const dup = await recommend.create({ interview_id: v.interview.id });
  assert.equal(dup.status, 200);
  assert.equal(dup.body.id, first.body.id);
  await recommend.settle(first.body.id);

  const rec = recommend.get(first.body.id);
  assert.equal(rec.status, "done");
  assert.equal(rec.candidates.length, 1);
  assert.equal(rec.review_count, 1);
  const c = rec.candidates[0];
  assert.equal(c.image.url, "https://m.media-amazon.com/images/I/test.jpg");
  assert.equal(c.price.text, "$15.90");
  assert.match(c.buy.url, /^https:\/\/www\.amazon\.com\/dp\/B0TEST/);
  assert.equal(rec.collection.search_used, true);
  assert.equal(rec.is_internal_test, true);
  // 수집 질문에 자사·경쟁사 목록 같은 추가 정보가 없고 조립한 질문 그대로 보낸다
  assert.equal(recClaude.calls[0].input.question, rec.collection.question_text);
  // 원본은 sha256과 함께 저장, 조사 집계 테이블에는 추천 행이 없다
  const row = store.db.prepare("SELECT raw_sha256, cost_usd FROM recommendations WHERE id = ?").get(rec.id);
  assert.match(row.raw_sha256, /^[0-9a-f]{64}$/);
  assert.ok(row.cost_usd > 0);
});

test("검색이 안 되면 검색 없이 Claude가 아는 정보로 후보를 내고, 그래도 없으면 실패를 알린다", async () => {
  // 웹 검색 단계에서 후보 0개 → 검색 없는 대체 수집으로 후보 표시
  const fallback = fakeClaude({
    collect: (input) => ({ ok: true, raws: [{ search: input.search }], usage: {}, cost_usd: 0.01, model_id: "m",
      parsed: parseCollected(input.search ? COLLECT_CONTENT : [{ type: "text", text: ANSWER }]) }),
    analyze: (input) => ({ candidates: input.citations.length ? [] : [{ ...GOOD, citation_ids: [], buy_citation_id: null }] }),
  });
  const a = setup(fallback);
  const v = await confirmedInterview(a.interviews);
  const r1 = await a.recommend.create({ interview_id: v.interview.id });
  await a.recommend.settle(r1.body.id);
  const rec = a.recommend.get(r1.body.id);
  assert.equal(rec.status, "done");
  assert.equal(rec.source_mode, "knowledge");
  assert.deepEqual(fallback.calls.filter((c) => c.purpose === "collect").map((c) => c.input.search), [true, false]);
  assert.equal(rec.candidates[0].verified, false);
  assert.equal(rec.candidates[0].price, null);
  assert.equal(rec.candidates[0].buy.kind, "store_search");
  assert.equal(rec.candidates[0].image, null); // 검색 링크에서는 사진을 찾지 않는다
  assert.match(rec.error, /no_candidates_with_search/);

  const none = setup(fakeClaude({ analyze: () => ({ candidates: [{ ...GOOD, reason_text: "nope" }] }) }));
  const v2 = await confirmedInterview(none.interviews);
  const r3 = await none.recommend.create({ interview_id: v2.interview.id });
  await none.recommend.settle(r3.body.id);
  assert.equal(none.recommend.get(r3.body.id).failure, "no_verified_candidates");
  // 실패한 뒤에는 다시 요청하면 새 기록을 만든다
  const r4 = await none.recommend.create({ interview_id: v2.interview.id });
  assert.equal(r4.status, 202);
  assert.notEqual(r4.body.id, r3.body.id);

  const timeout = setup(fakeClaude({ collect: () => ({ ok: false, error: "timeout", raws: [], usage: {}, cost_usd: 0, model_id: "m" }) }));
  const v3 = await confirmedInterview(timeout.interviews);
  const r5 = await timeout.recommend.create({ interview_id: v3.interview.id });
  await timeout.recommend.settle(r5.body.id);
  assert.equal(timeout.recommend.get(r5.body.id).failure, "timeout");
});

test("사진 찾기: 내부 주소·http(s) 밖 주소는 거절하고, og:image를 페이지 기준으로 푼다", async () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "169.254.169.254", "172.20.0.1", "::1", "fd00::1", "::ffff:127.0.0.1"]) assert.ok(isPrivateAddress(ip), ip);
  assert.ok(!isPrivateAddress("93.184.216.34"));
  const resolve = async (h) => (h === "evil.test" ? [{ address: "10.0.0.5" }] : [{ address: "93.184.216.34" }]);
  assert.equal(await publicUrl("http://evil.test/x", resolve), null);
  assert.equal(await publicUrl("file:///etc/passwd", resolve), null);
  assert.equal(await publicUrl("http://localhost/", resolve), null);
  assert.equal(await publicUrl("https://shop.test:8443/", resolve), null);
  assert.ok(await publicUrl("https://shop.test/p/1", resolve));
  const html = `<head><meta content="/img/a.jpg?x=1&amp;y=2" property="og:image"><meta name="twitter:image" content="https://cdn.test/t.jpg"></head>`;
  assert.equal(extractImage(html, "https://shop.test/p/1"), "https://shop.test/img/a.jpg?x=1&y=2");
  assert.equal(extractImage(`<meta property="og:image" content="javascript:alert(1)">`, "https://shop.test/"), null);
  assert.equal(cleanUrl("javascript:alert(1)"), null);
});

test("언어가 시장을 정한다: 한국어 추천은 KR(한국 구매처·검색 위치), 영어 추천은 US", async () => {
  const { store, interviews } = setup();
  const ko = await interviews.start({ lang: "ko", market: "US", product_category: "SK-TONER", mode: "recommend" });
  assert.equal(ko.interview.market, "KR");
  const en = await interviews.start({ lang: "en", market: "KR", product_category: "SK-TONER", mode: "recommend" });
  assert.equal(en.interview.market, "US");
  const v = await confirmedInterview(interviews, { lang: "ko", overrides: { budget_band: { kind: "option", codes: ["bud_2"] }, planned_channel: { kind: "option", codes: ["ch_oliveyoung"] } } });
  const q = buildQuery(store.getInterview(v.interview.id));
  assert.equal(q.search_country, "KR");
  assert.match(q.question_text, /^한국에서 구매할 수 있는 한국 브랜드 토너 중에서 지성 피부를 고려한/);
  assert.match(q.question_text, /1개 예산: 1만~2만 원\. 올리브영에서 살 생각이야\./);
  // 조사 모드는 그대로 둔다
  const research = await interviews.start({ lang: "ko", market: "US", product_category: "SK-TONER" });
  assert.equal(research.interview.market, "US");
});

test("서버리스 모드: POST 안에서 수집을 끝내고 완료 결과를 돌려준다", async () => {
  const store = openStore(":memory:");
  const interviews = createInterviewService({ store, claude: itvClaude() });
  const recommend = createRecommendService({ store, claude: fakeClaude(), imageFinder: async () => null, waitInRequest: true });
  const v = await confirmedInterview(interviews);
  const r = await recommend.create({ interview_id: v.interview.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "done");
  assert.equal(r.body.candidates[0].image, null);
});
