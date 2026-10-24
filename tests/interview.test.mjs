// 인터뷰 진행·검증·집계 테스트. Claude는 가짜 클라이언트로 대체한다(실제 호출 없음).
import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../lib/interview/store.mjs";
import { createInterviewService } from "../lib/interview/service.mjs";
import { computeStats, evidenceFor } from "../lib/interview/stats.mjs";
import { locate, validateQuestion } from "../lib/interview/validate.mjs";

function fakeClaude({ extract, question } = {}) {
  const calls = [];
  return {
    model: "fake-model",
    calls,
    async call(purpose, input) {
      calls.push({ purpose, input });
      const fn = purpose === "extract" ? extract : question;
      const data = fn ? fn(input) : { slot: input.next_slot.key, text: `${input.next_slot.key} 질문이에요?` };
      return { ok: true, data, raw: { fake: true }, usage: { input_tokens: 100, output_tokens: 20 }, cost_usd: 0.001, model_id: "fake-model", latency_ms: 1, stop_reason: "end_turn", error: null };
    },
  };
}

function setup(claude = fakeClaude()) {
  const store = openStore(":memory:");
  const service = createInterviewService({ store, claude, blockedTerms: ["아누아", "Anua"] });
  return { store, service, claude };
}

const START = { lang: "ko", market: "KR", product_category: "SK-TONER" };

// 보기 첫 번째(척도는 4, 자유 입력 슬롯은 짧은 문장)로 단계 끝까지 답한다. overrides로 슬롯별 답 지정.
async function answerAll(service, view, overrides = {}) {
  let v = view;
  for (let i = 0; v.question && i < 40; i++) {
    const q = v.question;
    const o = overrides[q.slot];
    let payload;
    if (o) payload = typeof o === "function" ? o(q) : o;
    else if (q.type === "scale") payload = { kind: "option", value_num: 4 };
    else if (q.type === "text" || q.type === "text_list") payload = { kind: "text", text: "토너 추천해줘" };
    else payload = { kind: "option", codes: [q.options[0].code] };
    v = await service.answer(v.interview.id, { turn_id: q.turn_id, ...payload });
  }
  return v;
}

test("보기만으로 혜택 전 기록을 끝내고 잠그면 정량 행이 생기고 이후 수정은 거절된다", async () => {
  const { store, service } = setup();
  let v = await service.start(START);
  assert.equal(v.question.slot, "trigger");
  assert.equal(v.question.source, "llm");
  const firstTurn = v.question.turn_id;

  await assert.rejects(service.offer(v.interview.id, { shown: true }), { status: 409 }); // 잠금 전 혜택 단계 금지
  v = await answerAll(service, v, { current_status: { kind: "option", codes: ["cur_none"] } });
  assert.equal(v.question, null);
  assert.equal(v.interview.stage, "pre_offer");

  v = await service.lock(v.interview.id);
  assert.equal(v.interview.stage, "offer");
  assert.ok(v.interview.pre_locked_at);
  await assert.rejects(service.lock(v.interview.id), { status: 409 });
  await assert.rejects(service.answer(v.interview.id, { turn_id: firstTurn, kind: "option", codes: ["trg_first"] }), { status: 409 });

  const rows = store.db.prepare("SELECT slot, status, value_code FROM interview_values WHERE interview_id = ?").all(v.interview.id);
  assert.equal(rows.find((r) => r.slot === "dissatisfaction").status, "not_asked"); // cur_none → 조건 미충족
  assert.equal(rows.find((r) => r.slot === "primary_concern_code").value_code, "skin_sensitive"); // 고민 1개 → 자동
  assert.equal(rows.find((r) => r.slot === "budget_band").value_code, "bud_1");
});

test("피부 타입 잘 모름 → 유도 질문 답으로 고민 코드를 바꾸고 출처를 guided로 남긴다", async () => {
  const { store, service } = setup();
  let v = await service.start(START);
  v = await answerAll(service, v, {
    concern_codes: { kind: "option", codes: ["skin_unknown", "feel_nonsticky"] },
    skin_guide_answer: { kind: "option", codes: ["guide_combo"] },
    primary_concern_code: (q) => {
      assert.deepEqual(q.options.map((o) => o.code).sort(), ["feel_nonsticky", "skin_combo"]);
      return { kind: "option", codes: ["skin_combo"] };
    },
  });
  await service.lock(v.interview.id);
  const concern = store.db.prepare("SELECT value_code, source FROM interview_values WHERE interview_id = ? AND slot = 'concern_codes'").all(v.interview.id);
  assert.deepEqual(concern.map((r) => [r.value_code, r.source]).sort(), [["feel_nonsticky", "option"], ["skin_combo", "guided"]]);
});

