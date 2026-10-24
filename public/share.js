// 3단계 대화 공유. 슬롯·보기는 docs/interview-guideline.md 3.1(P8~P10)과 코드북을 따른다.
// 보기 클릭만으로 끝낼 수 있는 고정 폼이다(지침 7장 미결 4). Claude 호출은 하지 않는다.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const MARKET = "KR";
const LANG = "ko";

export const share = {
  ai: new Set(), aiOther: "",
  question: "", candidates: [], excerpt: "",
  verify: new Set(),
  intent: null, leading: "",
  channel: null,
};

let book;
let onChange = () => {};

const usedAI = () => share.ai.size > 0 && !share.ai.has("ai_none");
const label = (opt) => opt[LANG] ?? opt.en ?? opt.code;

export async function initShare(changed) {
  onChange = changed;
  book = (await (await fetch("/codebook.json")).json());
  renderAll();
  bind();
  return book.codebook_version;
}

function chipsHTML(options, selected, name) {
  return options.map((o) => `<button type="button" class="chip" data-${name}="${o.code}"
    aria-pressed="${selected(o.code)}"><span class="chip-label">${esc(label(o))}</span></button>`).join("");
}

function renderAll() {
  const s = book.slots;
  $("ai-service").innerHTML = chipsHTML(s.ai_service.options, (c) => share.ai.has(c), "ai");
  $("ai-other-wrap").hidden = !share.ai.has("ai_other");
  $("ai-used").hidden = !usedAI();
  $("verify-channels").innerHTML = chipsHTML(s.verify_channels.options, (c) => share.verify.has(c), "verify");
  $("planned-channel").innerHTML = chipsHTML(s.planned_channel.options_by_market[MARKET], (c) => share.channel === c, "channel");
  renderCandidates();
  renderScale();
  renderLeading();
}

function renderCandidates() {
  $("candidates").innerHTML = share.candidates.map((c, i) => `
    <li><span>${esc(c)}</span><button type="button" class="remove" data-remove="${i}" aria-label="${esc(c)} 지우기">지우기</button></li>`).join("");
}

function renderScale() {
  const sl = book.slots.intent_scale;
  const items = [];
  for (let n = sl.min; n <= sl.max; n++) {
    items.push(`<button type="button" role="radio" class="scale-point" data-scale="${n}" aria-checked="${share.intent === n}">
      <span class="scale-num">${n}</span><span class="scale-label">${sl.labels[n] ? esc(sl.labels[n][LANG]) : ""}</span>
    </button>`);
  }
  $("intent-scale").innerHTML = items.join("");
}

function renderLeading() {
  const open = share.intent !== null && share.intent >= 3;
  $("leading-block").hidden = !open;
  if (!open) return;
  $("leading-chips").innerHTML = share.candidates.map((c) => `<button type="button" class="chip chip-small"
    data-leading="${esc(c)}" aria-pressed="${share.leading === c}"><span class="chip-label">${esc(c)}</span></button>`).join("");
  const typed = share.leading && !share.candidates.includes(share.leading) ? share.leading : "";
  if (document.activeElement !== $("leading-input")) $("leading-input").value = typed;
}

// "사용하지 않음"·"확인하지 않음"은 다른 보기와 함께 고를 수 없다
function toggleExclusive(set, code, exclusive) {
  if (set.has(code)) set.delete(code);
  else {
    if (code === exclusive) set.clear(); else set.delete(exclusive);
    set.add(code);
  }
}

// 개인정보로 보이는 문자열을 알려 주기만 한다. 자동으로 지우지 않는다.
function piiCheck(text) {
  const found = [];
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) found.push("이메일");
  if (/(\+?\d{1,3}[-\s]?)?0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/.test(text)) found.push("전화번호");
  if (/(주문\s?번호|注文番号)\s*[:：]?\s*\w+/.test(text)) found.push("주문번호");
  $("pii-warning").hidden = !found.length;
  $("pii-warning").textContent = found.length ? `${found.join("·")}처럼 보이는 내용이 있어요. 가리거나 지워 주세요.` : "";
}

function addCandidate() {
  const v = $("candidate-input").value.trim();
  if (v && !share.candidates.includes(v) && share.candidates.length < 10) share.candidates.push(v);
  $("candidate-input").value = "";
  renderCandidates();
  renderLeading();
  onChange();
}

