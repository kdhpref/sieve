// 인터뷰 진행 서비스: 순서 결정(flow) → 질문 문장 생성(Claude 또는 고정 문구) → 답 분류·검증 → 저장.
import { randomBytes } from "node:crypto";
import { ORDER, slotDef, optionsFor, isOptionSlot, isTextSlot, fallbackQuestion, codeLabel, SLOT_TITLES, CODEBOOK_VERSION } from "../codebook.mjs";
import * as F from "./flow.mjs";
import { validateExtraction, validateQuestion } from "./validate.mjs";
import { PROMPT_HASH } from "./claude.mjs";

// 카테고리 명세 2.1: P0에서 고를 수 있는 제품 유형
const ACTIVE_CATEGORIES = new Set(["SK-TONER", "SK-PAD", "OTHER"]);
const LANGS = new Set(["ko", "en"]);
const MARKETS = new Set(["KR", "US"]);
const MAX_ANSWER_CHARS = 1000;
// 문구 자체가 측정 정의인 슬롯은 Claude가 바꿔 말하지 않게 고정 문구만 쓴다.
// changed_after_offer: "혜택 안내를 본 뒤"가 빠지면 다른 질문이 된다(시스템 프롬프트는 혜택 언급을 금지한다).
// skin_guide_answer: 카테고리 명세 3.2의 유도 질문 원문.
const FIXED_WORDING = new Set(["changed_after_offer", "skin_guide_answer"]);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const newId = (prefix) => `${prefix}-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
const nowIso = () => new Date().toISOString();

export function createInterviewService({ store, claude, blockedTerms = [] }) {
  // 같은 인터뷰의 요청은 순서대로 처리한다(Claude 호출 중 중복 클릭 방지).
  const queues = new Map();
  function serial(key, fn) {
    const run = (queues.get(key) ?? Promise.resolve()).then(fn);
    queues.set(key, run.catch(() => {}));
    return run;
  }

  const ctxOf = (itv) => ({ market: itv.market, lang: itv.lang, state: itv.state });

  function load(id) {
    const itv = typeof id === "string" ? store.getInterview(id) : null;
    if (!itv) throw new HttpError(404, "인터뷰를 찾을 수 없습니다");
    return itv;
  }

  function slotForPrompt(slot, ctx) {
    const def = slotDef(slot);
    return { key: slot, type: def.type, max_rank: def.max_rank ?? null, options: isTextSlot(slot) ? [] : optionsFor(slot, ctx) };
  }

  function answerLabel(slot, e, lang, market) {
    if (!e || e.status === "not_asked") return null;
    if (e.status === "skipped") return lang === "en" ? "No answer" : "응답 안 함";
    if (slotDef(slot).type === "scale") return `${e.value_num} / ${slotDef(slot).max}`;
    if (isTextSlot(slot)) return e.text;
    if (e.codes.length === 0) return e.text ?? "";
    return e.codes.map((c) => (c.rank ? `${c.rank}. ` : "") + codeLabel(slot, c.code, lang, market)).join(", ");
  }

  function recentTurns(itv, n = 2) {
    return store.turns(itv.id).filter((t) => t.answered_at).slice(-n).map((t) => ({
      question: t.question_text,
      answer: t.answer_text ?? (t.answer_kind === "skip" ? "(건너뜀)"
        : answerLabel(t.slot, itv.state.slots[t.slot], itv.lang, itv.market) ?? ""),
    }));
  }

  function logCall(itv, { turnId = null, slot, purpose, input, res, validationErrors = [] }) {
    store.insertLlmCall({
      interview_id: itv.id, turn_id: turnId, slot, purpose, model_id: res.model_id, prompt_hash: PROMPT_HASH,
      input_json: JSON.stringify(input), raw_response_json: res.raw ? JSON.stringify(res.raw) : null,
      usage_json: res.usage ? JSON.stringify(res.usage) : null, cost_usd: res.cost_usd, latency_ms: res.latency_ms,
      stop_reason: res.stop_reason, error: res.error, validation_errors_json: JSON.stringify(validationErrors),
    });
  }

  async function makeQuestion(itv, slot, probeText) {
    const { lang, state } = itv;
    const checks = { lang, stage: state.stage, blockedTerms };
    if (probeText !== undefined) {
      if (validateQuestion(probeText, checks).length === 0) return { text: probeText.trim(), source: "llm" };
      return { text: fallbackQuestion(slot, lang), source: "fallback" };
    }
    if (FIXED_WORDING.has(slot)) return { text: fallbackQuestion(slot, lang), source: "fixed" };
    if (claude) {
      const ctx = ctxOf(itv);
      const input = {
        purpose: "question", lang, market: itv.market, stage: state.stage, product_category: itv.product_category,
        next_slot: { ...slotForPrompt(slot, ctx), fallback_question: fallbackQuestion(slot, lang) },
        filled: ORDER[state.stage].filter((s) => state.slots[s]?.status === "answered")
          .map((s) => ({ slot: s, answer: answerLabel(s, state.slots[s], lang, itv.market) })),
        recent_turns: recentTurns(itv),
        hints: state.hints.filter((h) => h.slot === slot)
          .map((h) => ({ code: h.code, label: codeLabel(slot, h.code, lang, itv.market), evidence_text: h.evidence_text })),
      };
      const res = await claude.call("question", input);
      const errors = res.ok ? [...(res.data.slot === slot ? [] : ["slot_mismatch"]), ...validateQuestion(res.data.text, checks)] : [];
      logCall(itv, { slot, purpose: "question", input, res, validationErrors: errors });
      if (res.ok && errors.length === 0) return { text: res.data.text.trim(), source: "llm" };
    }
    return { text: fallbackQuestion(slot, lang), source: "fallback" };
  }

  async function askNext(itv, probeText) {
    const state = itv.state;
    const isProbe = probeText !== undefined;
    const slot = isProbe ? state.current.slot : F.advance(state);
    if (!slot) { state.current = null; return; }
    const q = await makeQuestion(itv, slot, probeText);
    const turnNo = ++state.turns[state.stage];
    const turnId = store.insertTurn({
      interview_id: itv.id, stage: state.stage, slot, turn_no: turnNo, is_probe: isProbe ? 1 : 0,
      question_text: q.text, question_source: q.source,
    });
    state.current = { turn_id: turnId, slot, text: q.text, source: q.source, is_probe: isProbe };
  }

  function summary(itv, stage) {
    return ORDER[stage]
      .filter((s) => itv.state.slots[s] && itv.state.slots[s].status !== "not_asked")
      .map((s) => {
        const e = itv.state.slots[s];
        return { slot: s, title: SLOT_TITLES[s], status: e.status, source: e.source, answer: answerLabel(s, e, itv.lang, itv.market), review_required: Boolean(e.review_required) };
      });
  }

  function view(itv) {
    const { state } = itv;
    const cur = state.current;
    let question = null;
    if (cur) {
      const def = slotDef(cur.slot);
      question = {
        turn_id: cur.turn_id, slot: cur.slot, title: SLOT_TITLES[cur.slot], type: def.type, text: cur.text,
        source: cur.source, is_probe: cur.is_probe, options: isTextSlot(cur.slot) ? [] : optionsFor(cur.slot, ctxOf(itv)),
        max_rank: def.max_rank ?? null, allow_text: def.type !== "scale", allow_skip: true,
      };
    }
    return {
      interview: {
        id: itv.id, stage: itv.stage, lang: itv.lang, market: itv.market, product_category: itv.product_category,
        product_category_other: itv.product_category_other, is_internal_test: Boolean(itv.is_internal_test),
        verification_level: itv.verification_level, codebook_version: itv.codebook_version, created_at: itv.created_at,
        pre_locked_at: itv.pre_locked_at, offer_shown_at: itv.offer_shown_at, post_completed_at: itv.post_completed_at,
      },
      question,
      progress: ["pre_offer", "post_offer"].includes(itv.stage) ? F.progress(state) : null,
      summary: { pre_offer: summary(itv, "pre_offer"), post_offer: summary(itv, "post_offer") },
      llm: { available: Boolean(claude), model: claude?.model ?? null },
    };
  }

  return {
    async start({ lang, market, product_category, product_category_other } = {}) {
      if (!LANGS.has(lang)) throw new HttpError(400, "lang은 ko 또는 en입니다");
      if (!MARKETS.has(market)) throw new HttpError(400, "market은 KR 또는 US입니다");
      if (!ACTIVE_CATEGORIES.has(product_category)) throw new HttpError(400, "선택할 수 없는 제품 유형입니다");
      const other = product_category === "OTHER" ? String(product_category_other ?? "").trim().slice(0, 40) : null;
      if (product_category === "OTHER" && !other) throw new HttpError(400, "기타 제품 유형을 적어 주세요");

      const itv = {
        id: newId("itv"), campaign_id: "cmp-internal-demo", participant_id: newId("pt"),
        lang, market, product_category, product_category_other: other,
        codebook_version: CODEBOOK_VERSION, model_id: claude?.model ?? null, prompt_hash: PROMPT_HASH,
        is_internal_test: 1, verification_level: "self_reported", recruitment_channel: "internal_team",
        stage: "pre_offer", state: F.newState(),
      };
      const { state, ...row } = itv;
      store.createInterview({ ...row, state_json: state });
      await askNext(itv);
      store.updateInterview(itv.id, { state: itv.state });
      return view(load(itv.id));
    },

    get(id) {
      return view(load(id));
    },

    turns(id) {
      load(id);
      return store.turns(id);
    },

    answer(id, payload = {}) {
      return serial(id, async () => {
        const itv = load(id);
        const state = itv.state;
        if (!["pre_offer", "post_offer"].includes(itv.stage)) throw new HttpError(409, "지금은 답을 받을 수 없는 단계입니다");
        const cur = state.current;
        if (!cur || cur.turn_id !== payload.turn_id) throw new HttpError(409, "이미 처리했거나 현재 질문이 아닙니다");
        const slot = cur.slot;
        const def = slotDef(slot);
        const ctx = ctxOf(itv);
        let probeText;

        const record = (fields) => {
          if (!store.answerTurn(cur.turn_id, fields)) throw new HttpError(409, "이미 답한 질문입니다");
        };

        if (payload.kind === "skip") {
          record({ answer_kind: "skip" });
          F.applySkip(state, slot, cur.turn_id);
        } else if (payload.kind === "option") {
          const value_num = payload.value_num == null ? undefined : Number(payload.value_num);
          const err = F.applyOption(state, slot, { codes: payload.codes ?? [], value_num }, ctx, cur.turn_id);
          if (err) throw new HttpError(400, err);
          record({ answer_kind: "option", answer_codes: payload.codes ?? [], answer_value_num: value_num });
        } else if (payload.kind === "text") {
          const text = String(payload.text ?? "").normalize("NFC").trim();
          if (!text) throw new HttpError(400, "답을 적어 주세요");
          if (text.length > MAX_ANSWER_CHARS) throw new HttpError(400, `${MAX_ANSWER_CHARS}자 이내로 적어 주세요`);
          if (def.type === "scale") throw new HttpError(400, "이 질문은 숫자로 골라 주세요");
          record({ answer_kind: "text", answer_text: text });
          if (isTextSlot(slot)) F.applyText(state, slot, text, cur.turn_id);
          else if (!claude) F.applyUnclassified(state, slot, text, cur.turn_id, "llm_unavailable");
          else {
            const futureSlots = ORDER[state.stage].filter((s) => s !== slot && !state.slots[s] && isOptionSlot(s));
            const input = {
              purpose: "extract", lang: itv.lang, market: itv.market, stage: state.stage, product_category: itv.product_category,
              current_slot: slotForPrompt(slot, ctx), last_question: cur.text, last_answer: text,
              future_slots: futureSlots.map((s) => slotForPrompt(s, ctx)),
            };
            const res = await claude.call("extract", input);
            if (!res.ok) {
              logCall(itv, { turnId: cur.turn_id, slot, purpose: "extract", input, res });
              F.applyUnclassified(state, slot, text, cur.turn_id, res.error);
            } else {
              const v = validateExtraction(res.data, { slot, answer: text, ctx, futureSlots });
              logCall(itv, { turnId: cur.turn_id, slot, purpose: "extract", input, res, validationErrors: v.errors });
              const r = F.applyExtraction(state, slot, v, text, cur.turn_id, { canProbe: F.canProbe(state, slot, cur.is_probe) });
              if (r.probe !== null) probeText = r.probe;
            }
          }
        } else throw new HttpError(400, "kind는 option, text, skip 중 하나입니다");

        await askNext(itv, probeText);

        if (!state.current && state.stage === "post_offer") {
          F.finalizeStage(state, "post_offer");
          const rows = F.deriveValues(state, "post_offer", { interview_id: itv.id, model_id: itv.model_id, prompt_hash: itv.prompt_hash });
          store.transaction(() => {
            store.insertValues(rows);
            store.updateInterview(itv.id, { stage: "done", post_completed_at: nowIso(), state });
          });
        } else store.updateInterview(itv.id, { state });
        return view(load(id));
      });
    },

    /** pre_offer 잠금. 이후 pre_offer 답은 바꿀 수 없고, 정량 행이 이때 만들어진다. */
    lock(id) {
      return serial(id, async () => {
        const itv = load(id);
        if (itv.stage !== "pre_offer" || itv.pre_locked_at) throw new HttpError(409, "이미 잠긴 기록입니다");
        if (itv.state.current) throw new HttpError(409, "아직 답하지 않은 질문이 있습니다");
        F.finalizeStage(itv.state, "pre_offer");
        const rows = F.deriveValues(itv.state, "pre_offer", { interview_id: itv.id, model_id: itv.model_id, prompt_hash: itv.prompt_hash });
        store.transaction(() => {
          store.insertValues(rows);
          store.updateInterview(itv.id, { stage: "offer", pre_locked_at: nowIso(), state: itv.state });
        });
        return view(load(id));
      });
    },

    /** 혜택 안내 단계. 잠금 전에는 호출할 수 없다(post_offer는 pre_offer 없이 저장되지 않음). */
    offer(id, { shown } = {}) {
      return serial(id, async () => {
        const itv = load(id);
        if (itv.stage !== "offer") throw new HttpError(409, "혜택 전 기록을 먼저 잠가야 합니다");
        itv.state.offer_shown = Boolean(shown);
        itv.state.stage = "post_offer";
        await askNext(itv);
        store.updateInterview(itv.id, { stage: "post_offer", offer_shown_at: shown ? nowIso() : null, state: itv.state });
        return view(load(id));
      });
    },
  };
}
