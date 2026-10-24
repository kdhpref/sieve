// AI 인터뷰 화면. 질문 순서는 서버가 정하고, 이 화면은 질문·보기를 보여주고 답을 보낸다.
const $app = document.getElementById("app");
const KEY = "sieve.interview.id";
const EXCLUSIVE = new Set(["ai_none", "v_none"]);

const T = {
  ko: {
    stagePre: "혜택 전 기록", stagePost: "결과와 이유", next: "다음", skip: "건너뛰기 · 잘 모르겠어요",
    typeHere: "보기에 없으면 편하게 적어 주세요", typeOnly: "편하게 적어 주세요", thinking: "답을 정리하고 있어요…",
    pickRank: (n) => `중요한 순서대로 최대 ${n}개를 눌러 주세요`, pickMulti: "해당하는 것을 모두 골라 주세요",
    srcLlm: "Claude가 만든 질문", srcFallback: "고정 문구 질문", probe: "한 번 더 여쭤봐요",
    soFar: "지금까지 기록된 답", review: "검수 대기",
    lockTitle: "혜택 안내 전에 기록을 확인해 주세요", lockLead: "확인하고 잠그면 이 기록은 수정할 수 없어요. 혜택 안내는 잠근 다음에 보여 드려요.",
    lockBtn: "확인하고 잠그기",
    offerTitle: "제휴 혜택 안내 (예시 화면)",
    offerLead: "실제 제휴 혜택은 아직 없어요. 내부 테스트에서는 혜택 안내를 봤는지만 기록하고, 이후 답은 혜택 노출 뒤 기록으로 따로 저장해요.",
    offerSeen: "혜택 안내를 봤어요", offerSkip: "혜택 안내 없이 계속",
    reward: "조사 보상은 구매 여부·고른 제품과 관계없이 같아요.",
    doneTitle: "참여해 주셔서 고마워요", doneLead: "보상 상태: 내부 테스트 제출이라 지급하지 않아요.",
    preTitle: "혜택 전 기록 (잠김)", postTitle: "결과와 이유", newOne: "새 인터뷰 시작", toStats: "정량 집계 보기",
    noLlm: "Claude 미연결: 고정 문구로 묻고, 자유 답변은 원문만 저장해 검수 대기로 둬요",
  },
  en: {
    stagePre: "Before the offer", stagePost: "Outcome and reasons", next: "Next", skip: "Skip · Not sure",
    typeHere: "If it's not listed, just type it in", typeOnly: "Type your answer", thinking: "Organizing your answer…",
    pickRank: (n) => `Tap up to ${n} in order of importance`, pickMulti: "Select all that apply",
    srcLlm: "Question written by Claude", srcFallback: "Fixed-wording question", probe: "One more question on this",
    soFar: "Your answers so far", review: "Pending review",
    lockTitle: "Please review your answers before the offer", lockLead: "Once you confirm and lock, these answers can't be edited. The offer is shown after locking.",
    lockBtn: "Confirm and lock",
    offerTitle: "Partner offer (sample screen)",
    offerLead: "There is no real partner offer yet. In internal testing we only record whether you saw the offer, and later answers are stored separately as post-offer records.",
    offerSeen: "I saw the offer", offerSkip: "Continue without the offer",
    reward: "The research reward is the same whether or not you buy, and whatever product you choose.",
    doneTitle: "Thanks for taking part", doneLead: "Reward status: not paid because this is an internal test submission.",
    preTitle: "Pre-offer record (locked)", postTitle: "Outcome and reasons", newOne: "Start a new interview", toStats: "View aggregate stats",
    noLlm: "Claude not connected: questions use fixed wording, and free-text answers are saved as-is for review",
  },
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let view = null;
let sel = { codes: [], value_num: null, text: "" };
let busy = false;
let error = "";

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

async function run(fn) {
  if (busy) return;
  busy = true;
  error = "";
  render();
  try {
    view = await fn();
    sel = { codes: [], value_num: null, text: "" };
    if (view?.interview) localStorage.setItem(KEY, view.interview.id);
    if (location.search) history.replaceState(null, "", location.pathname);
  } catch (err) {
    error = err.message;
    if (err.status === 409 && view) view = await api(`/api/interviews/${view.interview.id}`).catch(() => view);
  } finally {
    busy = false;
    render();
  }
}

// ---------- 화면 ----------
function render() {
  if (!view) return renderStart();
  const t = T[view.interview.lang];
  document.documentElement.lang = view.interview.lang;
  const { stage } = view.interview;
  if (view.question) return renderQuestion(t);
  if (stage === "pre_offer") return renderLock(t);
  if (stage === "offer") return renderOffer(t);
  return renderDone(t);
}

function renderStart() {
  document.documentElement.lang = "ko";
  const step1 = JSON.parse(localStorage.getItem("sieve.step1") || "null");
  const pre = ["SK-TONER", "SK-PAD", "OTHER"].includes(step1?.product_category) ? step1.product_category : "SK-TONER";
  $app.innerHTML = `
    <section class="card">
      <h1>AI로 화장품을 알아본 과정을 들려주세요</h1>
      <p class="lead">질문은 하나씩 드려요. 보기를 누르거나 편하게 적으면 돼요.
        사지 않았거나 다른 브랜드를 골랐어도 조사 보상은 같아요.</p>
      <form id="start">
        <div class="field"><span class="label">언어 · Language</span>
          <div class="seg" role="radiogroup">
            <label class="opt"><input type="radio" name="lang" value="ko" checked> 한국어</label>
            <label class="opt"><input type="radio" name="lang" value="en"> English</label>
          </div></div>
        <div class="field"><span class="label">구매 국가 · Country</span>
          <div class="seg" role="radiogroup">
            <label class="opt"><input type="radio" name="market" value="KR" checked> 한국</label>
            <label class="opt"><input type="radio" name="market" value="US"> United States</label>
          </div></div>
        <div class="field"><span class="label">찾던 제품 · Product</span>
          <div class="seg" role="radiogroup">
            ${[["SK-TONER", "토너·스킨 / Toner"], ["SK-PAD", "토너패드 / Toner pad"], ["OTHER", "기타 / Other"]].map(([v, l]) =>
              `<label class="opt"><input type="radio" name="product" value="${v}" ${v === pre ? "checked" : ""}> ${l}</label>`).join("")}
          </div>
          <input type="text" name="other" maxlength="40" placeholder="기타 제품 / Other product" style="margin-top:.5rem" ${pre === "OTHER" ? "" : "hidden"}
            value="${esc(pre === "OTHER" ? step1?.product_category_other : "")}">
        </div>
        ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
        <div class="actions"><span class="meta">내부 테스트 제출로 저장돼요</span>
          <button class="btn primary" type="submit" ${busy ? "disabled" : ""}>인터뷰 시작</button></div>
      </form>
    </section>`;
  const form = document.getElementById("start");
  form.addEventListener("change", () => { form.other.hidden = form.product.value !== "OTHER"; });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const lang = form.lang.value;
    // 한국어·영어 시장 조합은 자유지만 기본은 언어에 맞춘다
    run(() => api("/api/interviews", {
      lang, market: form.market.value, product_category: form.product.value, product_category_other: form.other.value,
    }));
  });
  form.addEventListener("change", (e) => {
    if (e.target.name === "lang") form.market.value = e.target.value === "en" ? "US" : "KR";
  });
}

