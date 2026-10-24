// 제품 추천 갈래: docs/interview-guideline.md 기준 인터뷰를 채팅 + 버튼으로 진행한다.
// 질문 순서·문장·분류는 서버(/api/interviews)가 정한다. 화면 규칙:
//   보기가 4개 이하면 버튼으로도 답할 수 있고, 5개 이상이면 글로만 답한다(서버가 Claude로 코드 분류).
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
    + (pending ? `<li class="bubble from-ai typing" aria-label="질문을 고르는 중"><span></span><span></span><span></span></li>` : "");
  $("chat-log").lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function renderInput() {
  const q = current;
  // 질문이 끝나면 조건 확정 버튼만 보여준다(명세 2.2: 확인을 받은 뒤 확정)
  if (!q && stage === "pre_offer") {
    $("composer").hidden = true;
    $("chat-skip").hidden = true;
    $("chat-options").innerHTML = `<button type="button" class="send" id="confirm-conditions" ${busy ? "disabled" : ""}>이 조건으로 확정하기</button>`;
    return;
  }
  const open = Boolean(q) && !busy;
  $("composer").hidden = !q;
  $("chat-skip").hidden = !q;
  $("chat-input").disabled = !open;
  $("chat-send").disabled = !open;
  $("chat-input").placeholder = !q ? "" : q.type === "scale"
    ? `${q.options[0].code}~${q.options.at(-1).code} 중 숫자로 적어 주세요`
    : canUseButtons(q) ? "버튼을 누르거나 편하게 적어 주세요" : "편하게 적어 주세요";

  if (!canUseButtons(q)) { $("chat-options").innerHTML = ""; return; }
  const multi = q.type === "multi";
  $("chat-options").innerHTML = q.options.map((o) => `
    <button type="button" class="chip" data-option="${esc(o.code)}" ${open ? "" : "disabled"}
      aria-pressed="${picked.has(o.code)}"><span class="chip-label">${esc(o.label ?? o.code)}</span></button>`).join("")
    + (multi ? `<button type="button" class="send send-picked" id="send-picked" ${open && picked.size ? "" : "disabled"}>고른 것 보내기</button>` : "");
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
  if (!res.ok) throw new Error(data.error ?? `요청이 실패했어요 (${res.status})`);
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
  say("ai", `답해 주셔서 고마워요. 정리하면 이래요.\n${lines || "정리할 답이 없어요."}\n\n이대로 확정하면 고칠 수 없어요. 고칠 곳이 있다면 "처음부터 다시"를 눌러 주세요.`);
}

async function confirmConditions() {
  if (busy) return;
  busy = true;
  showError(null);
  renderInput();
  try {
    const view = await api(`/api/interviews/${session.id}/lock`, {});
    stage = view.interview.stage;
    say("me", "이 조건으로 확정할게요");
    say("note", "조건을 확정했어요. 이 조건으로 Claude 웹 검색을 실행할게요.");
  } catch (err) {
    showError(`${err.message}. 다시 눌러 주세요.`);
  } finally {
    busy = false;
    renderInput();
  }
  if (stage === "confirmed") requestRecommendation();
}

// ---------- 추천 결과 (recommendation-spec.md 2.4–3장) ----------
const POLL_MS = 2500;
const FAILURES = {
  search_failed: "웹 검색이 실패했어요.",
  timeout: "검색 시간이 초과됐어요.",
  search_not_used: "Claude가 웹 검색을 실행하지 않아 결과를 보여드리지 않아요.",
  no_verified_candidates: "답변에서 검증을 통과한 후보를 찾지 못했어요.",
  analysis_failed: "답변 분석이 실패했어요.",
  interrupted: "서버가 다시 시작돼 검색이 중단됐어요.",
  error: "처리 중 오류가 났어요.",
};
let pollTimer = null;

const safeHref = (u) => { try { return ["http:", "https:"].includes(new URL(u).protocol) ? u : null; } catch { return null; } };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const day = (iso) => (iso ? iso.slice(0, 10) : "");

function showResult(html) {
  $("rec-result").hidden = false;
  $("rec-result").innerHTML = html;
}

async function requestRecommendation() {
  clearTimeout(pollTimer);
  showResult(`<p class="rec-loading">조건으로 질문을 만들고 Claude 웹 검색을 실행하는 중이에요. 30초~1분 정도 걸릴 수 있어요.</p>`);
  try {
    const rec = await api("/api/recommendations", { interview_id: session.id });
    session.recId = rec.id;
    save();
    renderRecommendation(rec);
  } catch (err) {
    showResult(`<div class="rec-fail"><p>${esc(err.message)}</p><button type="button" class="send" data-rec="retry">다시 시도</button></div>`);
  }
}

async function poll() {
  try {
    renderRecommendation(await api(`/api/recommendations/${session.recId}`));
  } catch (err) {
    showResult(`<div class="rec-fail"><p>${esc(err.message)}</p><button type="button" class="send" data-rec="retry">다시 시도</button></div>`);
  }
}

