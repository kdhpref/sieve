// 추천 질문 조립(recommendation-spec.md 2.2–2.3). 코드로 확정된 조건만 쓰고, Claude가 질문을 새로 쓰지 않는다.
// 같은 조건이면 같은 질문이 나온다(prompt_hash로 확인).
import { createHash } from "node:crypto";
import { codeLabel, intentIdOf } from "../codebook.mjs";

export const TEMPLATE_VERSION = "rec-q-v0.1";

// 착수 문서 12장 질문집 본문(구매 의도 ID별). 브랜드 화면의 의도 표시에도 쓴다.
export const INTENTS = {
  "01": { ko: "민감한 피부를 고려한 제품을 비교해줘.", en: "Compare products suited to sensitive skin." },
  "02": { ko: "향료를 피하고 싶은 사람이 성분표를 확인하며 고를 제품을 비교해줘.", en: "Compare products someone avoiding fragrance can choose by checking the ingredient list." },
  "03": { ko: "에탄올을 피하고 싶은 사람이 성분표를 확인하며 고를 제품을 비교해줘.", en: "Compare products someone avoiding alcohol (ethanol) can choose by checking the ingredient list." },
  "04": { ko: "건조한 피부를 위한 보습 중심 제품을 비교해줘.", en: "Compare hydration-focused products for dry skin." },
  "05": { ko: "끈적임이 적은 사용감을 원하는 사람에게 맞는 제품을 비교해줘.", en: "Compare products for people who want a non-sticky feel." },
  "06": { ko: "지성 피부를 고려한 가벼운 사용감의 제품을 비교해줘.", en: "Compare lightweight products suited to oily skin." },
  "07": { ko: "복합성 피부를 고려한 제품을 비교해줘.", en: "Compare products suited to combination skin." },
  "08": { ko: "화장 전에 쓰기 좋은 제품을 비교해줘.", en: "Compare products that work well before makeup." },
  "09": { ko: "저녁 스킨케어에서 보습용으로 쓸 제품을 비교해줘.", en: "Compare products for hydration in an evening skincare routine." },
  "10": { ko: "스킨케어를 처음 시작하는 사람이 비교하기 쉬운 제품을 알려줘.", en: "Recommend products that are easy to compare for someone new to skincare." },
  "11": { ko: "용량당 가격을 기준으로 비교해줘. 확인일과 판매처도 알려줘.", en: "Compare by price per volume, and include the date checked and the seller." },
  "12": { ko: "작은 용량으로 먼저 사용해볼 수 있는 제품을 비교해줘.", en: "Compare products available in a small trial size." },
  "13": { ko: "리필 또는 대용량 선택지가 있는 제품을 비교해줘.", en: "Compare products that offer a refill or large-size option." },
  "14": { ko: "공식 판매처와 배송 정보를 확인할 수 있는 제품을 비교해줘.", en: "Compare products whose official seller and shipping information can be checked." },
  "15": { ko: "전성분과 사용법을 현지 언어로 확인하기 쉬운 제품을 비교해줘.", en: "Compare products whose full ingredients and directions are easy to read in English." },
};

const NOUN = {
  "SK-TONER": { ko: "토너", en: "toners" },
  "SK-PAD": { ko: "토너패드", en: "toner pads" },
};

const PREFIX = {
  KR: { ko: (n) => `한국에서 구매할 수 있는 한국 브랜드 ${n} 중에서`, en: (n) => `Among Korean-brand ${n} available to buy in Korea,` },
  US: { ko: (n) => `미국에서 구매할 수 있는 한국 브랜드 ${n} 중에서`, en: (n) => `Among Korean-brand ${n} available to buy in the US,` },
};

const SUFFIX = {
  ko: "후보 3개와 비교 이유를 알려줘. 각 후보의 현재 가격과 판매처, 확인한 날짜, 판매 페이지 주소도 알려줘.",
  en: "Name 3 candidates and explain why you compared them. For each, include the current price, the seller, the date checked, and the product page URL.",
};

