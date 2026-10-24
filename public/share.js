// 구매 과정 공유 갈래: 대화 붙여넣기 → 간단 질문(피부 타입·사용한 AI) → 결과(산 제품·만족도 / 사지 않은 이유).
// 보기는 코드북(docs/interview-guideline.md 3.1)과 concerns.js를 따른다. Claude 호출은 하지 않는다.
import { ALL_CONCERNS, SKIN_GUIDE } from "./concerns.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const LANG = "ko";

// 피부 타입 보기. 민감한 편은 다른 피부 타입과 함께 고를 수 있다.
const SKIN = ALL_CONCERNS.filter((c) => c.code.startsWith("skin_"));
const skinOf = (code) => SKIN.find((c) => c.code === code);
const BOUGHT = new Set(["out_bought_ai_candidate", "out_bought_other"]);

export const share = {
  excerpt: "",
  // 간단 질문
  skin: null, sensitive: false, skinSource: null, guideAnswer: null,
  ai: new Set(), aiOther: "",
  // 결과
  outcome: null, chosen: "", satisfaction: null, boughtNote: "",
  reasons: new Set(), reasonText: "",
};

let book;
let onChange = () => {};

const label = (opt) => opt[LANG] ?? opt.en ?? opt.code;
export const bought = () => BOUGHT.has(share.outcome);

export async function initShare(changed) {
  onChange = changed;
  book = (await (await fetch("/codebook.json")).json());
  renderAbout();
  renderResult();
  bind();
  return book.codebook_version;
}

function chipsHTML(options, selected, name) {
  return options.map((o) => `<button type="button" class="chip" data-${name}="${o.code}"
    aria-pressed="${selected(o.code)}"><span class="chip-label">${esc(label(o))}</span></button>`).join("");
}

/* ---------- 간단 질문 ---------- */

function renderAbout() {
  $("skin").innerHTML = SKIN.map((c) => {
    const on = c.code === "skin_sensitive" ? share.sensitive : share.skin === c.code;
    const guided = on && share.skinSource === "guided" && c.code !== "skin_unknown" && c.code !== "skin_sensitive";
    return `<button type="button" class="chip" data-concern="${c.code}" aria-pressed="${on}">
      <span class="chip-label">${c.ko}</span><span class="chip-sub">${guided ? "질문으로 골랐어요" : c.sub}</span>
    </button>`;
  }).join("");
  // 잘 모름을 고르면 유도 질문을 보여준다. 답하면 결과 피부 타입으로 바뀌고, 다시 고를 수 있게 남겨 둔다.
  const open = share.skin === "skin_unknown" || share.skinSource === "guided";
  $("skin-guide").innerHTML = !open ? "" : `<div class="guide" role="group" aria-labelledby="guide-q">
    <p class="guide-q" id="guide-q">${SKIN_GUIDE.question}</p>
    <div class="guide-answers">
      ${SKIN_GUIDE.answers.map((a) => `
        <button type="button" class="guide-answer" data-guide="${a.code}" aria-pressed="${share.guideAnswer === a.code}">
          ${a.text}<span class="guide-result">${a.result === "skin_unknown" ? "잘 모름으로 둘게요" : skinOf(a.result).ko}</span>
        </button>`).join("")}
    </div>
    <p class="guide-note">피부 진단이 아니라, 고르기 쉽게 돕는 질문이에요.</p>
  </div>`;
  // 대화를 붙여 넣었으니 "사용하지 않음"은 보여주지 않는다
  const ais = book.slots.ai_service.options.filter((o) => o.code !== "ai_none");
  $("ai-service").innerHTML = chipsHTML(ais, (c) => share.ai.has(c), "ai");
  $("ai-other-wrap").hidden = !share.ai.has("ai_other");
}

function pickSkin(code) {
  if (code === "skin_sensitive") share.sensitive = !share.sensitive;
  else if (share.skin === code) { share.skin = null; share.skinSource = null; share.guideAnswer = null; }
  else { share.skin = code; share.skinSource = "self"; share.guideAnswer = null; }
}

function answerGuide(code) {
  share.skin = SKIN_GUIDE.answers.find((a) => a.code === code).result;
  share.skinSource = "guided";
  share.guideAnswer = code;
}

export function aboutProblem() {
  if (!share.skin) return "피부 타입을 골라 주세요";
  if (!share.ai.size) return "대화를 나눈 AI를 골라 주세요";
  if (share.ai.has("ai_other") && !share.aiOther) return "어떤 AI였는지 적어 주세요";
  return null;
}

/* ---------- 결과 ---------- */

