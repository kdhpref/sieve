// 소비자 제출 정량 집계 화면. 모든 막대는 클릭하면 산정 대상 원문으로 이동한다.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let dataset = "internal";
let stats = null;
let intentLabels = {};

const SOURCE = { option: "보기 선택", llm: "Claude 분류", text: "자유 입력", guided: "유도 질문으로 고름", auto: "자동(고민 1개)" };
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : "-");
const pctText = (p) => (p == null ? "-" : `${p}%`);

async function load() {
  $("out").innerHTML = `<p class="thinking">집계를 불러오고 있어요…</p>`;
  try {
    const [s, cb] = await Promise.all([
      fetch(`/api/interview-stats?dataset=${dataset}`).then((r) => r.json()),
      Object.keys(intentLabels).length ? null : fetch("/codebook.json").then((r) => r.json()).catch(() => null),
    ]);
    stats = s;
    if (cb) {
      for (const o of cb.slots.concern_codes.options) {
        if (o.intent_id) (intentLabels[o.intent_id] ??= []).push(o.ko);
      }
    }
    render();
  } catch (err) {
    $("out").innerHTML = `<p class="error">집계를 불러오지 못했어요: ${esc(err.message)}</p>`;
  }
}

function render() {
  const h = stats.header;
  $("banner").textContent = dataset === "internal"
    ? "내부 테스트 제출 집계예요. 팀원이 직접 만든 테스트이며 실제 소비자 데이터가 아니에요."
    : "실제 참여자 집계예요. 실제 참여자 모집은 아직 시작 전(P1)이에요.";
  const markets = Object.entries(h.markets).map(([k, v]) => `${k} ${v}명`).join(" · ") || "-";
  const levels = Object.entries(h.verification_levels).map(([k, v]) => `${k === "self_reported" ? "자기보고" : k} ${v}건`).join(" · ") || "-";
  const channels = Object.entries(h.recruitment_channels).map(([k, v]) => `${k === "internal_team" ? "팀원 직접 입력" : k} ${v}건`).join(" · ") || "-";

  let html = `
    <div class="stat-head">
      <div class="tile"><div class="k">잠긴 혜택 전 기록</div><div class="v">${h.pre_locked}</div><div class="s">시작 ${h.started}건 중</div></div>
      <div class="tile"><div class="k">결과·이유 제출</div><div class="v">${h.post_completed}</div><div class="s">혜택 안내 노출 ${h.offer_shown}건</div></div>
      <div class="tile"><div class="k">기간(잠금 시각)</div><div class="v" style="font-size:1rem;padding-top:.35rem">${h.period ? `${fmtDate(h.period.from)}<br>~ ${fmtDate(h.period.to)}` : "데이터 없음"}</div></div>
      <div class="tile"><div class="k">Claude 호출 비용</div><div class="v">$${h.llm.cost_usd.toFixed(3)}</div>
        <div class="s">잠긴 기록 1건당 ${h.llm.cost_per_locked_usd == null ? "-" : `$${h.llm.cost_per_locked_usd.toFixed(3)}`} · 호출 ${h.llm.calls}회(실패 ${h.llm.failed})</div></div>
    </div>
    <p class="caveat">캠페인 참여자 ${h.pre_locked}명의 관측이에요. 전체 소비자 비율이 아니에요.
      시장 ${esc(markets)} · 모집 경로 ${esc(channels)} · 인증 수준 ${esc(levels)} · 코드북 ${esc(h.codebook_version)}.
      분모는 각 질문을 받은 사람(응답 + 건너뜀)이고, 검수 대기 값은 비율에서 빼고 따로 표시해요.</p>
    <div class="key"><span><i class="k-conf"></i>확정</span><span><i class="k-pend"></i>검수 대기(Claude 분류 검증 실패·애매)</span><span><i class="k-skip"></i>응답 안 함</span></div>`;

  if (!h.pre_locked) {
    html += `<section class="card"><h2>데이터 없음</h2><p class="lead">잠긴 기록이 아직 없어요. 0이 아니라 수집 전 상태예요.</p></section>`;
    $("out").innerHTML = html;
    return;
  }

  for (const [stage, title] of [["pre_offer", "혜택 전 기록"], ["post_offer", `혜택 후 결과와 이유 · ${h.post_completed}명`]]) {
    html += `<h2 class="stage-title">${title}</h2><div class="grid">`;
    for (const s of stats.slots.filter((x) => x.stage === stage)) html += chartCard(s);
    html += `</div>`;
    if (stage === "pre_offer") html += intentTable();
  }
  $("out").innerHTML = html;
}