test("자유 답변 분류: 근거가 원문에 있으면 확정, 원문에 없거나 코드북 밖이면 검수 대기", async () => {
  const answers = {
    trigger: { slot: "trigger", status: "clear", codes: [{ code: "trg_switch", evidence_text: "바꾸고 싶어서", rank: null }], other_slots: [{ slot: "concern_codes", code: "skin_dry", evidence_text: "건조해서" }], probe_question: null },
    current_status: { slot: "current_status", status: "clear", codes: [{ code: "cur_unsatisfied", evidence_text: "원문에 없는 문장", rank: null }], other_slots: [], probe_question: null },
    dissatisfaction: { slot: "dissatisfaction", status: "clear", codes: [{ code: "diss_made_up", evidence_text: "끈적", rank: null }], other_slots: [], probe_question: null },
  };
  const claude = fakeClaude({ extract: (input) => answers[input.current_slot.key] });
  const { store, service } = setup(claude);
  let v = await service.start(START);
  v = await service.answer(v.interview.id, { turn_id: v.question.turn_id, kind: "text", text: "피부가 건조해서  바꾸고 싶어서요" });
  assert.equal(v.question.slot, "concern_codes");
  const qCall = claude.calls.filter((c) => c.purpose === "question").at(-1);
  assert.deepEqual(qCall.input.hints.map((h) => h.code), ["skin_dry"]); // 다른 슬롯 후보는 확정하지 않고 힌트로만

  v = await answerAll(service, v, {
    current_status: { kind: "text", text: "쓰고는 있는데 별로예요" },
    dissatisfaction: { kind: "text", text: "끈적여요" },
  });
  await service.lock(v.interview.id);
  const get = (slot) => store.db.prepare("SELECT * FROM interview_values WHERE interview_id = ? AND slot = ?").all(v.interview.id, slot);
  const trig = get("trigger")[0];
  assert.equal(trig.value_code, "trg_switch");
  assert.equal(trig.review_required, 0);
  assert.equal("피부가 건조해서  바꾸고 싶어서요".slice(trig.start_offset, trig.end_offset), "바꾸고 싶어서");
  assert.equal(get("current_status")[0].review_required, 1);
  assert.equal(get("current_status")[0].value_code, null);
});

test("애매한 답은 같은 슬롯을 한 번만 다시 묻고, 그래도 애매하면 검수 대기로 넘긴다", async () => {
  const claude = fakeClaude({
    extract: (input) => ({ slot: input.current_slot.key, status: "ambiguous", codes: [], other_slots: [], probe_question: "처음 써보시는 건가요, 바꾸려는 건가요?" }),
  });
  const { service } = setup(claude);
  let v = await service.start(START);
  v = await service.answer(v.interview.id, { turn_id: v.question.turn_id, kind: "text", text: "그냥요" });
  assert.equal(v.question.slot, "trigger");
  assert.equal(v.question.is_probe, true);
  assert.equal(v.question.text, "처음 써보시는 건가요, 바꾸려는 건가요?");
  v = await service.answer(v.interview.id, { turn_id: v.question.turn_id, kind: "text", text: "글쎄요" });
  assert.equal(v.question.slot, "concern_codes");
  assert.equal(v.summary.pre_offer[0].review_required, true);
});

test("질문 문장에 등록 브랜드명이 있거나 슬롯이 다르면 고정 문구로 대체한다", async () => {
  let n = 0;
  const claude = fakeClaude({
    question: (input) => (n++ === 0 ? { slot: input.next_slot.key, text: "아누아 토너도 보셨나요?" } : { slot: "budget_band", text: "예산은요?" }),
  });
  const { service } = setup(claude);
  let v = await service.start(START);
  assert.equal(v.question.source, "fallback");
  assert.equal(v.question.text, "이번에 이 제품을 찾게 된 계기가 무엇인가요?");
  v = await service.answer(v.interview.id, { turn_id: v.question.turn_id, kind: "option", codes: ["trg_first"] });
  assert.equal(v.question.source, "fallback");
});

