import { GROUPS, CATEGORY_VERSION } from "./categories.js";
import { CONCERN_GROUPS, ALL_CONCERNS, SKIN_GUIDE, TONER_ATTRS } from "./concerns.js";
import { productSVG } from "./illustrations.js";
import { startRecommend, bindRecommend } from "./recommend.js";
import { share, initShare, pasteProblem, shareProblem, shareSlots, shareSummary, setShareLocked } from "./share.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const allItems = GROUPS.flatMap((g) => g.items);
const concernOf = (code) => ALL_CONCERNS.find((c) => c.code === code);
// 직접 적은 고민은 적은 내용으로 보여준다
const concernLabel = (code) => (concernOf(code).free && state.freeText[code]) || concernOf(code).ko;

// 제품 종류를 고른 뒤 두 갈래로 나뉜다. 각 갈래의 화면 순서.
const FLOWS = {
  share: [["product", "제품 종류"], ["paste", "대화 붙여넣기"], ["concern", "원래 고민"], ["share", "AI 답 정리"], ["confirm", "확인"]],
  recommend: [["product", "제품 종류"], ["recommend", "제품 추천"]],
};
const VIEWS = ["product", "paste", "recommend", "concern", "share", "confirm"];

const state = {
  view: "product", path: null, locked: false,
  // 1단계
  group: "SK", code: null, otherText: "",
  // 2단계
  concerns: new Set(), freeText: {}, primary: null, primaryChosen: false,
  skinSource: null, guideAnswer: null, attrs: {},
};

// 받침 있는 글자 뒤에는 "을", 없으면 "를"
function objectParticle(word) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 ? "을" : "를";
}

function pickedName() {
  if (state.code === "OTHER") return state.otherText;
  return allItems.find((i) => i.code === state.code)?.ko ?? "";
}

/* ---------- 1단계: 제품 종류 ---------- */

function renderGroups() {
  $("groups").innerHTML = GROUPS.map((g) => {
    const open = g.items.some((i) => i.active);
    return `<button type="button" class="group" data-group="${g.code}" aria-pressed="${g.code === state.group}">
      ${g.ko}${open ? "" : `<span class="soon">준비 중</span>`}
    </button>`;
  }).join("");
}

function renderShelf() {
  const group = GROUPS.find((g) => g.code === state.group);
  $("shelf").innerHTML = group.items.map((item) => `
    <button type="button" role="radio" class="item" data-code="${item.code}"
        aria-checked="${item.code === state.code}" ${item.active ? "" : `aria-disabled="true" tabindex="-1"`}>
      ${productSVG(item)}
      <span class="name">${item.ko}</span>
      <span class="name-en" lang="en">${item.en}</span>
      ${item.active ? "" : `<span class="soon">준비 중</span>`}
    </button>`).join("");
}

function selectProduct(code) {
  state.code = code;
  if (code !== "OTHER") $("other").open = false;
  renderShelf();
  renderDock();
}

$("groups").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-group]");
  if (!btn) return;
  state.group = btn.dataset.group;
  renderGroups();
  renderShelf();
});

$("shelf").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-code]");
  if (!btn || btn.getAttribute("aria-disabled") === "true") return;
  selectProduct(btn.dataset.code);
});

$("other").addEventListener("toggle", () => {
  if ($("other").open) selectProduct("OTHER");
  else if (state.code === "OTHER") selectProduct(null);
});

$("other-text").addEventListener("input", (e) => {
  state.otherText = e.target.value.trim();
  renderDock();
});

/* ---------- 2단계: 원래 고민 ---------- */

function renderConcernHeader() {
  const item = allItems.find((i) => i.code === state.code);
  $("picked-product").innerHTML = item ? productSVG(item, "-picked") : "";
  const name = pickedName();
  $("concern-title").innerHTML = `${esc(name)}${objectParticle(name)} 고를 때<br>무엇이 중요했나요?`;
}