function badges(t, q) {
  const out = [];
  if (!view.llm.available) out.push(`<span class="badge warn">${t.noLlm}</span>`);
  if (q) {
    out.push(`<span class="badge ${q.source === "llm" ? "info" : ""}">${q.source === "llm" ? t.srcLlm : t.srcFallback}</span>`);
    if (q.is_probe) out.push(`<span class="badge">${t.probe}</span>`);
  }
  return out.join("");
}

function soFar(t, stage) {
  const rows = view.summary[stage];
  if (!rows.length) return "";
  return `<details class="notice"><summary>${t.soFar} (${rows.length})</summary>
    <ul class="history">${rows.map((r) =>
      `<li><b>${esc(r.answer)}</b>${esc(r.title)}${r.review_required ? ` · <span class="badge warn">${t.review}</span>` : ""}</li>`).join("")}</ul></details>`;
}

function renderQuestion(t) {
  const q = view.question;
  const p = view.progress;
  const stage = view.interview.stage;
  const optionsHtml = q.type === "scale"
    ? `<div class="seg">${q.options.map((o) => `<button type="button" class="opt scale" data-num="${o.code}" aria-pressed="${sel.value_num === Number(o.code)}"><b>${o.code}</b><span>${esc(o.label === o.code ? "" : o.label)}</span></button>`).join("")}</div>`
    : q.options.length ? `<div class="seg" role="${q.type === "single" ? "radiogroup" : "group"}">${q.options.map((o) => {
        const i = sel.codes.indexOf(o.code);
        const on = i >= 0;
        return `<button type="button" class="opt" data-code="${esc(o.code)}" ${q.type === "single" ? `role="radio" aria-checked="${on}"` : `aria-pressed="${on}"`}>
          ${q.type === "rank" && on ? `<span class="rank">${i + 1}</span>` : ""}${esc(o.label)}</button>`;
      }).join("")}</div>` : "";
  const help = q.type === "rank" ? t.pickRank(q.max_rank) : q.type === "multi" ? t.pickMulti : "";
  const canSubmit = sel.codes.length > 0 || sel.value_num != null || sel.text.trim().length > 0;

  $app.innerHTML = `
    <section class="card">
      <div class="meta"><span class="badge">${stage === "post_offer" ? t.stagePost : t.stagePre}</span>${badges(t, q)}</div>
      <div class="progress" aria-hidden="true"><i style="width:${p ? Math.round((p.done / Math.max(p.total, 1)) * 100) : 0}%"></i></div>
      <p class="question" lang="${view.interview.lang}">${esc(q.text)}</p>
      ${optionsHtml}
      ${help ? `<p class="hint">${help}</p>` : ""}
      ${q.allow_text ? `<div class="field"><textarea id="free" maxlength="1000" placeholder="${q.options.length ? t.typeHere : t.typeOnly}">${esc(sel.text)}</textarea></div>` : ""}
      ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
      ${busy ? `<p class="thinking">${t.thinking}</p>` : ""}
      <div class="actions">
        <button class="btn ghost" type="button" id="skip" ${busy ? "disabled" : ""}>${t.skip}</button>
        <button class="btn primary" type="button" id="submit" ${busy || !canSubmit ? "disabled" : ""}>${t.next}</button>
      </div>
    </section>
    ${soFar(t, stage)}`;

  $app.querySelectorAll("[data-code]").forEach((b) => b.addEventListener("click", () => toggle(q, b.dataset.code)));
  $app.querySelectorAll("[data-num]").forEach((b) => b.addEventListener("click", () => { sel.value_num = Number(b.dataset.num); render(); }));
  const free = document.getElementById("free");
  free?.addEventListener("input", () => {
    sel.text = free.value;
    if (sel.text.trim() && sel.codes.length) { sel.codes = []; render(); document.getElementById("free").focus(); document.getElementById("free").setSelectionRange(9999, 9999); return; }
    document.getElementById("submit").disabled = busy || !(sel.codes.length || sel.value_num != null || sel.text.trim());
  });
  document.getElementById("skip").addEventListener("click", () => submit({ kind: "skip" }));
  document.getElementById("submit").addEventListener("click", () => {
    if (sel.codes.length) submit({ kind: "option", codes: sel.codes });
    else if (sel.value_num != null) submit({ kind: "option", value_num: sel.value_num });
    else submit({ kind: "text", text: sel.text });
  });
}

