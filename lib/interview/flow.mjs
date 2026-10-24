// 인터뷰 진행 규칙(순수 함수). 무엇을 물을지는 여기서 정하고, Claude는 문장만 만든다.
// 규칙 원문: docs/interview-guideline.md 3장.
import { ORDER, LIMITS, slotDef, allowedCodes, isOptionSlot, isTextSlot, CODEBOOK_VERSION } from "../codebook.mjs";

const EXCLUSIVE = new Set(["ai_none", "v_none"]); // 다른 보기와 함께 고를 수 없는 "없음" 보기

// 추천 모드(recommendation-spec.md 2.1)에서 묻는 니즈 슬롯. 나머지 pre_offer 슬롯(AI 공유)은 not_asked.
export const RECOMMEND_SLOTS = new Set([
  "trigger", "concern_codes", "skin_guide_answer", "current_status", "dissatisfaction",
  "decision_factors", "primary_concern_code", "budget_band", "planned_channel",
]);
export const MODES = new Set(["research", "recommend"]);
const inMode = (state, slot) => state.mode !== "recommend" || RECOMMEND_SLOTS.has(slot);

export function newState(mode = "research") {
  return {
    mode,
    stage: "pre_offer",
    slots: {},
    probes: {},
    hints: [],
    turns: { pre_offer: 0, post_offer: 0 },
    current: null,
    skin_type_source: null,
    offer_shown: false,
  };
}

const answered = (state, slot) => state.slots[slot]?.status === "answered";
export const codesOf = (state, slot) => (answered(state, slot) ? state.slots[slot].codes.map((c) => c.code) : []);
const usedAi = (s) => codesOf(s, "ai_service").some((c) => c !== "ai_none");

// 조건 슬롯. 앞 순서의 슬롯 값에만 의존한다.
export const CONDITIONS = {
  skin_guide_answer: (s) => codesOf(s, "concern_codes").includes("skin_unknown"),
  dissatisfaction: (s) => codesOf(s, "current_status").includes("cur_unsatisfied"),
  primary_concern_code: (s) => codesOf(s, "concern_codes").length >= 1,
  ai_question_raw: usedAi,
  ai_candidates_raw: usedAi,
  verify_channels: usedAi,
  leading_candidate_raw: (s) => answered(s, "intent_scale") && s.slots.intent_scale.value_num >= 3,
  chosen_product_raw: (s) => codesOf(s, "outcome").some((c) => c.startsWith("out_bought")),
  changed_after_offer: (s) => s.offer_shown,
};

// 최대 턴은 슬롯 질문만 센다. 재질문까지 세면 재질문이 많은 참여자에게서 뒤쪽 필수 슬롯이 not_asked로 빠진다.
const slotTurns = (state, stage) =>
  state.turns[stage] - ORDER[stage].reduce((n, slot) => n + (state.probes[slot] ?? 0), 0);

/** 다음에 물을 슬롯. 고민이 1개면 가장 중요한 고민은 자동으로 채운다. 끝이면 null. */
export function advance(state) {
  const stage = state.stage;
  for (const slot of ORDER[stage]) {
    if (state.slots[slot] || !inMode(state, slot)) continue;
    const cond = CONDITIONS[slot];
    if (cond && !cond(state)) continue;
    if (slot === "primary_concern_code" && codesOf(state, "concern_codes").length === 1) {
      const src = state.slots.concern_codes;
      state.slots[slot] = {
        status: "answered", source: "auto", review_required: src.review_required,
        codes: [{ code: src.codes[0].code, rank: null }],
      };
      continue;
    }
    if (slotTurns(state, stage) >= LIMITS.max_turns[stage]) return null;
    return slot;
  }
  return null;
}

/** 남은 질문 수 추정(조건 슬롯은 지금 상태로 판단). 진행률 표시용. */
export function progress(state) {
  const slots = ORDER[state.stage] ?? [];
  const done = slots.filter((s) => state.slots[s] && state.slots[s].source !== "auto").length;
  const remaining = slots.filter((s) => !state.slots[s] && inMode(state, s) && (!CONDITIONS[s] || CONDITIONS[s](state))).length;
  return { done, total: done + remaining };
}

/** 단계 종료 시 묻지 않은 슬롯을 not_asked로 남긴다(결측과 구분). */
export function finalizeStage(state, stage) {
  for (const slot of ORDER[stage]) state.slots[slot] ??= { status: "not_asked" };
}

/** 보기 클릭 답. 오류 문자열을 반환하면 저장하지 않는다. */
export function applyOption(state, slot, { codes = [], value_num } = {}, ctx, turnId) {
  const def = slotDef(slot);
  if (def.type === "scale") {
    if (!Number.isInteger(value_num) || value_num < def.min || value_num > def.max) return "척도 값이 범위를 벗어났습니다";
    state.slots[slot] = { status: "answered", source: "option", value_num, codes: [], review_required: false, turn_id: turnId };
    return null;
  }
  if (!isOptionSlot(slot)) return "이 질문은 보기로 답할 수 없습니다";
  const allowed = allowedCodes(slot, ctx);
  if (!Array.isArray(codes) || codes.length === 0) return "보기를 하나 이상 골라 주세요";
  if (new Set(codes).size !== codes.length) return "같은 보기가 중복되었습니다";
  for (const c of codes) if (!allowed.has(c)) return `보기에 없는 코드입니다: ${c}`;
  if (def.type === "single" && codes.length !== 1) return "하나만 고를 수 있습니다";
  if (def.type === "rank" && codes.length > def.max_rank) return `최대 ${def.max_rank}개까지 고를 수 있습니다`;
  if (codes.length > 1 && codes.some((c) => EXCLUSIVE.has(c))) return "'없음'은 다른 보기와 함께 고를 수 없습니다";
  state.slots[slot] = {
    status: "answered", source: "option", review_required: false, turn_id: turnId,
    codes: codes.map((code, i) => ({ code, rank: def.type === "rank" ? i + 1 : null })),
  };
  afterAnswer(state, slot, turnId);
  return null;
}