test("같은 질문에 두 번 답하면 두 번째는 거절되고, 잘못된 보기는 저장하지 않는다", async () => {
  const { service } = setup();
  const v = await service.start(START);
  const turn = v.question.turn_id;
  await assert.rejects(service.answer(v.interview.id, { turn_id: turn, kind: "option", codes: ["trg_first", "trg_gift"] }), { status: 400 });
  await assert.rejects(service.answer(v.interview.id, { turn_id: turn, kind: "option", codes: ["nope"] }), { status: 400 });
  const [a, b] = await Promise.allSettled([
    service.answer(v.interview.id, { turn_id: turn, kind: "option", codes: ["trg_first"] }),
    service.answer(v.interview.id, { turn_id: turn, kind: "option", codes: ["trg_gift"] }),
  ]);
  assert.equal(a.status, "fulfilled");
  assert.equal(b.status, "rejected");
  assert.equal(b.reason.status, 409);
});

test("Claude가 없으면 고정 문구로 진행하고 자유 답변은 원문만 남겨 검수 대기", async () => {
  const store = openStore(":memory:");
  const service = createInterviewService({ store, claude: null });
  let v = await service.start({ lang: "en", market: "US", product_category: "SK-PAD" });
  assert.equal(v.llm.available, false);
  assert.equal(v.question.text, "What made you start looking for this product?");
  v = await service.answer(v.interview.id, { turn_id: v.question.turn_id, kind: "text", text: "My skin felt dry" });
  assert.equal(v.summary.pre_offer[0].review_required, true);
  assert.equal(v.summary.pre_offer[0].answer, "My skin felt dry");
});

test("혜택 후 단계: 혜택을 본 경우에만 선택 변경을 묻고, 끝나면 done", async () => {
  for (const shown of [true, false]) {
    const { store, service } = setup();
    let v = await answerAll(service, await service.start(START));
    await service.lock(v.interview.id);
    v = await service.offer(v.interview.id, { shown });
    assert.equal(v.question.slot, "outcome");
    v = await answerAll(service, v, {
      outcome: { kind: "option", codes: ["out_not_bought"] },
      reason_codes: { kind: "option", codes: ["r_shipping"] },
    });
    assert.equal(v.interview.stage, "done");
    if (shown) {
      const t = store.turns(v.interview.id).find((x) => x.slot === "changed_after_offer");
      assert.equal(t.question_source, "fixed"); // 측정 정의가 담긴 문구는 Claude가 바꾸지 않는다
      assert.equal(t.question_text, "혜택 안내를 본 뒤 고르려던 제품이 바뀌었나요?");
    }
    const changed = store.db.prepare("SELECT status FROM interview_values WHERE slot = 'changed_after_offer'").get();
    assert.equal(changed.status, shown ? "answered" : "not_asked");
    assert.equal(store.db.prepare("SELECT status FROM interview_values WHERE slot = 'chosen_product_raw'").get().status, "not_asked");
  }
});

test("집계: 분모는 질문받은 사람, 건너뜀은 따로, 내부 테스트와 실제 데이터를 섞지 않는다", async () => {
  const { store, service } = setup();
  for (const trigger of [["trg_first"], ["trg_first"], null]) {
    let v = await service.start(START);
    v = await answerAll(service, v, { trigger: trigger ? { kind: "option", codes: trigger } : { kind: "skip" } });
    await service.lock(v.interview.id);
  }
  let open = await service.start(START); // 잠그지 않은 인터뷰는 집계에서 빠진다
  open = await service.answer(open.interview.id, { turn_id: open.question.turn_id, kind: "option", codes: ["trg_gift"] });

  const s = computeStats(store, { internal: true });
  assert.equal(s.header.started, 4);
  assert.equal(s.header.pre_locked, 3);
  const trig = s.slots.find((x) => x.slot === "trigger");
  assert.equal(trig.asked, 3);
  assert.equal(trig.skipped, 1);
  assert.equal(trig.codes.find((c) => c.code === "trg_first").pct, 66.7);
  assert.equal(trig.codes.find((c) => c.code === "trg_gift").n_confirmed, 0);
  const intent = s.slots.find((x) => x.slot === "intent_scale");
  assert.equal(intent.median, 4);
  assert.deepEqual(s.intents, [{ intent_id: "01", n: 3 }]);
  assert.equal(evidenceFor(store, { slot: "trigger", code: "__skipped__" }).length, 1);

  const real = computeStats(store, { internal: false });
  assert.equal(real.header.pre_locked, 0);
  assert.equal(real.slots.find((x) => x.slot === "trigger").asked, 0);
});