function barRow(slot, item, asked, { neutral = false, sep = false, n, pct, pending = 0, market = "" } = {}) {
  const w = (x) => (asked ? (x / asked) * 100 : 0);
  const val = `${n}명 · ${pctText(pct)}${pending ? ` · 검수 대기 ${pending}` : ""}`;
  const tip = `${item.label}: 확정 ${n}명(${pctText(pct)})${pending ? `, 검수 대기 ${pending}명` : ""} / 분모 ${asked}명. 누르면 원문을 봐요.`;
  return `<button type="button" class="bar-row${n + pending === 0 ? " zero" : ""}${sep ? " sep" : ""}" data-slot="${slot}" data-market="${esc(market)}" data-code="${esc(item.code)}" data-label="${esc(item.label)}" data-tip="${esc(tip)}">
    <span class="name">${esc(item.label)}</span>
    <span class="track">${n ? `<span class="fill${neutral ? " neutral" : ""}" style="width:${w(n)}%"></span>` : ""}${pending ? `<span class="fill pending" style="width:${w(pending)}%"></span>` : ""}</span>
    <span class="val">${val}</span></button>`;
}

function tailRows(s, slot = s.slot, market = "") {
  let out = barRow(slot, { code: "__skipped__", label: "응답 안 함" }, s.asked, { neutral: true, sep: true, n: s.skipped, pct: s.skipped_pct, market });
  if (s.review_without_code) {
    out += barRow(slot, { code: "__review__", label: "코드 없음(원문만)" }, s.asked, { n: 0, pct: 0, pending: s.review_without_code, market });
  }
  return out;
}

function chartCard(s) {
  const typeNote = s.by_market ? " · 시장마다 보기가 달라 시장별 분모로 따로 셉니다" : ({ multi: " · 복수 선택이라 합계가 100%를 넘을 수 있어요", rank: " · 최대 3개 순위" }[s.type] ?? "");
  let body;
  if (!s.asked) body = `<p class="empty">데이터 없음${s.not_asked ? ` · 조건에 해당하지 않아 질문 안 함 ${s.not_asked}명` : ""}</p>`;
  else if (s.type === "text" || s.type === "text_list") {
    body = `<div class="bars">${barRow(s.slot, { code: "", label: "원문 답변" }, s.asked, { n: s.answered, pct: Math.round((s.answered / s.asked) * 1000) / 10 })}${tailRows(s)}</div>
      <p class="hint">원문은 검수자가 제품 키로 매핑해요(자동 매핑 없음).</p>`;
  } else if (s.type === "scale") {
    body = `<div class="bars">${s.distribution.map((d) => barRow(s.slot, d, s.asked, { n: d.n_confirmed, pct: d.pct })).join("")}${tailRows(s)}</div>
      <p class="hint">중앙값 ${s.median ?? "-"} (1 거의 없음 ~ 5 거의 확실)</p>`;
  } else if (s.by_market) {
    // 같은 코드가 시장마다 다른 뜻(예: 예산 구간)이라 시장별로 나눠 그린다.
    body = s.by_market.filter((m) => m.asked || m.in_codebook).map((m) => `
      <h4 class="market-h">${esc(m.market)} · 질문받은 ${m.asked}명${m.in_codebook ? "" : " · 현재 코드북에 없는 시장(이전 버전 기록)"}</h4>
      ${m.asked ? `<div class="bars">${m.codes.map((c) => barRow(s.slot, c, m.asked, { n: c.n_confirmed, pct: c.pct, pending: c.n_pending, market: m.market })).join("")}${tailRows(m, s.slot, m.market)}</div>`
        : `<p class="empty">데이터 없음</p>`}`).join("");
  } else if (s.type === "rank") {
    body = `<div class="cols2">
      <div><h4>1순위로 고른 비율</h4><div class="bars">${s.codes.map((c) => barRow(s.slot, c, s.asked, { n: c.n_top1, pct: c.pct_top1 })).join("")}</div></div>
      <div><h4>3순위 안에 넣은 비율</h4><div class="bars">${s.codes.map((c) => barRow(s.slot, c, s.asked, { n: c.n_confirmed, pct: c.pct, pending: c.n_pending })).join("")}</div></div>
    </div><div class="bars">${tailRows(s)}</div>`;
  } else {
    body = `<div class="bars">${s.codes.map((c) => barRow(s.slot, c, s.asked, { n: c.n_confirmed, pct: c.pct, pending: c.n_pending })).join("")}${tailRows(s)}</div>`;
  }
  return `<section class="chart">
    <h3>${esc(s.title)}</h3>
    <p class="denom">질문받은 ${s.asked}명 · 건너뜀 ${s.skipped} · 질문 안 함 ${s.not_asked}${typeNote}</p>
    ${body}</section>`;
}