// 조건 템플릿. 피부 타입·피할 성분·사용감은 고민 코드, 예산·구매처는 코드북 표시명을 그대로 쓴다.
const SKIN = new Set(["skin_sensitive", "skin_dry", "skin_oily", "skin_combo"]);
const AVOID = new Set(["avoid_fragrance", "avoid_ethanol"]);
const FEEL = new Set(["feel_nonsticky", "feel_light"]);
// 고민 보기 표시명("향료를 피하고 싶음")은 문장에 넣으면 겹치므로 성분 이름만 쓴다
const AVOID_LABEL = { avoid_fragrance: { ko: "향료", en: "fragrance" }, avoid_ethanol: { ko: "에탄올", en: "alcohol (ethanol)" } };
const T = {
  skin: { ko: (l) => `피부 타입: ${l}.`, en: (l) => `Skin type: ${l}.` },
  avoid: { ko: (l) => `피하고 싶은 것: ${l}.`, en: (l) => `I want to avoid: ${l}.` },
  feel: { ko: (l) => `원하는 사용감: ${l}.`, en: (l) => `Preferred feel: ${l}.` },
  budget: { ko: (l) => `1개 예산: ${l}.`, en: (l) => `Budget for one product: ${l}.` },
  channel: { ko: (l) => `${l}에서 살 생각이야.`, en: (l) => `I plan to buy at ${l}.` },
};

/** 확정 코드만: 답했고 검수 대기가 아닌 값 */
function confirmedCodes(state, slot) {
  const e = state.slots[slot];
  if (!e || e.status !== "answered" || e.review_required) return [];
  return e.codes.map((c) => c.code);
}

export function buildQuery(itv) {
  const { lang, market, state } = itv;
  const noun = NOUN[itv.product_category]?.[lang]
    ?? (String(itv.product_category_other ?? "").slice(0, 40) || (lang === "en" ? "skincare products" : "스킨케어 제품"));
  const concerns = confirmedCodes(state, "concern_codes");
  const primary = confirmedCodes(state, "primary_concern_code")[0] ?? null;
  const intentId = primary ? intentIdOf(primary) : null;
  // 시장별 코드(예산·구매처)는 시장 라벨로 쓴다. 미국 예산 라벨은 영어뿐이라 ko 화면에서도 그대로 보인다.
  const label = (slot, code) => codeLabel(slot, code, lang, market);

  const conditions = [];
  const parts = [];
  const group = (set, key) => {
    const codes = concerns.filter((c) => set.has(c));
    if (!codes.length) return;
    codes.forEach((c) => conditions.push({ slot: "concern_codes", code: c, label: label("concern_codes", c) }));
    parts.push(T[key][lang](codes.map((c) => AVOID_LABEL[c]?.[lang] ?? label("concern_codes", c)).join(", ")));
  };
  group(SKIN, "skin");
  group(AVOID, "avoid");
  group(FEEL, "feel");
  const budget = confirmedCodes(state, "budget_band")[0];
  if (budget && budget !== "bud_none") {
    conditions.push({ slot: "budget_band", code: budget, label: label("budget_band", budget) });
    parts.push(T.budget[lang](label("budget_band", budget)));
  }
  const channel = confirmedCodes(state, "planned_channel")[0];
  if (channel && !["ch_undecided", "ch_other"].includes(channel)) {
    conditions.push({ slot: "planned_channel", code: channel, label: label("planned_channel", channel) });
    parts.push(T.channel[lang](label("planned_channel", channel)));
  }
  // 대표 고민이 피부 타입·성분·사용감 조건에 이미 있으면 따로 넣지 않는다(화면 중복 방지)
  if (primary && !conditions.some((c) => c.code === primary)) conditions.unshift({ slot: "primary_concern_code", code: primary, label: label("concern_codes", primary) });

  const head = PREFIX[market][lang](noun);
  const body = intentId ? INTENTS[intentId][lang] : "";
  const question_text = [lang === "en" ? `${head} ${body.charAt(0).toLowerCase()}${body.slice(1)}` : `${head} ${body}`, ...parts, SUFFIX[lang]]
    .map((s) => s.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ");
  const prompt_hash = createHash("sha256").update(`${TEMPLATE_VERSION}\n${question_text}`).digest("hex").slice(0, 16);
  return { question_text, intent_id: intentId, conditions, template_version: TEMPLATE_VERSION, prompt_hash, search_country: market };
}