function toggle(q, code) {
  sel.text = "";
  const has = sel.codes.includes(code);
  if (q.type === "single") sel.codes = [code];
  else if (has) sel.codes = sel.codes.filter((c) => c !== code);
  else if (EXCLUSIVE.has(code)) sel.codes = [code];
  else if (q.type === "rank" && sel.codes.length >= q.max_rank) return;
  else sel.codes = [...sel.codes.filter((c) => !EXCLUSIVE.has(c)), code];
  render();
}

function submit(payload) {
  const id = view.interview.id;
  run(() => api(`/api/interviews/${id}/answer`, { turn_id: view.question.turn_id, ...payload }));
}

function summaryTable(t, rows) {
  return `<table class="summary"><tbody>${rows.map((r) => `<tr><th>${esc(r.title)}</th>
    <td>${esc(r.answer)}${r.review_required ? ` <span class="badge warn">${t.review}</span>` : ""}</td></tr>`).join("")}</tbody></table>`;
}

function renderLock(t) {
  $app.innerHTML = `
    <section class="card">
      <div class="meta">${badges(t)}</div>
      <h2>${t.lockTitle}</h2>
      <p class="lead">${t.lockLead}</p>
      ${summaryTable(t, view.summary.pre_offer)}
      ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
      <div class="actions"><span class="meta">${t.reward}</span>
        <button class="btn primary" id="lock" ${busy ? "disabled" : ""}>${t.lockBtn}</button></div>
    </section>`;
  document.getElementById("lock").addEventListener("click", () => run(() => api(`/api/interviews/${view.interview.id}/lock`, {})));
}

