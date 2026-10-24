// 제품 추천 갈래: docs/interview-guideline.md 기준 인터뷰를 채팅 + 버튼으로 진행한다.
// 질문 순서·문장·분류는 서버(/api/interviews)가 정한다. 화면 규칙:
//   보기가 4개 이하면 버튼으로도 답할 수 있고, 5개 이상이면 글로만 답한다(서버가 Claude로 코드 분류).
import { t } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const MAX_BUTTONS = 4;
const STORE_KEY = "sieve.recommend";

let session = null; // { id, product, log: [{who, text}] }
let current = null; // 서버가 준 현재 질문
let picked = new Set(); // 복수 선택 버튼
let busy = false;
let stage = null; // 서버 인터뷰 단계: pre_offer(대화 중·확인 대기) → confirmed(조건 확정)

// 순위 질문은 버튼으로 순서를 매기기 어려워 글로만 받는다
const canUseButtons = (q) => q && q.type !== "rank" && q.options.length > 0 && q.options.length <= MAX_BUTTONS;

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(session));
}

function say(who, text) {
  session.log.push({ who, text });
  save();
  renderLog();
}

function renderLog(pending = false) {
  $("chat-log").innerHTML = session.log.map((m) => `
    <li class="bubble ${m.who === "me" ? "from-me" : m.who === "note" ? "from-note" : "from-ai"}">${esc(m.text)}</li>`).join("")
    + (pending ? `<li class="bubble from-ai typing" aria-label="${t("typing")}"><span></span><span></span><span></span></li>` : "");
  $("chat-log").lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function renderInput() {
  const q = current;
  // 질문이 끝나면 조건 확정 버튼만 보여준다(명세 2.2: 확인을 받은 뒤 확정)
  if (!q && stage === "pre_offer") {
    $("composer").hidden = true;
    $("chat-skip").hidden = true;
    $("chat-options").innerHTML = `<button type="button" class="send" id="confirm-conditions" ${busy ? "disabled" : ""}>${t("confirmConditions")}</button>`;
    return;
  }
  const open = Boolean(q) && !busy;
  $("composer").hidden = !q;
  $("chat-skip").hidden = !q;
  $("chat-input").disabled = !open;
  $("chat-send").disabled = !open;
  $("chat-input").placeholder = !q ? "" : q.type === "scale"
    ? t("scalePh", q.options[0].code, q.options.at(-1).code)
    : canUseButtons(q) ? t("buttonOrType") : t("typeFree");

  if (!canUseButtons(q)) { $("chat-options").innerHTML = ""; return; }
  const multi = q.type === "multi";
  $("chat-options").innerHTML = q.options.map((o) => `
    <button type="button" class="chip" data-option="${esc(o.code)}" ${open ? "" : "disabled"}
      aria-pressed="${picked.has(o.code)}"><span class="chip-label">${esc(o.label ?? o.code)}</span></button>`).join("")
    + (multi ? `<button type="button" class="send send-picked" id="send-picked" ${open && picked.size ? "" : "disabled"}>${t("sendPicked")}</button>` : "");
}

function showError(msg) {
  $("chat-error").hidden = !msg;
  $("chat-error").textContent = msg ?? "";
}

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? t("requestFailed", res.status));
  return data;
}

// 서버 응답을 반영한다. 질문이 끝나면 요약을 보여준다.
function apply(view) {
  current = view.question;
  stage = view.interview.stage;
  picked = new Set();
  if (current) say("ai", current.text);
  else finish(view);
}

function finish(view) {
  const rows = (view.summary?.pre_offer ?? []).filter((r) => r.status === "answered");
  const lines = rows.map((r) => `${r.title}: ${r.answer}`).join("\n");
  say("ai", t("summaryIntro", lines));
}

async function confirmConditions() {
  if (busy) return;
  busy = true;
  showError(null);
  renderInput();
  try {
    const view = await api(`/api/interviews/${session.id}/lock`, {});
    stage = view.interview.stage;
    say("me", t("confirmedMe"));
    say("note", t("confirmedNote"));
  } catch (err) {
    showError(t("pressAgain", err.message));
  } finally {
    busy = false;
    renderInput();
  }
  if (stage === "confirmed") requestRecommendation();
}

// ---------- 추천 결과 (recommendation-spec.md 2.4–3장) ----------
const POLL_MS = 2500;
const FAILURES = {
  search_failed: "failSearch",
  timeout: "failTimeout",
  search_not_used: "failNoSearch",
  no_verified_candidates: "failNoCandidates",
  analysis_failed: "failAnalysis",
  interrupted: "failInterrupted",
  error: "failError",
};
let pollTimer = null;
let lastResult = null; // 언어가 바뀌면 다시 그릴 마지막 결과 화면: () => void

const safeHref = (u) => { try { return ["http:", "https:"].includes(new URL(u).protocol) ? u : null; } catch { return null; } };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const day = (iso) => (iso ? iso.slice(0, 10) : "");