function renderResult() {
  const s = book.slots;
  $("outcome").innerHTML = s.outcome.options.map((o) => `
    <button type="button" role="radio" class="primary-option" data-outcome="${o.code}" aria-checked="${share.outcome === o.code}">
      ${esc(label(o))}
    </button>`).join("");
  $("bought").hidden = !bought();
  $("not-bought").hidden = !share.outcome || bought();
  $("reason-title").textContent = share.outcome === "out_undecided" ? "아직 사지 않은 이유는?" : "사지 않은 이유는?";
  $("reasons").innerHTML = chipsHTML(s.reason_codes.options, (c) => share.reasons.has(c), "reason");
  $("reason-text-hint").textContent = share.reasons.has("r_other")
    ? "기타를 골랐다면 어떤 이유였는지 적어 주세요."
    : "무엇이 걸렸는지, 대신 어떻게 할 생각인지 편하게 적어 주세요. (선택)";
  renderSatisfaction();
}

function renderSatisfaction() {
  const sl = book.slots.satisfaction;
  const items = [];
  for (let n = sl.min; n <= sl.max; n++) {
    items.push(`<button type="button" role="radio" class="scale-point" data-scale="${n}" aria-checked="${share.satisfaction === n}">
      <span class="scale-num">${n}</span><span class="scale-label">${sl.labels[n] ? esc(sl.labels[n][LANG]) : ""}</span>
    </button>`);
  }
  $("satisfaction-scale").innerHTML = items.join("");
}

export function resultProblem() {
  if (!share.outcome) return "결국 어떻게 했는지 골라 주세요";
  if (bought()) {
    if (!share.chosen) return "산 제품 이름을 적어 주세요";
    if (share.satisfaction === null) return "만족도를 골라 주세요";
    return null;
  }
  if (!share.reasons.size) return "사지 않은 이유를 하나 이상 골라 주세요";
  if (share.reasons.has("r_other") && !share.reasonText) return "기타 이유를 적어 주세요";
  return null;
}

/* ---------- 입력 ---------- */

// 개인정보로 보이는 문자열을 알려 주기만 한다. 자동으로 지우지 않는다.
function piiCheck(text) {
  const found = [];
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) found.push("이메일");
  if (/(\+?\d{1,3}[-\s]?)?0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/.test(text)) found.push("전화번호");
  if (/(주문\s?번호|注文番号)\s*[:：]?\s*\w+/.test(text)) found.push("주문번호");
  $("pii-warning").hidden = !found.length;
  $("pii-warning").textContent = found.length ? `${found.join("·")}처럼 보이는 내용이 있어요. 가리거나 지워 주세요.` : "";
}

function bind() {
  $("step-about").addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    const d = t.dataset;
    if (d.concern) pickSkin(d.concern);
    else if (d.guide) answerGuide(d.guide);
    else if (d.ai) { if (share.ai.has(d.ai)) share.ai.delete(d.ai); else share.ai.add(d.ai); }
    else return;
    renderAbout();
    onChange();
  });
  $("ai-other").addEventListener("input", (e) => { share.aiOther = e.target.value.trim(); onChange(); });

  $("step-result").addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    const d = t.dataset;
    if (d.outcome) share.outcome = d.outcome;
    else if (d.scale) share.satisfaction = Number(d.scale);
    else if (d.reason) { if (share.reasons.has(d.reason)) share.reasons.delete(d.reason); else share.reasons.add(d.reason); }
    else return;
    renderResult();
    onChange();
  });
  $("chosen-product").addEventListener("input", (e) => { share.chosen = e.target.value.trim(); onChange(); });
  $("bought-note").addEventListener("input", (e) => { share.boughtNote = e.target.value.trim(); });
  $("reason-text").addEventListener("input", (e) => { share.reasonText = e.target.value.trim(); onChange(); });

  $("ai-excerpt").addEventListener("input", (e) => {
    share.excerpt = e.target.value;
    piiCheck(e.target.value);
    $("paste-count").textContent = `${e.target.value.length.toLocaleString()} / 8,000자`;
    onChange();
  });
}

// 대화 붙여넣기 단계. 짧은 메모가 아니라 대화 원문이 들어오도록 최소 길이를 둔다.
export const PASTE_MIN = 20;
export function pasteProblem() {
  const len = share.excerpt.trim().length;
  if (!len) return "대화를 붙여 넣어 주세요";
  if (len < PASTE_MIN) return `조금 더 붙여 넣어 주세요 (${PASTE_MIN}자 이상)`;
  if (!$("pii-warning").hidden) return "개인정보처럼 보이는 내용을 가려 주세요";
  return null;
}