function renderCard(c, rec) {
  const buy = c.buy && safeHref(c.buy.url);
  const img = c.image && safeHref(c.image.url);
  const p = c.price;
  const priceNote = p ? [p.seller && `판매처 ${esc(p.seller)}`, p.checked_date_text ? `확인일 ${esc(p.checked_date_text)}` : `수집일 ${day(rec.collection.collected_at)}`]
    .filter(Boolean).join(" · ") : "";
  return `
    <li class="rec-card">
      <div class="rec-photo">
        <span class="rec-pos" title="답변에 나온 순서">${c.explicit_rank ?? c.position}</span>
        ${img ? `<img src="${esc(img)}" alt="${esc(c.product_name)} 판매 페이지 사진" loading="lazy" referrerpolicy="no-referrer">` : `<span class="no-photo">사진을 찾지 못했어요</span>`}
      </div>
      <div class="rec-body">
        ${c.brand ? `<p class="rec-brand">${esc(c.brand)}</p>` : ""}
        <h3 class="rec-name">${esc(c.product_name)}</h3>
        <p class="rec-price">${p ? `<strong>${esc(p.text)}</strong><small>${priceNote} · 검색 시점 정보라 바뀔 수 있어요</small>` : `<small>답변에서 확인된 가격이 없어요</small>`}</p>
        <p class="rec-reason">${esc(c.reason_text)}</p>
        ${c.unverified_text ? `<p class="rec-unverified">확인되지 않은 정보: ${esc(c.unverified_text)}</p>` : ""}
        ${buy ? `<a class="rec-buy" href="${esc(buy)}" target="_blank" rel="noopener noreferrer nofollow">${esc(host(buy))}에서 보기·구매</a>`
          : `<p class="rec-nobuy">답변 인용에서 판매 페이지를 찾지 못했어요. 아래 출처를 확인해 주세요.</p>`}
        ${c.sources.length ? `<ul class="rec-sources">${c.sources.map((s) => `<li>출처: <a href="${esc(safeHref(s.url) ?? "#")}" target="_blank" rel="noopener noreferrer nofollow">${esc(s.title || host(s.url))}</a></li>`).join("")}</ul>` : ""}
      </div>
    </li>`;
}

function renderRecommendation(rec) {
  clearTimeout(pollTimer);
  const conds = rec.conditions.length ? `<ul class="rec-conds">${rec.conditions.map((c) => `<li>${esc(c.label)}</li>`).join("")}</ul>` : "";
  const question = `<div class="rec-question"><b>Claude에 보낸 질문 (확정 조건으로 조립)</b>${esc(rec.question_text)}${conds}</div>`;
  if (["queued", "collecting", "analyzing"].includes(rec.status)) {
    const step = rec.status === "analyzing" ? "답변에서 후보·가격·판매 페이지를 확인하는 중이에요." : "Claude 웹 검색으로 후보를 찾는 중이에요.";
    showResult(`<p class="rec-loading">${step}</p>${question}`);
    pollTimer = setTimeout(poll, POLL_MS);
    return;
  }
  const meta = `<p class="rec-meta">${rec.is_internal_test ? "내부 테스트 · " : ""}수집 ${esc(rec.collection.collected_at?.replace("T", " ").slice(0, 16) ?? "-")} UTC · ${esc(rec.collection.model_id ?? "-")} · 검색 위치 ${esc(rec.collection.search_country)} · 웹 검색 ${rec.collection.search_used ? "실행" : "미실행"}</p>`;
  const raw = rec.answer_text ? `<details class="rec-raw"><summary>Claude 답변 원문 보기</summary><pre>${esc(rec.answer_text)}</pre></details>` : "";
  if (rec.status === "failed") {
    showResult(`<h2>Claude 웹 검색으로 찾은 후보</h2>${meta}<div class="rec-fail"><p>${esc(FAILURES[rec.failure] ?? "결과를 만들지 못했어요.")}</p>
      <button type="button" class="send" data-rec="retry">다시 시도</button></div>${question}${raw}`);
    return;
  }
  showResult(`
    <h2>Claude 웹 검색으로 찾은 후보</h2>
    ${meta}
    <p class="rec-notice">Sieve가 고르거나 보증한 제품이 아니에요. 순서는 답변에 나온 순서이며 우열을 뜻하지 않아요. 가격·사진·링크는 검색 시점의 판매 페이지 정보예요. 제휴 링크가 아니며, 이 화면에는 혜택을 붙이지 않아요.${rec.review_count ? ` 검증을 통과하지 못한 ${rec.review_count}개는 검수 대기로 빼 두었어요.` : ""}</p>
    <ol class="rec-cards">${rec.candidates.map((c) => renderCard(c, rec)).join("")}</ol>
    ${question}
    ${raw}`);
  // 사진이 안 열리면(핫링크 차단 등) 자리 표시로 바꾼다
  for (const img of $("rec-result").querySelectorAll(".rec-photo img")) {
    img.addEventListener("error", () => { img.replaceWith(Object.assign(document.createElement("span"), { className: "no-photo", textContent: "사진을 불러오지 못했어요" })); }, { once: true });
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
    showError(`${err.message}. 다시 보내 주세요.`);
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
    if (!current.options.some((o) => Number(o.code) === n)) return showError("범위 안의 숫자로 적어 주세요");
    $("chat-input").value = "";
    return send({ kind: "option", value_num: n }, text);
  }
  $("chat-input").value = "";
  send({ kind: "text", text }, text);
}

export async function startRecommend({ product, productLabel, lang }) {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
  if (saved && saved.product === product.code) {
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
  session = { id: null, product: product.code, log: [], recId: null };
  current = null;
  stage = null;
  busy = true;
  renderLog(true);
  renderInput();
  showError(null);
  try {
    const view = await api("/api/interviews", {
      lang, market: "US", mode: "recommend",
      product_category: product.code, product_category_other: product.other ?? null,
    });
    session.id = view.interview.id;
    save();
    say("note", `${productLabel} 추천을 위한 내부 테스트 대화예요.`);
    apply(view);
  } catch (err) {
    showError(`${err.message}. 잠시 뒤 다시 시도해 주세요.`);
    renderLog();
  } finally {
    busy = false;
    renderInput();
  }
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
  $("chat-skip").addEventListener("click", () => send({ kind: "skip" }, "건너뛸게요"));
  $("chat-restart").addEventListener("click", () => {
    localStorage.removeItem(STORE_KEY);
    restart();
  });
}