function chip(c) {
  const on = state.concerns.has(c.code);
  const guided = c.skinType && on && state.skinSource === "guided" && c.code !== "skin_unknown";
  return `<button type="button" class="chip" data-concern="${c.code}" aria-pressed="${on}">
    <span class="chip-label">${c.ko}</span>
    ${c.sub ? `<span class="chip-sub">${guided ? "질문으로 골랐어요" : c.sub}</span>` : ""}
  </button>`;
}

function renderConcerns() {
  $("concerns").innerHTML = CONCERN_GROUPS.map((g, gi) => {
    const free = g.items.filter((c) => c.free && state.concerns.has(c.code));
    return `<section class="block">
      <h2>${g.ko}</h2>
      ${g.hint ? `<p class="hint">${g.hint}</p>` : ""}
      <div class="chips ${gi === 0 ? "chips-skin" : ""}">${g.items.map(chip).join("")}</div>
      ${gi === 0 ? guideHTML() : ""}
      ${free.map((c) => `
        <label class="free"><span>${c.free}</span>
          <input type="text" maxlength="60" data-free="${c.code}" value="${esc(state.freeText[c.code] ?? "")}">
        </label>`).join("")}
    </section>`;
  }).join("");
}

// 잘 모름을 고르면 유도 질문을 보여준다. 답하면 결과 피부 타입으로 바뀌고, 다시 고를 수 있게 남겨 둔다.
function guideHTML() {
  const open = state.concerns.has("skin_unknown") || state.skinSource === "guided";
  if (!open) return "";
  return `<div class="guide" role="group" aria-labelledby="guide-q">
    <p class="guide-q" id="guide-q">${SKIN_GUIDE.question}</p>
    <div class="guide-answers">
      ${SKIN_GUIDE.answers.map((a) => `
        <button type="button" class="guide-answer" data-guide="${a.code}" aria-pressed="${state.guideAnswer === a.code}">
          ${a.text}<span class="guide-result">${a.result === "skin_unknown" ? "잘 모름으로 둘게요" : concernOf(a.result).ko}</span>
        </button>`).join("")}
    </div>
    <p class="guide-note">피부 진단이 아니라, 고르기 쉽게 돕는 질문이에요.</p>
  </div>`;
}

function renderPrimary() {
  const picked = [...state.concerns];
  // 고민이 하나면 자동으로 정하고, 둘 이상이면 참여자가 직접 고른 경우에만 유지한다
  if (!state.concerns.has(state.primary)) state.primaryChosen = false;
  if (picked.length === 1) { state.primary = picked[0]; state.primaryChosen = false; }
  else if (!state.primaryChosen) state.primary = null;
  $("primary-block").hidden = picked.length < 2;
  $("primary").innerHTML = picked.map((code) => `
    <button type="button" role="radio" class="primary-option" data-primary="${code}" aria-checked="${state.primary === code}">
      ${esc(concernLabel(code))}
    </button>`).join("");
}

function renderAttrs() {
  const toner = ["SK-TONER", "SK-PAD"].includes(state.code);
  $("attrs").hidden = !toner;
  $("attr-list").innerHTML = TONER_ATTRS.map((a) => `
    <div class="attr"><h3>${a.ko}</h3><div class="chips">
      ${a.values.map(([v, ko]) => `<button type="button" class="chip chip-small" data-attr="${a.key}" data-value="${v}"
        aria-pressed="${state.attrs[a.key] === v}"><span class="chip-label">${ko}</span></button>`).join("")}
    </div></div>`).join("");
}

function renderStep2() {
  renderConcerns();
  renderPrimary();
  renderDock();
}

function toggleConcern(code) {
  const c = concernOf(code);
  if (state.concerns.has(code)) {
    state.concerns.delete(code);
    if (c.skinType) { state.skinSource = null; state.guideAnswer = null; }
  } else {
    if (c.skinType) {
      for (const s of ALL_CONCERNS) if (s.skinType) state.concerns.delete(s.code);
      state.skinSource = "self";
      state.guideAnswer = null;
    }
    state.concerns.add(code);
  }
  renderStep2();
}

