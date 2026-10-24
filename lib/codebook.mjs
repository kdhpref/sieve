// 인터뷰 코드북(data/interview-codebook-v0.1.json) 조회. 슬롯 정의는 docs/interview-guideline.md 3장.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CB = JSON.parse(readFileSync(join(import.meta.dirname, "..", "data", "interview-codebook-v0.1.json"), "utf8"));

export const CODEBOOK_VERSION = CB.codebook_version;
export const ORDER = CB.order;
export const LIMITS = CB.limits;
export const STAGES = ["pre_offer", "post_offer"];

const OPTION_TYPES = new Set(["single", "multi", "rank"]);

export function slotDef(slot) {
  const def = CB.slots[slot];
  if (!def) throw new Error(`unknown slot: ${slot}`);
  return def;
}

export const isOptionSlot = (slot) => OPTION_TYPES.has(slotDef(slot).type);
export const isTextSlot = (slot) => ["text", "text_list"].includes(slotDef(slot).type);

const labelOf = (opt, lang) => opt[lang] ?? opt.ko ?? opt.en ?? opt.code;

/** 참여자에게 보여줄 보기. primary_concern_code는 앞에서 고른 고민 코드만 보기로 쓴다. */
export function optionsFor(slot, { market, lang, state } = {}) {
  const def = slotDef(slot);
  let opts;
  if (def.options_by_market) opts = def.options_by_market[market] ?? [];
  else if (slot === "primary_concern_code") {
    const picked = new Set((state?.slots?.concern_codes?.codes ?? []).map((c) => c.code));
    opts = slotDef("concern_codes").options.filter((o) => picked.has(o.code));
  } else if (def.type === "scale") {
    opts = [];
    for (let n = def.min; n <= def.max; n++) opts.push({ code: String(n), ...(def.labels?.[n] ?? {}) });
  } else opts = def.options ?? [];
  return opts.map((o) => ({ code: o.code, label: labelOf(o, lang) }));
}

export const allowedCodes = (slot, ctx) => new Set(optionsFor(slot, ctx).map((o) => o.code));

/** 시장마다 같은 코드가 다른 뜻인 슬롯(예: bud_2 = 1만~2만 원 / $10–20). 집계는 시장별로 나눈다. */
export const isMarketSlot = (slot) => Boolean(slotDef(slot).options_by_market);
export const marketsOf = (slot) => Object.keys(slotDef(slot).options_by_market ?? {});
export const marketOptionCodes = (slot, market) => (slotDef(slot).options_by_market?.[market] ?? []).map((o) => o.code);

/** 화면 표시용 라벨. 시장별 보기는 market의 보기에서 찾는다(없으면 코드 그대로). */
export function codeLabel(slot, code, lang = "ko", market = null) {
  const def = slotDef(slot);
  const src = slot === "primary_concern_code" ? slotDef("concern_codes") : def;
  const pools = src.options_by_market
    ? (market ? [src.options_by_market[market] ?? []] : Object.values(src.options_by_market))
    : [src.options ?? []];
  for (const pool of pools) {
    const opt = pool.find((o) => o.code === code);
    if (opt) return labelOf(opt, lang);
  }
  return code;
}

/** 고민 코드 → 질문집 구매 의도 ID (카테고리 명세 3장). */
export function intentIdOf(concernCode) {
  return slotDef("concern_codes").options.find((o) => o.code === concernCode)?.intent_id ?? null;
}

export function fallbackQuestion(slot, lang) {
  const q = slotDef(slot).fallback_question;
  return q[lang] ?? q.ko;
}

export const SLOT_TITLES = {
  trigger: "찾게 된 계기", concern_codes: "피부·사용 고민", skin_guide_answer: "피부 타입 유도 질문",
  current_status: "지금 쓰는 제품", dissatisfaction: "지금 제품의 아쉬운 점", decision_factors: "고를 때 중요한 기준",
  primary_concern_code: "가장 중요한 고민", budget_band: "1개 예산", ai_service: "사용한 AI",
  ai_question_raw: "AI에 한 질문(원문)", ai_candidates_raw: "AI 추천 후보(원문)", verify_channels: "AI 답 이후 확인한 곳",
  intent_scale: "2주 안 구매 가능성", leading_candidate_raw: "가장 마음이 가는 후보(원문)", planned_channel: "살 곳",
  outcome: "최종 결과", chosen_product_raw: "실제로 산 제품(원문)", reason_codes: "결정 이유", changed_after_offer: "혜택 후 선택 변경",
};
