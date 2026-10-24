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

test("검증: 원문에 없는 이유·없는 인용 ID는 빼고, 가격은 원문에 있을 때만 붙인다", () => {
  const parsed = parseCollected(COLLECT_CONTENT);
  const { shown, review } = verifyCandidates({ candidates: [
    GOOD,
    { ...GOOD, product_name: "Fake", reason_text: "made up reason" },
    { ...GOOD, product_name: "Bad cite", citation_ids: ["c9"] },
    { ...GOOD, product_name: "Heartleaf 77% Toner", mention_type: "recommended", reason_text: "popular for oily skin", price_text: "$12.00", price_amount: 12, buy_citation_id: null, citation_ids: ["c2"] },
    { ...GOOD, product_name: "Discouraged", mention_type: "discouraged" },
  ] }, parsed);
  assert.deepEqual(shown.map((c) => c.product_name), ["1025 Dokdo Toner", "Heartleaf 77% Toner"]);
  assert.deepEqual(review.map((r) => r.product_name), ["Fake", "Bad cite", "Discouraged"]);
  assert.equal(shown[0].price.text, "$15.90");
  assert.equal(shown[0].price.seller, "Amazon");
  assert.equal(shown[0].buy.url, "https://www.amazon.com/dp/B0TEST?th=1"); // 제휴 tag·ref 경로 제거, 변형 값 유지
  assert.equal(shown[1].price, null); // $12.00은 원문에 없음
  assert.deepEqual(shown[1].notes, ["price_not_in_answer"]);
  assert.equal(shown[1].buy, null);
});

test("추천 흐름: 확정 전에는 거절, 확정 후 202 → 완료 시 검증 통과 후보만 사진·가격·구매 링크와 함께", async () => {
  const { store, interviews, recommend, recClaude } = setup();
  const started = await interviews.start({ lang: "en", market: "US", product_category: "SK-TONER", mode: "recommend" });
  assert.throws(() => recommend.create({ interview_id: started.interview.id }), { status: 409 });

  const v = await confirmedInterview(interviews);
  const first = recommend.create({ interview_id: v.interview.id });
  assert.equal(first.status, 202);
  // 진행 중 중복 요청은 같은 기록을 돌려준다
  const dup = recommend.create({ interview_id: v.interview.id });
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
  assert.equal(recClaude.calls[0].input.question, rec.question_text);
  // 원본은 sha256과 함께 저장, 조사 집계 테이블에는 추천 행이 없다
  const row = store.db.prepare("SELECT raw_sha256, cost_usd FROM recommendations WHERE id = ?").get(rec.id);
  assert.match(row.raw_sha256, /^[0-9a-f]{64}$/);
  assert.ok(row.cost_usd > 0);
});

test("실패 상태: 검색 미실행·검증 통과 0개는 그대로 알리고, 실패 후에는 다시 요청할 수 있다", async () => {
  const noSearch = fakeClaude({ collect: () => ({ ok: true, raws: [], usage: {}, cost_usd: 0.01, model_id: "m", parsed: parseCollected([{ type: "text", text: ANSWER }]) }) });
  const a = setup(noSearch);
  const v = await confirmedInterview(a.interviews);
  const r1 = a.recommend.create({ interview_id: v.interview.id });
  await a.recommend.settle(r1.body.id);
  assert.equal(a.recommend.get(r1.body.id).failure, "search_not_used");
  assert.deepEqual(a.recommend.get(r1.body.id).candidates, []);
  const r2 = a.recommend.create({ interview_id: v.interview.id });
  assert.equal(r2.status, 202);
  assert.notEqual(r2.body.id, r1.body.id);

  const none = setup(fakeClaude({ analyze: () => ({ candidates: [{ ...GOOD, reason_text: "nope" }] }) }));
  const v2 = await confirmedInterview(none.interviews);
  const r3 = none.recommend.create({ interview_id: v2.interview.id });
  await none.recommend.settle(r3.body.id);
  assert.equal(none.recommend.get(r3.body.id).failure, "no_verified_candidates");

  const timeout = setup(fakeClaude({ collect: () => ({ ok: false, error: "timeout", raws: [], usage: {}, cost_usd: 0, model_id: "m" }) }));
  const v3 = await confirmedInterview(timeout.interviews);
  const r4 = timeout.recommend.create({ interview_id: v3.interview.id });
  await timeout.recommend.settle(r4.body.id);
  assert.equal(timeout.recommend.get(r4.body.id).failure, "timeout");
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