function answerGuide(code) {
  const answer = SKIN_GUIDE.answers.find((a) => a.code === code);
  for (const s of ALL_CONCERNS) if (s.skinType) state.concerns.delete(s.code);
  state.concerns.add(answer.result);
  state.skinSource = "guided";
  state.guideAnswer = code;
  renderStep2();
}

$("concerns").addEventListener("click", (e) => {
  const chipBtn = e.target.closest("[data-concern]");
  if (chipBtn) return toggleConcern(chipBtn.dataset.concern);
  const guideBtn = e.target.closest("[data-guide]");
  if (guideBtn) answerGuide(guideBtn.dataset.guide);
});

$("concerns").addEventListener("input", (e) => {
  const code = e.target.dataset.free;
  if (!code) return;
  state.freeText[code] = e.target.value.trim();
  renderPrimary();
  renderDock();
});

$("primary").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-primary]");
  if (!btn) return;
  state.primary = btn.dataset.primary;
  state.primaryChosen = true;
  renderPrimary();
  renderDock();
});

$("attr-list").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-attr]");
  if (!btn) return;
  const { attr, value } = btn.dataset;
  if (state.attrs[attr] === value) delete state.attrs[attr];
  else state.attrs[attr] = value;
  renderAttrs();
});

/* ---------- 공통: 단계 이동과 하단 바 ---------- */

function step2Problem() {
  if (state.concerns.size === 0) return "고민을 하나 이상 골라 주세요";
  for (const code of state.concerns) {
    if (concernOf(code).free && !state.freeText[code]) return "직접 적는 칸을 채워 주세요";
  }
  if (!state.primary) return "가장 중요했던 고민을 골라 주세요";
  return null;
}

const flow = () => FLOWS[state.path ?? "share"];

function productReady() {
  return Boolean(allItems.some((i) => i.code === state.code) || (state.code === "OTHER" && state.otherText));
}

function setNext(text, problem) {
  $("next").hidden = false;
  $("next").textContent = text;
  $("next").disabled = Boolean(problem);
}

function renderDock() {
  const v = state.view;
  $("next-alt").hidden = v !== "product";
  if (v === "product") {
    const item = allItems.find((i) => i.code === state.code);
    const other = state.code === "OTHER";
    $("picked").textContent = item ? `${item.ko}${objectParticle(item.ko)} 골랐어요`
      : other ? (state.otherText ? `직접 입력: ${state.otherText}` : "어떤 제품인지 적어 주세요")
      : "제품 종류를 먼저 골라 주세요";
    setNext("구매 과정 공유하기", !productReady());
    $("next-alt").disabled = !productReady();
  } else if (v === "paste") {
    const problem = pasteProblem();
    $("picked").textContent = problem ?? `${share.excerpt.trim().length.toLocaleString()}자 붙여 넣었어요`;
    setNext("다음: 원래 고민", problem);
  } else if (v === "concern") {
    const problem = step2Problem();
    $("picked").textContent = problem
      ?? `고민 ${state.concerns.size}개, 가장 중요한 것은 ${concernLabel(state.primary)}`;
    setNext("다음: AI 답 정리", problem);
  } else if (v === "share") {
    const problem = shareProblem();
    $("picked").textContent = problem ?? "필수 항목을 모두 채웠어요";
    setNext("다음: 확인하기", problem);
  } else if (v === "recommend") {
    $("picked").textContent = "";
    $("next").hidden = true;
  } else {
    $("picked").textContent = state.locked ? "기록이 잠겼어요" : $("consent").checked ? "확인하면 잠겨요" : "동의에 체크해 주세요";
    setNext(state.locked ? "잠김" : "확인하고 잠그기", state.locked || !$("consent").checked);
  }
  $("back").hidden = v === "product" || state.locked;
}