/* ---------- 저장 ---------- */

// 지침 6.1 long format 행. 화면에서 묻지 않은 슬롯은 not_asked, 물었지만 비운 칸은 skipped.
const row = (slot, extra) => ({ slot, value_code: null, value_num: null, rank: null, value_text: null,
  status: "answered", source: "option", ...extra });
const notAsked = (slot) => row(slot, { status: "not_asked", source: null });

// 혜택 노출 전(pre_offer) 기록: 피부 타입·사용한 AI. 대화 원문은 raw_content로 따로 둔다.
export function preOfferSlots(productRow) {
  const skinCodes = [share.skin, ...(share.sensitive ? ["skin_sensitive"] : [])];
  return [
    productRow,
    ...skinCodes.map((c) => row("concern_codes", { value_code: c })),
    share.skinSource === "guided" ? row("skin_guide_answer", { value_code: share.guideAnswer }) : notAsked("skin_guide_answer"),
    ...[...share.ai].map((c) => row("ai_service", { value_code: c, value_text: c === "ai_other" ? share.aiOther : null })),
    ...["trigger", "current_status", "dissatisfaction", "decision_factors", "primary_concern_code", "budget_band",
      "ai_question_raw", "ai_candidates_raw", "verify_channels", "intent_scale", "leading_candidate_raw", "planned_channel"].map(notAsked),
  ];
}

export function preOfferRecord() {
  const codes = [share.skin, ...(share.sensitive ? ["skin_sensitive"] : [])];
  return {
    concern_codes: codes,
    intent_ids: [...new Set(codes.map((c) => skinOf(c).intent).filter(Boolean))].sort(),
    skin_type_source: share.skinSource,
    skin_guide_answer: share.skinSource === "guided" ? share.guideAnswer : null,
    ai_service: [...share.ai],
  };
}

// 혜택 노출 후(post_offer) 기록: 결과·산 제품·만족도 또는 사지 않은 이유.
// 이 화면은 혜택을 보여주지 않으므로 changed_after_offer는 not_asked다.
export function postOfferSlots() {
  const rows = [row("outcome", { value_code: share.outcome })];
  if (bought()) {
    rows.push(row("chosen_product_raw", { value_text: share.chosen, source: null }));
    rows.push(row("satisfaction", { value_num: share.satisfaction, value_text: share.boughtNote || null }));
    rows.push(notAsked("reason_codes"));
  } else {
    rows.push(notAsked("chosen_product_raw"), notAsked("satisfaction"));
    for (const code of share.reasons) rows.push(row("reason_codes", { value_code: code }));
  }
  rows.push(notAsked("changed_after_offer"));
  return rows;
}

export function postOfferRecord() {
  return {
    outcome: share.outcome,
    chosen_product_raw: bought() ? share.chosen : null,
    satisfaction: bought() ? share.satisfaction : null,
    reason_text: (bought() ? share.boughtNote : share.reasonText) || null,
    offer_shown_at: null,
  };
}

// 확인 화면용 요약 [제목, 값] 목록
export function shareSummary() {
  const s = book.slots;
  const name = (slot, code) => label(s[slot].options.find((o) => o.code === code));
  const skin = [skinOf(share.skin).ko, ...(share.sensitive ? ["민감한 편"] : [])].join(", ");
  const out = [
    ["붙여 넣은 대화", `${share.excerpt.trim().length.toLocaleString()}자`],
    ["피부 타입", share.skinSource === "guided" ? `${skin} (질문으로 고름)` : skin],
    ["대화를 나눈 AI", [...share.ai].map((c) => c === "ai_other" ? `기타(${share.aiOther})` : name("ai_service", c)).join(", ")],
    ["결과", name("outcome", share.outcome)],
  ];
  if (bought()) {
    const sl = s.satisfaction.labels[share.satisfaction];
    out.push(["산 제품", share.chosen]);
    out.push(["만족도", `${share.satisfaction} / ${s.satisfaction.max}${sl ? ` (${sl[LANG]})` : ""}`]);
    out.push(["좋았던 점·아쉬운 점", share.boughtNote || "적지 않음"]);
  } else {
    out.push(["사지 않은 이유", [...share.reasons].map((c) => name("reason_codes", c)).join(", ")]);
    out.push(["자세한 이유", share.reasonText || "적지 않음"]);
  }
  return out;
}

export function setShareLocked(locked) {
  for (const id of ["step-about", "step-result"]) {
    $(id).querySelectorAll("button, input, textarea").forEach((el) => (el.disabled = locked));
  }
  $("ai-excerpt").disabled = locked;
}