function intentTable() {
  const rows = stats.intents;
  return `<section class="card">
    <h2>구매 의도별: 소비자 제출 ↔ API 테스트</h2>
    <p class="lead">가장 중요한 고민을 질문집 구매 의도 ID로 묶었어요. 두 데이터는 출처가 달라 합산하지 않고 나란히만 보여줘요.</p>
    ${rows.length ? `<table class="plain"><thead><tr><th>의도 ID</th><th>고민</th><th>참여자 수(확정)</th><th>같은 의도 API 테스트 추천률</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.intent_id === "none" ? "-" : r.intent_id)}</td>
        <td>${esc(r.intent_id === "none" ? "질문집에 없는 고민(잘 모름·기타)" : (intentLabels[r.intent_id] ?? []).join(" / "))}</td>
        <td class="num">${r.n}명</td><td>미연결 · 데이터 없음</td></tr>`).join("")}
    </tbody></table>` : `<p class="empty">데이터 없음</p>`}
    <p class="hint">${esc(stats.api_test.note)}</p></section>`;
}

// ---------- 원문 서랍 ----------
function highlight(text, start, end) {
  if (text == null) return "";
  if (start == null || end == null || end > text.length) return esc(text);
  return `${esc(text.slice(0, start))}<mark>${esc(text.slice(start, end))}</mark>${esc(text.slice(end))}`;
}

async function openEvidence(slot, code, label, market) {
  const d = $("drawer");
  const title = stats.slots.find((s) => s.slot === slot)?.title ?? slot;
  d.hidden = false;
  d.innerHTML = `<header><h2>${esc(title)} · ${market ? `${esc(market)} · ` : ""}${esc(label)}</h2><button class="btn ghost" id="close">닫기</button></header><p class="thinking">원문을 불러오고 있어요…</p>`;
  $("close").onclick = () => (d.hidden = true);
  const { rows } = await fetch(`/api/interview-stats/evidence?dataset=${dataset}&slot=${encodeURIComponent(slot)}&code=${encodeURIComponent(code)}${market ? `&market=${encodeURIComponent(market)}` : ""}`).then((r) => r.json());
  d.innerHTML = `<header><h2>${esc(title)} · ${market ? `${esc(market)} · ` : ""}${esc(label)}</h2><button class="btn ghost" id="close">닫기</button></header>
    <p class="caveat">${rows.length}건 · 강조 부분이 Claude가 고른 근거 구간이며, 서버가 원문에 실제로 있는지 확인했어요.</p>
    <ol>${rows.map((r) => `<li>
      <div class="q">Q. ${esc(r.question_text ?? "(질문 없음: 자동 채움)")}</div>
      <p class="a">${r.answer_text != null ? highlight(r.answer_text, r.start_offset, r.end_offset)
        : r.answer_kind === "skip" ? "(건너뜀)" : r.answer_kind === "option" ? "(보기를 눌러 답함)" : esc(r.value_text ?? "")}</p>
      <div class="meta">
        <span class="badge">${esc(SOURCE[r.source] ?? r.source ?? "-")}</span>
        ${r.review_required ? `<span class="badge warn">검수 대기</span>` : ""}
        ${r.rank ? `<span class="badge">${r.rank}순위</span>` : ""}
        <span>${esc(r.market)} · ${esc(r.lang)} · ${esc(r.interview_id.slice(-6))} · ${fmtDate(r.created_at)}</span>
      </div></li>`).join("") || `<li>해당하는 원문이 없어요.</li>`}</ol>`;
  $("close").onclick = () => (d.hidden = true);
}

// ---------- 이벤트 ----------
$("out").addEventListener("click", (e) => {
  const row = e.target.closest(".bar-row");
  if (row) openEvidence(row.dataset.slot, row.dataset.code, row.dataset.label, row.dataset.market);
});
$("out").addEventListener("mousemove", (e) => {
  const row = e.target.closest(".bar-row");
  const tip = $("tip");
  if (!row) { tip.hidden = true; return; }
  tip.textContent = row.dataset.tip;
  tip.hidden = false;
  tip.style.left = `${Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8)}px`;
  tip.style.top = `${e.clientY + 14}px`;
});
$("out").addEventListener("mouseleave", () => ($("tip").hidden = true));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("drawer").hidden = true; });
$("dataset").addEventListener("click", (e) => {
  const b = e.target.closest("[data-ds]");
  if (!b) return;
  dataset = b.dataset.ds;
  for (const x of $("dataset").children) x.setAttribute("aria-pressed", String(x === b));
  load();
});
$("reload").addEventListener("click", load);
load();
