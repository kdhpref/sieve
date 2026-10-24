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
    say("note", "조건을 확정했어요. 이 조건으로 Claude 웹 검색 결과를 보여주는 단계는 아직 준비 중이에요.");
  } catch (err) {
    showError(`${err.message}. 다시 눌러 주세요.`);
  } finally {
    busy = false;
    renderInput();
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
      return;
    } catch {
      localStorage.removeItem(STORE_KEY); // 서버 기록이 없으면 새로 시작
    }
  }
  session = { id: null, product: product.code, log: [] };
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