function showResult(html) {
  $("rec-result").hidden = false;
  $("rec-result").innerHTML = html;
}

const failHTML = (msg) => `<div class="rec-fail"><p>${esc(msg)}</p><button type="button" class="send" data-rec="retry">${t("retry")}</button></div>`;

async function requestRecommendation() {
  clearTimeout(pollTimer);
  lastResult = () => showResult(`<p class="rec-loading">${t("recStarting")}</p>`);
  lastResult();
  try {
    const rec = await api("/api/recommendations", { interview_id: session.id });
    session.recId = rec.id;
    save();
    renderRecommendation(rec);
  } catch (err) {
    lastResult = () => showResult(failHTML(err.message));
    lastResult();
  }
}

async function poll() {
  try {
    renderRecommendation(await api(`/api/recommendations/${session.recId}`));
  } catch (err) {
    lastResult = () => showResult(failHTML(err.message));
    lastResult();
  }
}

function renderCard(c, rec) {
  const buy = c.buy && safeHref(c.buy.url);
  const img = c.image && safeHref(c.image.url);
  const p = c.price;
  const priceNote = p ? [p.seller && t("seller", esc(p.seller)), p.checked_date_text ? t("checkedOn", esc(p.checked_date_text)) : t("collectedOn", day(rec.collection.collected_at))]
    .filter(Boolean).join(" · ") : "";
  return `
    <li class="rec-card">
      <div class="rec-photo">
        <span class="rec-pos" title="${t("orderTitle")}">${c.explicit_rank ?? c.position}</span>
        ${img ? `<img src="${esc(img)}" alt="${esc(t("photoAlt", c.product_name))}" loading="lazy" referrerpolicy="no-referrer">` : `<span class="no-photo">${t("noPhoto")}</span>`}
      </div>
      <div class="rec-body">
        ${c.brand ? `<p class="rec-brand">${esc(c.brand)}</p>` : ""}
        <h3 class="rec-name">${esc(c.product_name)}</h3>
        <p class="rec-price">${p ? `<strong>${esc(p.text)}</strong><small>${priceNote} · ${t("priceNote")}</small>` : `<small>${t("noPrice")}</small>`}</p>
        <p class="rec-reason">${esc(c.reason_text)}</p>
        ${c.unverified_text ? `<p class="rec-unverified">${t("unverified", esc(c.unverified_text))}</p>` : ""}
        ${c.verified === false ? `<p class="rec-badge">${t("notVerified")}</p>` : ""}
        ${buy ? `<a class="rec-buy${c.buy.kind === "store_search" ? " is-search" : ""}" href="${esc(buy)}" target="_blank" rel="noopener noreferrer nofollow">${c.buy.kind === "store_search" ? t("searchAt", esc(host(buy))) : t("buyAt", esc(host(buy)))}</a>`
          : `<p class="rec-nobuy">${t("noBuy")}</p>`}
        ${c.sources.length ? `<ul class="rec-sources">${c.sources.map((s) => `<li>${t("source")}: <a href="${esc(safeHref(s.url) ?? "#")}" target="_blank" rel="noopener noreferrer nofollow">${esc(s.title || host(s.url))}</a></li>`).join("")}</ul>` : ""}
      </div>
    </li>`;
}

function renderRecommendation(rec) {
  clearTimeout(pollTimer);
  lastResult = () => drawRecommendation(rec);
  drawRecommendation(rec);
  if (["queued", "collecting", "analyzing"].includes(rec.status)) pollTimer = setTimeout(poll, POLL_MS);
}

function drawRecommendation(rec) {
  const conds = rec.conditions.length ? `<ul class="rec-conds">${rec.conditions.map((c) => `<li>${esc(c.label)}</li>`).join("")}</ul>` : "";
  // 조립한 질문 문장은 화면에 보여주지 않고, 적용한 조건만 태그로 보여준다(조건 요약, 명세 3장)
  const question = conds ? `<div class="rec-question"><b>${t("appliedConditions")}</b>${conds}</div>` : "";
  if (["queued", "collecting", "analyzing"].includes(rec.status)) {
    const step = rec.status === "analyzing" ? t("recAnalyzing") : t("recSearching");
    showResult(`<p class="rec-loading">${step}</p>${question}`);
    return;
  }
  const meta = `<p class="rec-meta">${rec.is_internal_test ? t("internalTest") : ""}${t("meta", esc(rec.collection.collected_at?.replace("T", " ").slice(0, 16) ?? "-"), esc(rec.collection.model_id ?? "-"), esc(rec.collection.search_country), rec.collection.search_used)}</p>`;
  const raw = rec.answer_text ? `<details class="rec-raw"><summary>${t("rawAnswer")}</summary><pre>${esc(rec.answer_text)}</pre></details>` : "";
  if (rec.status === "failed") {
    showResult(`<h2>${t("resultsTitle")}</h2>${meta}${failHTML(t(FAILURES[rec.failure] ?? "failDefault") + (rec.error ? ` (${rec.error})` : ""))}${question}${raw}`);
    return;
  }
  showResult(`
    <h2>${t("resultsTitle")}</h2>
    ${meta}
    ${rec.source_mode === "knowledge" ? `<p class="rec-notice rec-warn">${t("knowledgeNotice")}</p>` : ""}
    <p class="rec-notice">${t("notice", rec.review_count)}</p>
    <ol class="rec-cards">${rec.candidates.map((c) => renderCard(c, rec)).join("")}</ol>
    ${question}
    ${raw}`);
  // 사진이 안 열리면(핫링크 차단 등) 자리 표시로 바꾼다
  for (const img of $("rec-result").querySelectorAll(".rec-photo img")) {
    img.addEventListener("error", () => { img.replaceWith(Object.assign(document.createElement("span"), { className: "no-photo", textContent: t("photoFailed") })); }, { once: true });
  }
}