export function applySkip(state, slot, turnId) {
  state.slots[slot] = { status: "skipped", source: "option", codes: [], review_required: false, turn_id: turnId };
}

export function applyText(state, slot, text, turnId) {
  if (!isTextSlot(slot)) throw new Error(`not a text slot: ${slot}`);
  state.slots[slot] = { status: "answered", source: "text", text, codes: [], review_required: false, turn_id: turnId };
}

/**
 * 자유 답변 분류 결과(검증 후)를 반영한다. 애매하고 재질문 여유가 있으면 재질문 문장을 돌려준다.
 * 검증 오류가 있거나 애매한 채로 끝나면 review_required로 저장해 확정 집계에서 뺀다.
 */
export function applyExtraction(state, slot, v, answer, turnId, { canProbe }) {
  for (const h of v.hints) {
    if (!state.hints.some((x) => x.slot === h.slot && x.code === h.code)) state.hints.push(h);
  }
  if (v.status === "no_answer" && v.codes.length === 0) {
    state.slots[slot] = { status: "skipped", source: "llm", text: answer, codes: [], review_required: false, turn_id: turnId };
    return { probe: null };
  }
  const clear = v.status === "clear" && v.codes.length > 0 && v.errors.length === 0;
  if (!clear && canProbe) {
    state.probes[slot] = (state.probes[slot] ?? 0) + 1;
    return { probe: v.probe_question || "" };
  }
  state.slots[slot] = {
    status: "answered", source: "llm", text: answer, review_required: !clear, turn_id: turnId,
    codes: v.codes.map((c) => ({ ...c, turn_id: turnId })),
    validation_errors: v.errors,
  };
  afterAnswer(state, slot, turnId);
  return { probe: null };
}

/** LLM을 쓸 수 없을 때: 원문만 남기고 검수 대기. */
export function applyUnclassified(state, slot, answer, turnId, reason) {
  state.slots[slot] = {
    status: "answered", source: "llm", text: answer, codes: [], review_required: true, turn_id: turnId,
    validation_errors: [reason],
  };
}

export const canProbe = (state, slot, isProbeTurn) => !isProbeTurn && (state.probes[slot] ?? 0) < LIMITS.max_probes_per_slot;

// 피부 타입 출처 기록과 유도 질문 결과 반영(카테고리 명세 3.2).
function afterAnswer(state, slot, turnId) {
  const SKIN = ["skin_dry", "skin_oily", "skin_combo"];
  if (slot === "concern_codes" && state.slots.concern_codes.codes.some((c) => SKIN.includes(c.code))) {
    state.skin_type_source = "self";
  }
  if (slot === "skin_guide_answer") {
    const code = state.slots[slot].codes[0]?.code;
    const mapsTo = slotDef(slot).options.find((o) => o.code === code)?.maps_to;
    const concern = state.slots.concern_codes;
    if (mapsTo && concern && !concern.codes.some((c) => c.code === mapsTo)) {
      concern.codes = concern.codes.map((c) =>
        c.code === "skin_unknown" ? { code: mapsTo, rank: null, source: "guided", turn_id: turnId } : c);
      state.skin_type_source = "guided";
    }
  }
}

/** 상태 → 정량 행(long format). 가이드 6.1. */
export function deriveValues(state, stage, meta) {
  const rows = [];
  const base = (slot, e) => ({
    interview_id: meta.interview_id, stage, slot, status: e.status, turn_id: e.turn_id ?? null,
    codebook_version: CODEBOOK_VERSION, value_code: null, value_num: null, rank: null, value_text: null,
    source: e.source ?? null, evidence_text: null, start_offset: null, end_offset: null,
    review_required: e.review_required ? 1 : 0, review_status: e.review_required ? "pending" : "none",
    model_id: null, prompt_hash: null,
  });
  for (const slot of ORDER[stage]) {
    const e = state.slots[slot] ?? { status: "not_asked" };
    if (e.status !== "answered") { rows.push(base(slot, e)); continue; }
    if (slotDef(slot).type === "scale") { rows.push({ ...base(slot, e), value_num: e.value_num }); continue; }
    if (isTextSlot(slot)) { rows.push({ ...base(slot, e), value_text: e.text }); continue; }
    if (e.codes.length === 0) { rows.push({ ...base(slot, e), value_text: e.text ?? null }); continue; }
    for (const c of e.codes) {
      const source = c.source ?? e.source;
      rows.push({
        ...base(slot, e), value_code: c.code, rank: c.rank ?? null, source, turn_id: c.turn_id ?? e.turn_id ?? null,
        value_text: source === "llm" ? e.text : null,
        evidence_text: c.evidence_text ?? null, start_offset: c.start_offset ?? null, end_offset: c.end_offset ?? null,
        model_id: source === "llm" ? meta.model_id : null, prompt_hash: source === "llm" ? meta.prompt_hash : null,
      });
    }
  }
  return rows;
}
