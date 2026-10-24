import { GROUPS, CATEGORY_VERSION } from "./categories.js";
import { productSVG } from "./illustrations.js";
import { startRecommend, bindRecommend } from "./recommend.js";
import { share, initShare, pasteProblem, aboutProblem, resultProblem, preOfferSlots, preOfferRecord,
  postOfferSlots, postOfferRecord, shareSummary, setShareLocked } from "./share.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const allItems = GROUPS.flatMap((g) => g.items);

// 제품 종류를 고른 뒤 두 갈래로 나뉜다. 각 갈래의 화면 순서.
const FLOWS = {
  share: [["product", "제품 종류"], ["paste", "대화 붙여넣기"], ["about", "간단 질문"], ["result", "결과"], ["confirm", "확인"]],
  recommend: [["product", "제품 종류"], ["recommend", "제품 추천"]],
};
const VIEWS = ["product", "paste", "recommend", "about", "result", "confirm"];

const state = {
  view: "product", path: null, locked: false,
  group: "SK", code: null, otherText: "",
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

/* ---------- 공통: 단계 이동과 하단 바 ---------- */

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
    setNext("다음: 간단 질문", problem);
  } else if (v === "about") {
    const problem = aboutProblem();
    $("picked").textContent = problem ?? "다 골랐어요";
    setNext("다음: 무엇을 샀나요", problem);
  } else if (v === "result") {
    const problem = resultProblem();
    $("picked").textContent = problem ?? "필수 항목을 모두 채웠어요";
    setNext("다음: 확인하기", problem);
  } else if (v === "recommend") {
    $("picked").textContent = "";
    $("next").hidden = true;
  } else {
    $("picked").textContent = state.locked ? "제출했어요" : $("consent").checked ? "제출하면 잠겨요" : "동의에 체크해 주세요";
    setNext(state.locked ? "제출 완료" : "확인하고 제출하기", state.locked || !$("consent").checked);
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
  if (view === "about") {
    const item = allItems.find((i) => i.code === state.code);
    $("picked-product").innerHTML = item ? productSVG(item, "-picked") : "";
  }
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

function productFields() {
  return {
    category_version: CATEGORY_VERSION,
    product_category: state.code,
    product_category_other: state.code === "OTHER" ? state.otherText : null,
  };
}

/* ---------- 확인과 제출 ---------- */

function summaryRows() {
  return [["찾던 제품", pickedName()], ...shareSummary()];
}

function renderSummary(rows = summaryRows()) {
  $("summary").innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 혜택 노출 전(pre_offer)을 먼저 잠그고, 그 확인값을 붙여 결과(post_offer)를 저장한다.
// 이 화면은 혜택을 보여주지 않으므로 offer_shown_at은 null이다.
async function submit() {
  const consented_at = new Date().toISOString();
  const common = { is_internal_test: true, verification_level: "self_reported", codebook_version: state.codebookVersion };
  const p = productFields();
  const productRow = { slot: "product_category", value_code: p.product_category, value_num: null, rank: null,
    value_text: p.product_category_other, status: "answered", source: "option" };
  const preBody = { stage: "pre_offer", ...common, ...p, ...preOfferRecord(),
    raw_content: share.excerpt.trim(), slots: preOfferSlots(productRow), consented_at };
  const pre = { ...preBody, locked_at: new Date().toISOString(), sha256: await sha256(JSON.stringify(preBody)) };
  const postBody = { stage: "post_offer", ...common, pre_offer_sha256: pre.sha256, ...postOfferRecord(), slots: postOfferSlots() };
  const post = { ...postBody, submitted_at: new Date().toISOString(), sha256: await sha256(JSON.stringify(postBody)) };
  localStorage.setItem("sieve.pre_offer.locked", JSON.stringify(pre));
  localStorage.setItem("sieve.post_offer", JSON.stringify(post));
  // 화면 복원용 요약. 기록 본문(해시 대상)과 분리해 둔다.
  localStorage.setItem("sieve.pre_offer.locked.summary", JSON.stringify(summaryRows()));
  showLocked(pre);
}

function showLocked(record) {
  state.locked = true;
  setShareLocked(true);
  $("consent-wrap").hidden = true;
  $("locked").hidden = false;
  $("confirm-title").textContent = "제출했어요, 고마워요";
  $("confirm-lead").textContent = "이제 이 기록은 고칠 수 없어요.";
  const at = new Date(record.locked_at).toLocaleString("ko-KR");
  $("locked-stamp").textContent = `${at} 제출 · 확인값 ${record.sha256.slice(0, 12)}`;
  renderDock();
}

$("next").addEventListener("click", async () => {
  if (state.view === "product") return choosePath("share");
  if (state.view !== "confirm") {
    const steps = flow();
    return goTo(steps[steps.findIndex(([v]) => v === state.view) + 1][0]);
  }
  $("next").disabled = true;
  await submit();
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
  localStorage.removeItem("sieve.post_offer");
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