async function send(payload, shownText) {
  if (!current || busy) return;
  busy = true;
  showError(null);
  if (shownText) say("me", shownText);
  renderInput();
  renderLog(true);
  try {
    apply(await api(`/api/interviews/${session.id}/answer`, { turn_id: current.turn_id, ...payload }));
  } catch (err) {
    showError(t("sendAgain", err.message));
    renderLog();
  } finally {
    busy = false;
    renderInput();
  }
}

function sendText() {
  const text = $("chat-input").value.trim();
  if (!text || !current) return;
  // 숫자 척도는 서버가 글을 받지 않으므로 숫자로 바꿔 보낸다
  if (current.type === "scale") {
    const n = Number(text);
    if (!current.options.some((o) => Number(o.code) === n)) return showError(t("scaleRange"));
    $("chat-input").value = "";
    return send({ kind: "option", value_num: n }, text);
  }
  $("chat-input").value = "";
  send({ kind: "text", text }, text);
}

export async function startRecommend({ product, productLabel, lang }) {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
  if (saved && saved.product === product.code && (saved.lang ?? "ko") === lang) {
    session = saved;
    renderLog(true);
    try {
      const view = await api(`/api/interviews/${session.id}`);
      current = view.question;
      stage = view.interview.stage;
      picked = new Set();
      renderLog();
      renderInput();
      if (stage === "confirmed") {
        if (session.recId) poll(); else requestRecommendation();
      }
      return;
    } catch {
      localStorage.removeItem(STORE_KEY); // 서버 기록이 없으면 새로 시작
    }
  }
  clearTimeout(pollTimer);
  $("rec-result").hidden = true;
  $("rec-result").innerHTML = "";
  session = { id: null, product: product.code, lang, log: [], recId: null };
  current = null;
  stage = null;
  busy = true;
  renderLog(true);
  renderInput();
  showError(null);
  try {
    const view = await api("/api/interviews", {
      // 한국어로 받으면 한국 구매처, 영어로 받으면 미국 구매처 기준으로 묻고 검색한다(recommendation-spec.md 2.4)
      lang, market: lang === "en" ? "US" : "KR", mode: "recommend",
      product_category: product.code, product_category_other: product.other ?? null,
    });
    session.id = view.interview.id;
    save();
    say("note", t("recIntro", productLabel));
    apply(view);
  } catch (err) {
    showError(t("tryLater", err.message));
    renderLog();
  } finally {
    busy = false;
    renderInput();
  }
}

// 언어가 바뀌면 입력 영역과 결과 화면을 다시 그린다. 이미 오간 대화는 그대로 둔다.
export function rerenderRecommend() {
  if (!session) return;
  renderInput();
  if (!$("rec-result").hidden) lastResult?.();
}

export function bindRecommend(restart) {
  $("chat-options").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (btn?.id === "confirm-conditions") return confirmConditions();
    if (!btn || !current) return;
    if (btn.id === "send-picked") {
      const codes = [...picked];
      const labels = current.options.filter((o) => picked.has(o.code)).map((o) => o.label).join(", ");
      return send({ kind: "option", codes }, labels);
    }
    const code = btn.dataset.option;
    const opt = current.options.find((o) => o.code === code);
    if (current.type === "multi") {
      if (picked.has(code)) picked.delete(code); else picked.add(code);
      return renderInput();
    }
    if (current.type === "scale") return send({ kind: "option", value_num: Number(code) }, opt.label ?? code);
    send({ kind: "option", codes: [code] }, opt.label ?? code);
  });
  $("rec-result").addEventListener("click", (e) => {
    if (e.target.closest("[data-rec=retry]")) requestRecommendation();
  });
  $("composer").addEventListener("submit", (e) => { e.preventDefault(); sendText(); });
  $("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendText(); }
  });
  $("chat-skip").addEventListener("click", () => send({ kind: "skip" }, t("skipMe")));
  $("chat-restart").addEventListener("click", () => {
    localStorage.removeItem(STORE_KEY);
    restart();
  });
}