function renderOffer(t) {
  $app.innerHTML = `
    <section class="card">
      <h2>${t.offerTitle}</h2>
      <p class="lead">${t.offerLead}</p>
      <div class="notice"><strong>${t.reward}</strong></div>
      ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
      ${busy ? `<p class="thinking">${t.thinking}</p>` : ""}
      <div class="actions">
        <button class="btn ghost" id="noOffer" ${busy ? "disabled" : ""}>${t.offerSkip}</button>
        <button class="btn primary" id="seen" ${busy ? "disabled" : ""}>${t.offerSeen}</button>
      </div>
    </section>
    <section class="card"><h2>${t.preTitle}</h2>${summaryTable(t, view.summary.pre_offer)}</section>`;
  const go = (shown) => run(() => api(`/api/interviews/${view.interview.id}/offer`, { shown }));
  document.getElementById("seen").addEventListener("click", () => go(true));
  document.getElementById("noOffer").addEventListener("click", () => go(false));
}

function renderDone(t) {
  $app.innerHTML = `
    <section class="card">
      <h1>${t.doneTitle}</h1>
      <p class="lead">${t.doneLead} ${t.reward}</p>
      <div class="actions"><button class="btn ghost" id="again">${t.newOne}</button>
        <a class="btn primary" href="/stats.html" style="text-decoration:none">${t.toStats}</a></div>
    </section>
    <section class="card"><h2>${t.postTitle}</h2>${summaryTable(t, view.summary.post_offer)}</section>
    <section class="card"><h2>${t.preTitle}</h2>${summaryTable(t, view.summary.pre_offer)}</section>`;
  document.getElementById("again").addEventListener("click", reset);
}

function reset() {
  localStorage.removeItem(KEY);
  view = null;
  error = "";
  render();
}

// 이어하기: 저장된 인터뷰가 있으면 불러온다. ?new 로 새로 시작.
(async () => {
  const id = new URLSearchParams(location.search).has("new") ? null : localStorage.getItem(KEY);
  if (id) view = await api(`/api/interviews/${id}`).catch(() => null);
  if (!view) localStorage.removeItem(KEY);
  render();
})();