function renderSteps() {
  const steps = flow();
  const at = steps.findIndex(([v]) => v === state.view);
  $("steps").innerHTML = steps.map(([, ko], i) =>
    `<li class="${i === at ? "is-current" : i < at ? "is-done" : ""}" ${i === at ? `aria-current="step"` : ""}>${ko}</li>`).join("");
}

function renderRecommend() {
  const item = allItems.find((i) => i.code === state.code);
  $("recommend-product").innerHTML = item ? productSVG(item, "-rec") : "";
  const name = pickedName();
  $("recommend-title").innerHTML = `${esc(name)} 추천을 위해<br>몇 가지 여쭤볼게요`;
  const lang = document.querySelector('.lang-switch [aria-pressed="true"]')?.lang === "en" ? "en" : "ko";
  startRecommend({
    product: { code: state.code, other: state.code === "OTHER" ? state.otherText : null },
    productLabel: name, lang,
  });
}

function goTo(view) {
  state.view = view;
  for (const v of VIEWS) $(`step-${v}`).hidden = v !== view;
  renderSteps();
  document.title = `Sieve: ${flow().find(([v]) => v === view)?.[1] ?? ""}`;
  if (view === "concern") { renderConcernHeader(); renderAttrs(); renderStep2(); }
  if (view === "recommend") renderRecommend();
  if (view === "confirm" && !state.locked) renderSummary();
  renderDock();
  window.scrollTo({ top: 0 });
  $(`step-${view}`).querySelector("h1")?.focus({ preventScroll: true });
}

// 두 갈래 모두 제품 종류를 남긴다. interview.html도 이 키를 읽는다.
function choosePath(path) {
  state.path = path;
  localStorage.setItem("sieve.step1", JSON.stringify({
    category_version: CATEGORY_VERSION,
    product_category: state.code,
    product_category_other: state.code === "OTHER" ? state.otherText : null,
    path,
    is_internal_test: true,
  }));
  goTo(path === "share" ? "paste" : "recommend");
}

// 저장 필드는 명세 4.1을 따른다. intent_ids는 선택값에서 파생한다.
function step2Record() {
  const codes = [...state.concerns];
  const hasSkin = codes.some((c) => concernOf(c).skinType);
  return {
    category_version: CATEGORY_VERSION,
    product_category: state.code,
    product_category_other: state.code === "OTHER" ? state.otherText : null,
    product_attrs: { ...state.attrs },
    concern_codes: codes,
    // 자유 입력은 선택지 코드별로 둔다. 고르지 않은 칸은 저장하지 않는다.
    concern_other_text: Object.fromEntries(
      codes.filter((c) => concernOf(c).free && state.freeText[c]).map((c) => [c, state.freeText[c]])),
    primary_concern_code: state.primary,
    intent_ids: [...new Set(codes.map((c) => concernOf(c).intent).filter(Boolean))].sort(),
    primary_intent_id: concernOf(state.primary).intent,
    skin_type_source: hasSkin ? state.skinSource : null,
    skin_guide_answer: hasSkin ? state.guideAnswer : null,
    is_internal_test: true,
  };
}

/* ---------- 4단계: 확인과 잠금 ---------- */

// 지침 3.1 슬롯 중 아직 화면이 없는 것. 결측(skipped)과 구분해 not_asked로 남긴다.
const SLOTS_WITHOUT_SCREEN = ["trigger", "current_status", "dissatisfaction", "decision_factors", "budget_band"];

function step2Slots() {
  const r = step2Record();
  const row = (slot, extra) => ({ slot, value_code: null, value_num: null, rank: null, value_text: null,
    status: "answered", source: "option", ...extra });
  return [
    row("product_category", { value_code: r.product_category, value_text: r.product_category_other }),
    ...r.concern_codes.map((c) => row("concern_codes", { value_code: c, value_text: r.concern_other_text[c] ?? null })),
    r.skin_type_source === "guided"
      ? row("skin_guide_answer", { value_code: r.skin_guide_answer })
      : row("skin_guide_answer", { status: "not_asked", source: null }),
    row("primary_concern_code", { value_code: r.primary_concern_code }),
    ...SLOTS_WITHOUT_SCREEN.map((slot) => row(slot, { status: "not_asked", source: null })),
  ];
}