test("근거 위치 찾기와 질문 검증", () => {
  assert.deepEqual(locate("건조해서   바꾸려고요", "건조해서 바꾸려고"), [0, 11]);
  assert.equal(locate("건조해요", "지성"), null);
  assert.deepEqual(validateQuestion("Anua 써보셨어요?", { lang: "ko", stage: "pre_offer", blockedTerms: ["anua"] }), ["blocked_term:anua"]);
  assert.deepEqual(validateQuestion("어떤 결과였나요?", { lang: "ko", stage: "post_offer", blockedTerms: ["anua"] }), []);
  assert.ok(validateQuestion("가".repeat(121), { lang: "ko", stage: "pre_offer" }).includes("too_long"));
});

test("시장마다 뜻이 다른 코드(예산)는 그 시장 라벨로 보여주고, 집계도 시장별 분모로 나눈다", async () => {
  const { store, service } = setup();
  for (const [lang, market] of [["ko", "KR"], ["en", "US"], ["en", "US"]]) {
    let v = await service.start({ lang, market, product_category: "SK-TONER" });
    v = await answerAll(service, v, { budget_band: { kind: "option", codes: ["bud_2"] } });
    const budget = v.summary.pre_offer.find((r) => r.slot === "budget_band").answer;
    assert.equal(budget, market === "KR" ? "1만~2만 원" : "$10–20");
    await service.lock(v.interview.id);
  }
  const s = computeStats(store, { internal: true }).slots.find((x) => x.slot === "budget_band");
  assert.equal(s.codes, undefined); // 시장을 섞은 합계는 내지 않는다
  const kr = s.by_market.find((m) => m.market === "KR");
  const us = s.by_market.find((m) => m.market === "US");
  assert.equal(kr.asked, 1);
  assert.equal(us.asked, 2);
  assert.equal(us.codes.find((c) => c.code === "bud_2").pct, 100);
  assert.equal(us.codes.find((c) => c.code === "bud_2").label, "$10–20");
  assert.equal(evidenceFor(store, { slot: "budget_band", code: "bud_2", market: "US" }).length, 2);
});

test("물음표가 두 개면 한 턴에 두 질문으로 보고 고정 문구로 대체한다", () => {
  assert.ok(validateQuestion("Anything else? Or does it work well?", { lang: "en", stage: "pre_offer" }).includes("multiple_questions"));
  assert.deepEqual(validateQuestion("You said it feels sticky. Anything else?", { lang: "en", stage: "pre_offer" }), []);
});

// 보기형 슬롯마다 먼저 애매한 글 답으로 재질문을 받고, 재질문 턴에서 보기를 누른다(재질문을 최대한 많이 받는 참여자).
async function answerWithProbes(service, view, picks = {}) {
  let v = view;
  let probes = 0;
  for (let i = 0; v.question && i < 60; i++) {
    const q = v.question;
    let payload;
    if (q.type === "scale") payload = { kind: "option", value_num: 4 };
    else if (q.type === "text" || q.type === "text_list") payload = { kind: "text", text: "토너 추천해줘" };
    else if (!q.is_probe) payload = { kind: "text", text: "음 글쎄요" };
    else {
      probes++;
      payload = { kind: "option", codes: picks[q.slot] ?? [q.options[0].code] };
    }
    v = await service.answer(v.interview.id, { turn_id: q.turn_id, ...payload });
  }
  return { v, probes };
}

const ambiguousClaude = () => fakeClaude({
  extract: (input) => ({ slot: input.current_slot.key, status: "ambiguous", codes: [], other_slots: [], probe_question: "어느 쪽에 더 가까우세요?" }),
});