function bind() {
  $("step-share").addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    const d = t.dataset;
    if (d.ai) { toggleExclusive(share.ai, d.ai, "ai_none"); renderAll(); }
    else if (d.verify) { toggleExclusive(share.verify, d.verify, "v_none"); renderAll(); }
    else if (d.channel) { share.channel = share.channel === d.channel ? null : d.channel; renderAll(); }
    else if (d.scale) { share.intent = Number(d.scale); renderScale(); renderLeading(); }
    else if (d.leading !== undefined) { share.leading = share.leading === d.leading ? "" : d.leading; renderLeading(); }
    else if (d.remove !== undefined) {
      const [gone] = share.candidates.splice(Number(d.remove), 1);
      if (share.leading === gone) share.leading = "";
      renderCandidates(); renderLeading();
    } else if (t.id === "candidate-add") return addCandidate();
    else return;
    onChange();
  });
  $("candidate-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); addCandidate(); }
  });
  $("ai-other").addEventListener("input", (e) => { share.aiOther = e.target.value.trim(); onChange(); });
  $("ai-question").addEventListener("input", (e) => { share.question = e.target.value.trim(); });
  $("ai-excerpt").addEventListener("input", (e) => {
    share.excerpt = e.target.value;
    piiCheck(e.target.value);
    $("paste-count").textContent = `${e.target.value.length.toLocaleString()} / 8,000자`;
    onChange();
  });
  $("leading-input").addEventListener("input", (e) => { share.leading = e.target.value.trim(); renderLeading(); });
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

export function shareProblem() {
  if (!share.ai.size) return "사용한 AI를 골라 주세요";
  if (share.ai.has("ai_other") && !share.aiOther) return "어떤 AI였는지 적어 주세요";
  if (share.intent === null) return "구매 가능성을 골라 주세요";
  if (!share.channel) return "살 곳을 골라 주세요";
  return null;
}

// 지침 6.1 long format 행. 화면에 없는 슬롯은 not_asked, 질문했지만 비운 칸은 skipped.
export function shareSlots() {
  const rows = [];
  const add = (slot, extra) => rows.push({ slot, value_code: null, value_num: null, rank: null, value_text: null,
    status: "answered", source: "option", ...extra });
  const text = (slot, v, asked) => add(slot, asked ? (v ? { value_text: v, source: null } : { status: "skipped", source: null })
    : { status: "not_asked", source: null });

  for (const code of share.ai) add("ai_service", { value_code: code, value_text: code === "ai_other" ? share.aiOther : null });
  text("ai_question_raw", share.question, usedAI());
  if (!usedAI()) text("ai_candidates_raw", "", false);
  else if (!share.candidates.length) text("ai_candidates_raw", "", true);
  else share.candidates.forEach((c, i) => add("ai_candidates_raw", { value_text: c, rank: i + 1, source: null }));
  if (!usedAI()) add("verify_channels", { status: "not_asked", source: null });
  else if (!share.verify.size) add("verify_channels", { status: "skipped", source: null });
  else for (const code of share.verify) add("verify_channels", { value_code: code });
  add("intent_scale", { value_num: share.intent });
  text("leading_candidate_raw", share.leading, share.intent >= 3);
  add("planned_channel", { value_code: share.channel });
  return rows;
}

// 확인 화면용 요약 [제목, 값] 목록
export function shareSummary() {
  const s = book.slots;
  const name = (slot, code) => {
    const opts = s[slot].options ?? s[slot].options_by_market[MARKET];
    return label(opts.find((o) => o.code === code));
  };
  const out = [["붙여 넣은 대화", `${share.excerpt.trim().length.toLocaleString()}자`], ["사용한 AI", [...share.ai].map((c) => c === "ai_other" ? `기타(${share.aiOther})` : name("ai_service", c)).join(", ")]];
  if (usedAI()) {
    out.push(["AI에게 한 질문", share.question || "적지 않음"]);
    out.push(["AI가 알려준 제품", share.candidates.join(", ") || "적지 않음"]);
    out.push(["따로 확인한 곳", [...share.verify].map((c) => name("verify_channels", c)).join(", ") || "고르지 않음"]);
  }
  const sl = s.intent_scale.labels[share.intent];
  out.push(["2주 안 구매 가능성", `${share.intent} / ${s.intent_scale.max}${sl ? ` (${sl[LANG]})` : ""}`]);
  if (share.intent >= 3) out.push(["가장 마음이 가는 제품", share.leading || "적지 않음"]);
  out.push(["살 곳", name("planned_channel", share.channel)]);
  return out;
}

export function setShareLocked(locked) {
  $("step-share").querySelectorAll("button, input, textarea").forEach((el) => (el.disabled = locked));
  $("ai-excerpt").disabled = locked;
}