function summaryRows() {
  const r = step2Record();
  const concerns = r.concern_codes.map(concernLabel).join(", ");
  const rows = [
    ["찾던 제품", pickedName()],
    ["원래 고민", concerns],
    ["가장 중요했던 고민", concernLabel(r.primary_concern_code)],
    ...shareSummary(),
  ];
  return rows;
}

function renderSummary(rows = summaryRows()) {
  $("summary").innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function lockPreOffer() {
  const body = {
    stage: "pre_offer",
    is_internal_test: true,
    verification_level: "self_reported",
    codebook_version: state.codebookVersion,
    ...step2Record(),
    raw_content: share.excerpt.trim(),
    slots: [...step2Slots(), ...shareSlots()],
    consented_at: new Date().toISOString(),
  };
  const locked_at = new Date().toISOString();
  const record = { ...body, locked_at, sha256: await sha256(JSON.stringify(body)) };
  localStorage.setItem("sieve.pre_offer.locked", JSON.stringify(record));
  // 화면 복원용 요약. 기록 본문(해시 대상)과 분리해 둔다.
  localStorage.setItem("sieve.pre_offer.locked.summary", JSON.stringify(summaryRows()));
  localStorage.removeItem("sieve.pre_offer.draft");
  showLocked(record);
}

function showLocked(record) {
  state.locked = true;
  setShareLocked(true);
  $("consent-wrap").hidden = true;
  $("locked").hidden = false;
  $("confirm-title").textContent = "기록을 잠갔어요";
  $("confirm-lead").textContent = "이제 이 기록은 고칠 수 없어요. 다음 단계에서 혜택을 보더라도 지금 기록은 그대로 남아요.";
  const at = new Date(record.locked_at).toLocaleString("ko-KR");
  $("locked-stamp").textContent = `${at} 잠김 · 확인값 ${record.sha256.slice(0, 12)}`;
  renderDock();
}

$("next").addEventListener("click", async () => {
  if (state.view === "product") return choosePath("share");
  if (state.view !== "confirm") {
    if (state.view === "concern") localStorage.setItem("sieve.pre_offer.draft", JSON.stringify(step2Record()));
    const steps = flow();
    return goTo(steps[steps.findIndex(([v]) => v === state.view) + 1][0]);
  }
  $("next").disabled = true;
  await lockPreOffer();
});

$("next-alt").addEventListener("click", () => choosePath("recommend"));
$("to-share").addEventListener("click", () => choosePath("share"));
bindRecommend(renderRecommend);

$("back").addEventListener("click", () => {
  const steps = flow();
  goTo(steps[steps.findIndex(([v]) => v === state.view) - 1][0]);
});
$("consent").addEventListener("change", renderDock);
$("restart").addEventListener("click", () => {
  localStorage.removeItem("sieve.pre_offer.locked");
  localStorage.removeItem("sieve.pre_offer.locked.summary");
  location.reload();
});

document.querySelectorAll(".page h1").forEach((h) => h.setAttribute("tabindex", "-1"));

// 언어 스위치: 아직 표시만 바꾸고 화면 문구는 번역하지 않는다.
document.querySelector(".lang-switch").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  for (const b of e.currentTarget.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === btn));
});
renderGroups();
renderShelf();
state.codebookVersion = await initShare(renderDock);
goTo("product");

// 잠긴 기록이 있으면 확인 화면을 잠긴 상태로 연다. 잠긴 기록은 화면에서 고칠 수 없다.
const saved = localStorage.getItem("sieve.pre_offer.locked");
if (saved) {
  state.path = "share";
  state.locked = true;
  goTo("confirm");
  renderSummary(JSON.parse(localStorage.getItem("sieve.pre_offer.locked.summary") ?? "[]"));
  showLocked(JSON.parse(saved));
}