test("재질문은 최대 턴에 세지 않는다: 재질문이 많아도 뒤쪽 필수 슬롯까지 모두 묻는다", async () => {
  const { store, service } = setup(ambiguousClaude());
  const pre = await answerWithProbes(service, await service.start(START), {
    concern_codes: ["skin_unknown", "feel_nonsticky"],
    skin_guide_answer: ["guide_combo"],
    current_status: ["cur_unsatisfied"],
    ai_service: ["ai_chatgpt"],
  });
  assert.equal(pre.v.question, null);
  const preTurns = store.turns(pre.v.interview.id).filter((t) => t.stage === "pre_offer");
  assert.equal(preTurns.filter((t) => !t.is_probe).length, 15); // 조건 슬롯까지 전부 해당하는 최대 경로
  assert.ok(preTurns.length > 18, `재질문 포함 ${preTurns.length}턴`); // 예전 규칙이면 18턴에서 끊겼다
  assert.ok(pre.probes >= 4);

  let v = await service.lock(pre.v.interview.id);
  const rows = store.db.prepare("SELECT slot, status FROM interview_values WHERE interview_id = ? AND stage = 'pre_offer'").all(v.interview.id);
  assert.deepEqual(rows.filter((r) => r.status === "not_asked").map((r) => r.slot), []);
  assert.equal(rows.find((r) => r.slot === "planned_channel").status, "answered");

  v = await service.offer(v.interview.id, { shown: true });
  const post = await answerWithProbes(service, v, { outcome: ["out_bought_other"] });
  assert.equal(post.v.interview.stage, "done");
  assert.equal(post.probes, 3); // outcome·reason_codes·changed_after_offer 재질문 3회 + 슬롯 4개 = 7턴 > 최대 6턴
  const changed = store.db.prepare("SELECT status FROM interview_values WHERE interview_id = ? AND slot = 'changed_after_offer'").get(v.interview.id);
  assert.equal(changed.status, "answered");
});

// 혜택 후 단계의 첫 질문(outcome)까지 진행한다.
async function toOutcome(service, aiAnswer) {
  let v = await answerAll(service, await service.start(START), { ai_service: aiAnswer });
  await service.lock(v.interview.id);
  v = await service.offer(v.interview.id, { shown: false });
  assert.equal(v.question.slot, "outcome");
  return v;
}

test("AI를 쓰지 않았다고 답한 참여자에게는 'AI가 알려준 제품을 샀다' 보기를 숨기고, 눌러도 저장하지 않는다", async () => {
  const codes = (v) => v.question.options.map((o) => o.code);

  const none = setup();
  let v = await toOutcome(none.service, { kind: "option", codes: ["ai_none"] });
  assert.deepEqual(codes(v), ["out_bought_other", "out_not_bought", "out_undecided"]);
  await assert.rejects(
    none.service.answer(v.interview.id, { turn_id: v.question.turn_id, kind: "option", codes: ["out_bought_ai_candidate"] }),
    { status: 400 },
  );

  // AI를 썼거나, AI 질문을 건너뛰어 알 수 없으면 그대로 보여준다.
  for (const aiAnswer of [{ kind: "option", codes: ["ai_chatgpt"] }, { kind: "skip" }]) {
    const { service } = setup();
    v = await toOutcome(service, aiAnswer);
    assert.ok(codes(v).includes("out_bought_ai_candidate"), JSON.stringify(aiAnswer));
  }
});

test("AI 미사용 참여자의 자유 답변을 Claude가 'AI 후보 구매'로 분류해도 확정하지 않는다", async () => {
  const claude = fakeClaude({
    extract: (input) => ({
      slot: input.current_slot.key, status: "clear", other_slots: [], probe_question: null,
      codes: [{ code: "out_bought_ai_candidate", evidence_text: "추천받은 걸 샀어요", rank: null }],
    }),
  });
  const { store, service } = setup(claude);
  let v = await toOutcome(service, { kind: "option", codes: ["ai_none"] });
  v = await service.answer(v.interview.id, { turn_id: v.question.turn_id, kind: "text", text: "추천받은 걸 샀어요" });

  const sent = claude.calls.filter((c) => c.purpose === "extract" && c.input.current_slot.key === "outcome").at(-1);
  assert.ok(!sent.input.current_slot.options.some((o) => o.code === "out_bought_ai_candidate")); // Claude에게도 보기에서 뺀다
  const call = store.db.prepare("SELECT validation_errors_json FROM llm_calls WHERE slot = 'outcome' AND purpose = 'extract'").get();
  assert.match(call.validation_errors_json, /code_not_in_codebook:out_bought_ai_candidate/);

  // 검증에 걸린 분류는 확정하지 않고 한 번 다시 묻는다. 그래도 같으면 검수 대기로 넘긴다.
  assert.equal(v.question.slot, "outcome");
  assert.equal(v.question.is_probe, true);
  v = await service.answer(v.interview.id, { turn_id: v.question.turn_id, kind: "text", text: "추천받은 걸 샀어요" });
  assert.equal(v.question.slot, "reason_codes"); // 확정된 구매 코드가 없으니 실제로 산 제품 질문도 없다
  const outcome = v.summary.post_offer.find((x) => x.slot === "outcome");
  assert.equal(outcome.review_required, true);
});

test("추천 모드: 니즈 슬롯 9개만 묻고 AI 공유 슬롯은 not_asked, 잠그면 confirmed, 혜택 단계 없음", async () => {
  const { store, service } = setup();
  await assert.rejects(service.start({ ...START, mode: "survey" }), { status: 400 });
  let v = await service.start({ ...START, mode: "recommend" });
  assert.equal(v.interview.mode, "recommend");
  v = await answerAll(service, v, {
    concern_codes: { kind: "option", codes: ["skin_oily", "avoid_fragrance"] },
    current_status: { kind: "option", codes: ["cur_unsatisfied"] },
  });
  const turnSlots = store.turns(v.interview.id).map((t) => t.slot);
  assert.deepEqual(turnSlots, ["trigger", "concern_codes", "current_status", "dissatisfaction", "decision_factors", "primary_concern_code", "budget_band", "planned_channel"]);
  v = await service.lock(v.interview.id);
  assert.equal(v.interview.stage, "confirmed");
  await assert.rejects(service.offer(v.interview.id, { shown: true }), { status: 409 });
  const status = Object.fromEntries(store.db.prepare("SELECT slot, status FROM interview_values WHERE interview_id = ?").all(v.interview.id).map((r) => [r.slot, r.status]));
  for (const s of ["ai_service", "ai_question_raw", "ai_candidates_raw", "verify_channels", "intent_scale", "leading_candidate_raw"]) assert.equal(status[s], "not_asked");
  assert.equal(status.planned_channel, "answered");
});

test("추천 모드 인터뷰는 조사 집계와 원문 조회에서 빠지고 건수만 알린다", async () => {
  const { store, service } = setup();
  let r = await answerAll(service, await service.start({ ...START, mode: "recommend" }));
  await service.lock(r.interview.id);
  let s = computeStats(store, { internal: true });
  assert.equal(s.header.started, 0);
  assert.equal(s.header.pre_locked, 0);
  assert.equal(s.header.recommend_excluded, 1);
  assert.equal(s.header.llm.calls, 0);
  assert.equal(s.slots.find((x) => x.slot === "trigger").asked, 0);
  assert.equal(evidenceFor(store, { slot: "trigger" }).length, 0);

  const v = await answerAll(service, await service.start(START)); // 기본값은 조사 모드
  assert.equal(v.interview.mode, "research");
  await service.lock(v.interview.id);
  s = computeStats(store, { internal: true });
  assert.equal(s.header.pre_locked, 1);
  assert.equal(s.slots.find((x) => x.slot === "trigger").asked, 1);
});

test("mode 열이 없던 기존 DB 파일도 열면 research로 채워진다", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const file = join(mkdtempSync(join(tmpdir(), "itv-")), "old.db");
  const old = new DatabaseSync(file);
  old.exec("CREATE TABLE interviews (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, participant_id TEXT NOT NULL, lang TEXT NOT NULL, market TEXT NOT NULL, product_category TEXT NOT NULL, product_category_other TEXT, codebook_version TEXT NOT NULL, model_id TEXT, prompt_hash TEXT, is_internal_test INTEGER NOT NULL, verification_level TEXT NOT NULL, recruitment_channel TEXT NOT NULL, stage TEXT NOT NULL, state_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, pre_locked_at TEXT, offer_shown_at TEXT, post_completed_at TEXT)");
  old.exec("INSERT INTO interviews VALUES ('itv-old','c','p','ko','KR','SK-TONER',NULL,'v0.1',NULL,NULL,1,'self_reported','internal_team','pre_offer','{}','t','t',NULL,NULL,NULL)");
  old.close();
  const store = openStore(file);
  assert.equal(store.getInterview("itv-old").mode, "research");
});
