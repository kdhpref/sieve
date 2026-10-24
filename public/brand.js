// 브랜드 담당자용 조회 화면. 세 계열(소비자 제출 자기보고 / 추천 요청의 Claude 웹 검색 후보 / Claude API 웹 검색 테스트)을
// 합산하지 않고 나란히 그린다. 차트는 HTML/CSS 막대이며 모든 막대는 눌러서 산정 대상 원문(서랍)으로 간다. 값 글자는 잉크색, 색은 막대만 쓴다.
import { GROUPS } from "./categories.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const allItems = GROUPS.flatMap((g) => g.items);
const categoryName = (code) => (code === "OTHER" ? "기타(직접 입력)" : allItems.find((i) => i.code === code)?.ko ?? code);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : "-");
const pctText = (p) => (p == null ? "-" : `${p}%`);
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
const safeHref = (u) => { try { return ["http:", "https:"].includes(new URL(u).protocol) ? u : null; } catch { return null; } };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const normBrand = (s) => String(s ?? "").normalize("NFC").replace(/\s+/g, "").toLowerCase();
const MARKET = { KR: "한국", US: "미국", JP: "일본(범위 밖·이전 기록)" };
const LEVEL = { recommended: ["●", "추천 확정"], pending: ["◐", "추천 검수 대기"], mentioned: ["○", "언급만"], none: ["–", "없음"] };
const SOURCE = { option: "보기 선택", llm: "Claude 분류", text: "자유 입력", guided: "유도 질문으로 고름", auto: "자동(고민 1개)" };
const FAILURE = { search_failed: "웹 검색 실패", timeout: "시간 초과", search_not_used: "검색 미실행", no_verified_candidates: "검증 통과 후보 없음", analysis_failed: "분석 실패", interrupted: "중단됨", error: "오류" };

const params = new URLSearchParams(location.search);
const state = {
  dataset: params.get("dataset") === "real" ? "real" : "internal",
  category: params.get("category") || "",
  myBrand: localStorage.getItem("sieve.brand.my") ?? "",
  data: null,
  intentOf: {}, // 고민 코드 → 질문집 의도 ID (코드북)
};
const isMine = (name) => Boolean(state.myBrand.trim()) && normBrand(name).includes(normBrand(state.myBrand));

/* ---------- 불러오기 ---------- */

async function load() {
  $("out").classList.add("is-loading");
  const q = new URLSearchParams({ dataset: state.dataset, ...(state.category ? { category: state.category } : {}) });
  history.replaceState(null, "", `?${q}`);
  try {
    const [data, cb] = await Promise.all([
      fetch(`/api/brand/overview?${q}`).then((r) => r.json()),
      Object.keys(state.intentOf).length ? null : fetch("/codebook.json").then((r) => r.json()).catch(() => null),
    ]);
    if (data.error) throw new Error(data.error);
    if (cb) for (const o of cb.slots.concern_codes.options) if (o.intent_id) state.intentOf[o.code] = o.intent_id;
    state.data = data;
    render();
  } catch (err) {
    $("out").innerHTML = `<p class="error">데이터를 불러오지 못했어요: ${esc(err.message)}</p>`;
  } finally {
    $("out").classList.remove("is-loading");
  }
}

function render() {
  const d = state.data;
  $("banner").textContent = state.dataset === "internal"
    ? "내부 테스트 데이터예요. 팀원이 직접 만든 테스트이며 실제 소비자 데이터가 아니에요. 실제 보상은 지급되지 않아요."
    : "실제 참여자 데이터예요. 실제 참여자 모집은 아직 시작 전(P1)이라 비어 있을 수 있어요.";
  renderFilters();
  $("out").innerHTML = consumerSection(d) + recommendSection(d) + apiTestSection(d) + externalSection(d);
  $("my-brand").value = state.myBrand;
}

function renderFilters() {
  const counts = Object.fromEntries(state.data.categories.map((c) => [c.code, c.locked]));
  const codes = [...new Set(["SK-TONER", "SK-PAD", ...state.data.categories.map((c) => c.code), ...(state.category ? [state.category] : [])])];
  const total = state.data.categories.reduce((s, c) => s + c.locked, 0);
  $("cats").innerHTML = [`<button type="button" class="chip" data-cat="" aria-pressed="${!state.category}">전체<b>${total}</b></button>`,
    ...codes.map((c) => `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="${state.category === c}">${esc(categoryName(c))}<b>${counts[c] ?? 0}</b></button>`)].join("");
  for (const b of $("dataset").children) b.setAttribute("aria-pressed", String(b.dataset.ds === state.dataset));
}

/* ---------- 차트 부품 ---------- */

const legend = (items) => `<div class="viz-legend">${items.map(([cls, label]) => `<span><i class="sw ${cls}"></i>${esc(label)}</span>`).join("")}</div>`;

function tableView(head, body) {
  if (!body.length) return "";
  return `<details class="viz-table"><summary>표로 보기</summary><table><thead><tr>${head.map((h, i) => `<th class="${i ? "num" : ""}">${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${body.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? "num" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></details>`;
}

function chart({ title, denom = "", legend: lg = "", body, table = "", note = "", wide = false }) {
  return `<section class="viz${wide ? " wide" : ""}"><h3>${esc(title)}</h3>${denom ? `<p class="denom">${esc(denom)}</p>` : ""}${lg}${body}${table}${note ? `<p class="viz-note">${esc(note)}</p>` : ""}</section>`;
}

/**
 * 가로 막대 한 줄. series: [{ pct, pending_pct?, text, cls? }] 1~2개(두 개면 위아래로 겹쳐 그린다).
 * open: 누르면 열 원문 { kind, ...data }. 없으면 kind=none.
 */
function bar({ label, sub = "", series, open = { kind: "none" }, tip = "", sep = false, badge = "" }) {
  const zero = series.every((s) => !(s.pct > 0) && !(s.pending_pct > 0));
  const tracks = series.map((s, i) => {
    const w = Math.max(0, Math.min(100, s.pct ?? 0));
    const wp = Math.max(0, Math.min(100 - w, s.pending_pct ?? 0));
    return `<span class="viz-track">${w ? `<i class="viz-fill ${s.cls ?? `s${i + 1}`}" style="width:${w}%"></i>` : ""}${wp ? `<i class="viz-fill pend" style="width:${wp}%"></i>` : ""}</span>`;
  }).join("");
  const data = Object.entries(open).map(([k, v]) => `data-${k}="${esc(v ?? "")}"`).join(" ");
  return `<button type="button" class="viz-row${zero ? " is-zero" : ""}${sep ? " sep" : ""}" ${data} data-tip="${esc(tip || `${label}: ${series.map((s) => s.text).join(" · ")}`)}">
    <span class="viz-name">${esc(label)}${badge}${sub ? `<small>${esc(sub)}</small>` : ""}</span>
    <span class="viz-tracks${series.length > 1 ? " two" : ""}">${tracks}</span>
    <span class="viz-val">${esc(series.map((s) => s.text).join(" · "))}</span></button>`;
}

const evidenceOpen = (slot, code, market = "") => ({ kind: "evidence", slot, code, market });
const n명 = (n, pct, pending = 0) => `${n}명 · ${pctText(pct)}${pending ? ` · 검수 대기 ${pending}` : ""}`;

/** 코드별 단일 계열 막대 목록 + "응답 안 함" 꼬리 */
function codeBars(s, codes, market = "", { withTail = true } = {}) {
  let out = codes.map((c) => bar({
    label: c.label, series: [{ pct: c.pct, pending_pct: pct(c.n_pending ?? 0, s.asked), text: n명(c.n_confirmed, c.pct, c.n_pending) }],
    open: evidenceOpen(s.slot, c.code, market),
    tip: `${c.label}: 확정 ${c.n_confirmed}명(${pctText(c.pct)})${c.n_pending ? `, 검수 대기 ${c.n_pending}명` : ""} / 분모 ${s.asked}명. 누르면 원문을 봐요.`,
  })).join("");
  if (withTail) {
    out += bar({ label: "응답 안 함", series: [{ pct: s.skipped_pct, cls: "dim", text: n명(s.skipped, s.skipped_pct) }], open: evidenceOpen(s.slot, "__skipped__", market), sep: true });
    if (s.review_without_code) out += bar({ label: "코드 없음(원문만)", series: [{ pct: 0, pending_pct: pct(s.review_without_code, s.asked), text: `검수 대기 ${s.review_without_code}` }], open: evidenceOpen(s.slot, "__review__", market) });
  }
  return `<div class="viz-bars">${out}</div>`;
}

const denomText = (s, extra = "") => `질문받은 ${s.asked}명 · 건너뜀 ${s.skipped} · 질문 안 함 ${s.not_asked}${extra}`;

/** 코드북 슬롯 요약 → 차트. 시장별 보기(예산·구매처)는 시장마다 분모를 따로 둔다. */
function slotChart(s, { title, subOf } = {}) {
  if (!s) return "";
  const t = title ?? s.title;
  if (!s.asked) return chart({ title: t, denom: `질문받은 0명${s.not_asked ? ` · 조건에 해당하지 않아 질문 안 함 ${s.not_asked}명` : ""}`, body: `<p class="viz-empty">데이터 없음</p>` });
  if (s.by_market) {
    const blocks = s.by_market.filter((m) => m.asked || m.in_codebook).map((m) => `
      <h4 class="viz-sub">${esc(MARKET[m.market] ?? m.market)} · 질문받은 ${m.asked}명${m.in_codebook ? "" : " · 현재 코드북에 없는 시장"}</h4>
      ${m.asked ? codeBars({ ...m, slot: s.slot }, m.codes, m.market) : `<p class="viz-empty">데이터 없음</p>`}`).join("");
    const table = tableView(["시장", "보기", "확정", "비율", "검수 대기"], s.by_market.flatMap((m) => m.codes.map((c) => [MARKET[m.market] ?? m.market, c.label, c.n_confirmed, pctText(c.pct), c.n_pending])));
    return chart({ title: t, denom: "같은 코드가 시장마다 다른 뜻이라 시장별 분모로 따로 세요", body: blocks, table });
  }
  if (s.type === "scale") {
    const max = Math.max(...s.distribution.map((d) => d.pct ?? 0), 1);
    const cols = s.distribution.map((d, i) => `<button type="button" class="viz-col" data-kind="evidence" data-slot="${s.slot}" data-code="${esc(d.code)}" data-market=""
        data-tip="${esc(`${d.label}: ${d.n_confirmed}명(${pctText(d.pct)}) / 분모 ${s.asked}명. 누르면 원문을 봐요.`)}">
        <span class="cap">${d.n_confirmed}</span><i class="col o${i + 1}" style="height:${((d.pct ?? 0) / max) * 100}%"></i></button>`).join("");
    const axis = s.distribution.map((d, i) => `<span>${d.label}${i === 0 ? "<small>거의 없음</small>" : i === 4 ? "<small>거의 확실</small>" : ""}</span>`).join("");
    return chart({ title: t, denom: denomText(s), body: `<div class="viz-cols">${cols}</div><div class="viz-axis">${axis}</div>`,
      table: tableView(["값", "응답", "비율"], s.distribution.map((d) => [d.label, d.n_confirmed, pctText(d.pct)])),
      note: `중앙값 ${s.median ?? "-"} · 응답 안 함 ${s.skipped}명` });
  }
  if (s.type === "rank") {
    const rows = s.codes.map((c) => bar({
      label: c.label,
      series: [{ pct: c.pct_top1, text: `1순위 ${c.n_top1}명(${pctText(c.pct_top1)})` }, { pct: c.pct, pending_pct: pct(c.n_pending, s.asked), text: `3순위 안 ${c.n_confirmed}명(${pctText(c.pct)})` }],
      open: evidenceOpen(s.slot, c.code),
    })).join("");
    return chart({ title: t, denom: denomText(s, " · 최대 3개 순위"), legend: legend([["s1", "1순위로 고름"], ["s2", "3순위 안에 넣음"]]),
      body: `<div class="viz-bars">${rows}${bar({ label: "응답 안 함", series: [{ pct: s.skipped_pct, cls: "dim", text: n명(s.skipped, s.skipped_pct) }], open: evidenceOpen(s.slot, "__skipped__"), sep: true })}</div>`,
      table: tableView(["기준", "1순위", "3순위 안", "검수 대기"], s.codes.map((c) => [c.label, c.n_top1, c.n_confirmed, c.n_pending])) });
  }
  if (s.type === "text" || s.type === "text_list") {
    return chart({ title: t, denom: denomText(s), body: `<div class="viz-bars">${bar({ label: "원문 답변", series: [{ pct: pct(s.answered, s.asked), text: n명(s.answered, pct(s.answered, s.asked)) }], open: evidenceOpen(s.slot, "") })}
      ${bar({ label: "응답 안 함", series: [{ pct: s.skipped_pct, cls: "dim", text: n명(s.skipped, s.skipped_pct) }], open: evidenceOpen(s.slot, "__skipped__"), sep: true })}</div>`,
      note: "원문은 검수자가 제품 키로 매핑해요(자동 매핑 없음)." });
  }
  const codes = subOf ? s.codes.map((c) => ({ ...c, sub: subOf(c) })) : s.codes;
  const body = codes.length === s.codes.length && subOf
    ? `<div class="viz-bars">${codes.map((c) => bar({ label: c.label, sub: c.sub, series: [{ pct: c.pct, pending_pct: pct(c.n_pending, s.asked), text: n명(c.n_confirmed, c.pct, c.n_pending) }], open: evidenceOpen(s.slot, c.code) })).join("")}
        ${bar({ label: "응답 안 함", series: [{ pct: s.skipped_pct, cls: "dim", text: n명(s.skipped, s.skipped_pct) }], open: evidenceOpen(s.slot, "__skipped__"), sep: true })}</div>`
    : codeBars(s, s.codes);
  return chart({ title: t, denom: denomText(s, s.type === "multi" ? " · 복수 선택이라 합계가 100%를 넘을 수 있어요" : ""), body,
    table: tableView(["보기", "확정", "비율", "검수 대기"], s.codes.map((c) => [c.label, c.n_confirmed, pctText(c.pct), c.n_pending])) });
}

const tile = (k, v, s = "", unit = "") => `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${esc(v)}${unit ? `<small>${esc(unit)}</small>` : ""}</div><div class="s">${esc(s)}</div></div>`;
const seriesHead = (title, kind, lead) => `<header><h2>${esc(title)}</h2><span class="kind">${esc(kind)}</span></header><p class="lead">${esc(lead)}</p>`;

/* ---------- ① 소비자 제출(자기보고) ---------- */

function consumerSection(d) {
  const c = d.consumer;
  const h = c.header;
  const slot = (name) => c.slots.find((s) => s.slot === name);
  const outcome = slot("outcome");
  const bought = outcome?.codes.filter((x) => x.code.startsWith("out_bought")).reduce((s, x) => s + x.n_confirmed, 0) ?? 0;
  const ai = slot("ai_service");
  const usedAi = ai ? Math.max(0, ai.answered - (ai.codes.find((x) => x.code === "ai_none")?.n_confirmed ?? 0)) : 0;
  const chg = slot("changed_after_offer");
  const changed = chg?.codes.find((x) => x.code === "chg_yes")?.n_confirmed ?? 0;
  const catLabel = state.category ? `${categoryName(state.category)} ` : "";
  const markets = Object.entries(h.markets).map(([k, v]) => `${MARKET[k] ?? k} ${v}명`).join(" · ") || "-";
  const levels = Object.entries(h.verification_levels).map(([k, v]) => `${k === "self_reported" ? "자기보고" : k} ${v}건`).join(" · ") || "-";
  const channels = Object.entries(h.recruitment_channels).map(([k, v]) => `${k === "internal_team" ? "팀원 직접 입력" : k} ${v}건`).join(" · ") || "-";

  let html = seriesHead(`소비자 제출 (자기보고)`, state.dataset === "internal" ? "내부 테스트" : "실제 참여자",
    `${catLabel}캠페인 참여자가 혜택 안내를 보기 전에 잠근 기록과, 그 뒤에 제출한 결과·이유예요. 참여자 ${h.pre_locked}명의 관측이며 전체 소비자 비율이 아니에요.`);
  html += `<div class="stat-head">
    ${tile("잠긴 혜택 전 기록", h.pre_locked, `시작 ${h.started}건 중`, "명")}
    ${tile("결과·이유 제출", h.post_completed, `혜택 안내 노출 ${h.offer_shown}건`, "명")}
    ${tile("AI를 쓴 참여자", ai?.asked ? usedAi : "–", ai?.asked ? `질문받은 ${ai.asked}명 중 · ${pctText(pct(usedAi, ai.asked))}` : "데이터 없음", ai?.asked ? "명" : "")}
    ${tile("구매로 이어진 과정", outcome?.asked ? bought : "–", outcome?.asked ? `결과를 답한 ${outcome.asked}명 중 · ${pctText(pct(bought, outcome.asked))}` : "데이터 없음", outcome?.asked ? "건" : "")}
    ${tile("혜택 후 선택 변경", chg?.asked ? changed : "–", chg?.asked ? `혜택을 본 ${chg.asked}명 중 · 캐시백 영향 의심 사례` : "혜택을 본 참여자 없음 · 데이터 없음", chg?.asked ? "건" : "")}
  </div>
  <p class="caveat">시장 ${esc(markets)} · 모집 경로 ${esc(channels)} · 인증 수준 ${esc(levels)} · 코드북 ${esc(h.codebook_version)} · 기간 ${h.period ? `${fmtDate(h.period.from)} ~ ${fmtDate(h.period.to)}` : "데이터 없음"} · Claude 호출 $${h.llm.cost_usd.toFixed(3)}.
    분모는 각 질문을 받은 사람(응답 + 건너뜀)이고, 검수 대기 값은 비율에서 빼고 빗금으로 따로 표시해요.${h.recommend_excluded ? ` 제품 추천 받기 인터뷰 ${h.recommend_excluded}건은 별도 계열이라 여기에 넣지 않았어요.` : ""}</p>`;

  if (!h.pre_locked) {
    html += `<div class="bd-empty"><b>데이터 없음</b>이 조건의 잠긴 기록이 아직 없어요. 0이 아니라 수집 전 상태예요.</div>`;
    return `<section class="bd-series" id="consumer">${html}</section>`;
  }

  const rb = c.reasons_by_outcome;
  const reasonsChart = chart({
    title: "결정 이유 × 최종 결과", denom: `구매 ${rb.asked_bought}명 · 미구매·고민 중 ${rb.asked_not_bought}명 (각 그룹에서 이유를 질문받은 사람) · 복수 선택`,
    legend: legend([["s1", "구매한 참여자"], ["s2", "사지 않았거나 고민 중"]]),
    body: `<div class="viz-bars">${rb.codes.map((r) => bar({
      label: r.label,
      series: [{ pct: pct(r.n_bought, rb.asked_bought), text: `구매 ${r.n_bought}명` }, { pct: pct(r.n_not_bought, rb.asked_not_bought), text: `미구매 ${r.n_not_bought}명${r.n_pending ? ` · 검수 대기 ${r.n_pending}` : ""}` }],
      open: evidenceOpen("reason_codes", r.code),
      tip: `${r.label}: 구매 ${r.n_bought}/${rb.asked_bought}명(${pctText(pct(r.n_bought, rb.asked_bought))}), 미구매·고민 중 ${r.n_not_bought}/${rb.asked_not_bought}명(${pctText(pct(r.n_not_bought, rb.asked_not_bought))}). 누르면 원문을 봐요.`,
    })).join("")}</div>`,
    table: tableView(["이유", "구매", "미구매·고민 중", "검수 대기"], rb.codes.map((r) => [r.label, r.n_bought, r.n_not_bought, r.n_pending])),
    note: "브랜드가 가장 궁금해하는 ‘추천받았는데 왜 안 샀는가’. 가격·배송·판매처·제품 특성은 참여자가 직접 고른 분류이며, 원문 인용으로 이동해 확인해요.",
  });

  html += `<div class="viz-grid">
    ${slotChart(outcome, { title: "최종 결과" })}
    ${reasonsChart}
    ${slotChart(slot("primary_concern_code"), { title: "가장 중요한 고민 → 질문집 의도", subOf: (x) => (state.intentOf[x.code] ? `구매 의도 ${state.intentOf[x.code]} · API 테스트와 같은 ID` : "질문집에 없는 고민") })}
    ${slotChart(slot("decision_factors"), { title: "고를 때 중요한 기준" })}
    ${slotChart(slot("ai_service"), { title: "사용한 AI" })}
    ${slotChart(slot("verify_channels"), { title: "AI 답 이후 따로 확인한 곳" })}
    ${slotChart(slot("intent_scale"), { title: "2주 안 구매 가능성 (1~5)" })}
    ${slotChart(slot("budget_band"), { title: "1개 예산" })}
    ${slotChart(slot("planned_channel"), { title: "살 곳" })}
    ${slotChart(slot("trigger"), { title: "찾게 된 계기" })}
    ${slotChart(slot("current_status"), { title: "지금 쓰는 제품" })}
    ${slotChart(slot("dissatisfaction"), { title: "지금 제품의 아쉬운 점" })}
    ${slotChart(slot("concern_codes"), { title: "피부·사용 고민 (복수)" })}
    ${slotChart(slot("chosen_product_raw"), { title: "실제로 산 제품 (원문)" })}
    ${slotChart(slot("ai_candidates_raw"), { title: "AI가 추천한 후보 (원문)" })}
  </div>`;
  return `<section class="bd-series" id="consumer">${html}</section>`;
}

/* ---------- ② 제품 추천 받기: Claude 웹 검색으로 찾은 후보 ---------- */

function recommendSection(d) {
  const r = d.recommend;
  const req = r.requests;
  let html = seriesHead("Claude 웹 검색으로 찾은 후보", "제품 추천 받기 · 별도 계열",
    "참여자가 조건 대화로 확정한 조건으로 Sieve가 실행한 Claude 웹 검색의 결과예요. 참여자가 스스로 쓴 AI의 추천이 아니고, 질문집 버전이 달라 API 테스트 추천률과도 합치지 않아요. 브랜드명은 답변 표기 그대로이며 제품 키 매핑 전이에요.");
  if (!req.total) {
    html += `<div class="bd-empty"><b>데이터 없음</b>이 조건의 제품 추천 받기 요청이 아직 없어요.</div>`;
    return `<section class="bd-series" id="recommend">${html}</section>`;
  }
  const countries = Object.entries(req.by_country).map(([k, v]) => `${MARKET[k] ?? k} ${v}건`).join(" · ") || "-";
  const failures = Object.entries(req.by_failure).map(([k, v]) => `${FAILURE[k] ?? k} ${v}`).join(" · ");
  html += `<div class="stat-head">
    ${tile("추천 요청", req.total, `완료 ${req.done} · 실패 ${req.failed}${req.active ? ` · 진행 중 ${req.active}` : ""}${failures ? ` (${failures})` : ""}`, "건")}
    ${tile("검색 위치", countries, "화면 언어가 시장을 정해요")}
    ${tile("수집·분석 비용", `$${r.cost_usd.toFixed(3)}`, `완료 1건당 ${req.done ? `$${(r.cost_usd / req.done).toFixed(3)}` : "-"} · 실패 비용 포함`)}
    ${tile("기간", r.period ? `${fmtDate(r.period.from)} ~ ${fmtDate(r.period.to)}` : "-", "요청 시각 기준")}
  </div>`;

  const emph = Boolean(state.myBrand.trim());
  const brandRows = r.brands.map((b) => bar({
    label: b.brand, sub: b.products.join(", "),
    badge: isMine(b.brand) ? `<span class="badge info">내 브랜드</span>` : "",
    series: [{ pct: b.pct_requests, cls: emph ? (isMine(b.brand) ? "s1" : "dim") : "s1", text: `${b.n_requests}건(${pctText(b.pct_requests)}) · 후보 ${b.n_candidates}회 · 1번째 ${b.n_first}` }],
    open: { kind: "recbrand", brand: b.brand },
    tip: `${b.brand}: 완료된 추천 ${req.done}건 중 ${b.n_requests}건의 후보에 등장(${pctText(b.pct_requests)}). 후보 ${b.n_candidates}회, 답변에서 1번째로 나온 횟수 ${b.n_first}, 가격 확인 ${b.n_price}, 판매 페이지 인용 ${b.n_buy}. 누르면 후보 목록을 봐요.`,
  })).join("");
  const sourceRows = r.sources.map((s) => bar({
    label: s.host, series: [{ pct: pct(s.n, req.done), text: `${s.n}건(${pctText(pct(s.n, req.done))})` }],
    tip: `${s.host}: 완료된 추천 ${req.done}건 중 ${s.n}건의 후보가 이 도메인을 인용·판매 페이지로 썼어요.`,
  })).join("");

  html += `<div class="viz-grid">
    ${chart({ title: "후보로 등장한 브랜드", denom: `완료된 추천 ${req.done}건 · 검증 통과 후보만 · 브랜드당 요청 1건을 최대 1회`, body: r.brands.length ? `<div class="viz-bars">${brandRows}</div>` : `<p class="viz-empty">데이터 없음 · 완료된 추천의 검증 통과 후보가 아직 없어요</p>`,
      table: tableView(["브랜드", "요청 수", "후보 횟수", "1번째", "가격 확인", "판매 페이지"], r.brands.map((b) => [b.brand, b.n_requests, b.n_candidates, b.n_first, b.n_price, b.n_buy])),
      note: emph ? `“${state.myBrand}”와 표기가 일부 일치하는 행만 강조했어요. 순서는 요청 수 순이며 우열이 아니에요.` : "위 필터에 내 브랜드를 적으면 해당 행만 강조해요. 순서는 요청 수 순이며 우열이 아니에요." })}
    ${chart({ title: "후보가 인용한 출처 도메인", denom: `완료된 추천 ${req.done}건 · 요청당 도메인 1회`, body: r.sources.length ? `<div class="viz-bars">${sourceRows}</div>` : `<p class="viz-empty">데이터 없음</p>`,
      table: tableView(["도메인", "요청 수"], r.sources.map((s) => [s.host, s.n])), note: "API 인용 메타데이터의 URL만 세요. 검색 결과에만 있던 URL은 넣지 않아요." })}
  </div>
  <section class="viz wide" style="margin-top:1rem"><h3>최근 추천 요청 ${r.recent.length}건</h3><p class="denom">조립한 질문 · 확정 조건 · 검증 통과 후보. 원문은 Claude 답변 전체예요.</p>
    <ol class="rec-list">${r.recent.map((x) => `<li class="rec-item">
      <div class="q">${esc(x.question_text)}</div>
      <div class="conds">${x.conditions.map((cd) => `<span>${esc(cd)}</span>`).join("")}${x.intent_id ? `<span>의도 ${esc(x.intent_id)}</span>` : ""}<span>${esc(categoryName(x.product_category))}</span></div>
      ${x.status === "done" ? `<ol>${x.candidates.map((cd) => `<li class="${isMine(cd.brand) || isMine(cd.product_name) ? "mine" : ""}">${esc(cd.brand ? `${cd.brand} ` : "")}${esc(cd.product_name)}
        <small>${[cd.price_text && esc(cd.price_text), cd.seller && esc(`판매처 ${cd.seller}`), cd.buy_url && safeHref(cd.buy_url) ? `<a href="${esc(cd.buy_url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(host(cd.buy_url))}</a>` : null].filter(Boolean).join(" · ")}</small></li>`).join("")}</ol>`
        : `<p class="viz-empty">${esc(FAILURE[x.failure] ?? x.status)}${x.review_count ? ` · 검수 대기 ${x.review_count}` : ""}</p>`}
      <div class="meta"><span class="badge">${x.status === "done" ? "완료" : x.status === "failed" ? "실패" : "진행 중"}</span>
        ${x.search_used === false ? `<span class="badge warn">검색 미실행</span>` : ""}${x.review_count ? `<span class="badge warn">검수 대기 ${x.review_count}</span>` : ""}
        <span>${esc(MARKET[x.search_country] ?? x.search_country)} · ${esc(x.lang)} · ${esc(x.model_id ?? "-")} · ${fmtDate(x.created_at)}</span>
        <button type="button" class="link" data-kind="recommendation" data-rid="${esc(x.id)}">답변 원문</button></div>
    </li>`).join("")}</ol></section>`;
  return `<section class="bd-series" id="recommend">${html}</section>`;
}

/* ---------- ③ Claude API 웹 검색 테스트 ---------- */

function apiTestSection(d) {
  const a = d.api_test;
  let html = seriesHead("Claude API 웹 검색 테스트", "질문집 30문항 · 통제된 조건",
    "같은 질문을 통제된 조건(모델·검색 설정 고정)에서 재현한 제한된 실험의 관측값이에요. 선택한 질문과 설정에서의 비율이며 실제 이용자 노출수가 아니에요. 소비자 제출이 아니라서 위의 데이터 구분(내부 테스트/실제 참여자)과 무관해요.");
  if (a.status !== "connected") {
    html += `<div class="bd-empty"><b>${a.status === "no_data" ? "수집 전 · 데이터 없음" : "미연결 · 데이터 없음"}</b>${esc(a.note)}</div>`;
    return `<section class="bd-series" id="apitest">${html}</section>`;
  }
  const h = a.header;
  const own = a.project.brands.find((b) => b.role === "own");
  html += `<div class="stat-head">
    ${tile("유효 응답", h.n_valid, `문항 ${h.n_questions}개 · 오류 ${h.n_error}건(분모에서 제외) · 질문집 ${h.question_set_version}`, "건")}
    ${tile("웹 검색 실행", `${h.n_search_used}/${h.n_valid}`, `${h.search_tool ?? "-"} · max_uses ${h.max_uses ?? "-"} · 위치 ${h.country}`)}
    ${tile("모델", h.models.join(", ") || "-", "모델·설정이 같은 응답만 비교")}
    ${tile("수집 비용", `$${h.cost_usd.toFixed(2)}`, `유효 1건당 $${h.n_valid ? (h.cost_usd / h.n_valid).toFixed(3) : "-"} · 오류·분석 포함`)}
    ${tile("수집 기간", h.period ? `${fmtDate(h.period.from)} ~ ${fmtDate(h.period.to)}` : "-", "저장된 실행 결과 · 실시간 아님")}
  </div>
  <p class="caveat">${esc(a.note)} 프로젝트 “${esc(a.project.name)}”: 자사 ${esc(own?.name ?? "-")} · 비교 ${esc(a.project.brands.filter((b) => b.role !== "own").map((b) => b.name).join(", "))}. 반복 3회는 재현성 탐색 수준이며 같은 질문의 반복을 독립 표본으로 보지 않아요.</p>`;

  const roleBadge = (b) => `<span class="badge ${b.role === "own" ? "info" : ""}">${b.role === "own" ? "자사" : "비교"}</span>`;
  const rateRows = a.brands.map((b) => {
    const rec = b.recommend_rate ?? 0;
    const pend = pct(b.n_pending, h.n_valid) ?? 0;
    const mentionOnly = Math.max(0, (b.mention_rate ?? 0) - rec - pend);
    return `<button type="button" class="viz-row" data-kind="apibrand" data-brand="${esc(b.brand_id)}"
      data-tip="${esc(`${b.name}: 유효 ${h.n_valid}건 중 추천 확정 ${b.n_recommended}(${pctText(b.recommend_rate)}), 추천 검수 대기 ${b.n_pending}, 언급 ${b.n_mentioned}(${pctText(b.mention_rate)}). 문항별 평균 추천률 ${pctText(b.recommend_rate_qmean)}. 누르면 문항별 판정을 봐요.`)}">
      <span class="viz-name">${esc(b.name)}${roleBadge(b)}<small>${esc(b.name_en ?? "")}${b.products.length ? ` · ${esc(b.products[0])}` : ""}</small></span>
      <span class="viz-tracks"><span class="viz-track"><i class="viz-fill s1" style="width:${rec}%"></i><i class="viz-fill pend" style="width:${pend}%"></i><i class="viz-fill s1-light" style="width:${mentionOnly}%"></i></span></span>
      <span class="viz-val">추천 ${pctText(b.recommend_rate)} · 언급 ${pctText(b.mention_rate)}</span></button>`;
  }).join("");
  const shareRows = a.brands.map((b) => bar({
    label: b.name, badge: roleBadge(b), series: [{ pct: b.share, text: `${pctText(b.share)} (${b.n_mentioned}/${h.n_tracked_mentions})` }],
    open: { kind: "apibrand", brand: b.brand_id }, tip: `${b.name}: 추적 브랜드 전체 언급 ${h.n_tracked_mentions}건 중 ${b.n_mentioned}건. 선택한 ${a.brands.length}개 브랜드 사이의 비율이에요.`,
  })).join("");

  const lvCell = (levels, isOwn) => `<span class="lv${isOwn ? " own" : ""}" title="${esc(levels.map((l) => LEVEL[l][1]).join(", "))}">${levels.map((l) => LEVEL[l][0]).join("")}</span>`;
  const qRows = a.questions.map((q) => `<tr>
    <td class="num">${esc(q.intent_id ?? "-")}</td>
    <td class="q">${esc(q.text)}<small>${esc(q.question_id)} · 유효 ${q.n_valid}${q.n_error ? ` · 오류 ${q.n_error}` : ""}</small></td>
    ${a.brands.map((b) => `<td>${q.n_valid ? lvCell(q.brands[b.brand_id], b.role === "own") : "<span class='lv'>–</span>"}</td>`).join("")}
    <td>${esc(q.others.join(", ") || "–")}</td>
    <td>${q.response_ids.map((id, i) => `<button type="button" class="link" data-kind="response" data-rid="${esc(id)}">원문${q.response_ids.length > 1 ? ` ${i + 1}` : ""}</button>`).join("")}</td>
  </tr>`).join("");

  html += `<div class="viz-grid">
    ${chart({ title: "브랜드별 테스트 추천률·언급률", denom: `유효 응답 ${h.n_valid}건 · 브랜드당 응답 1건을 최대 1회 · 부정 언급도 언급에 포함`,
      legend: legend([["s1", "추천 확정"], ["pend", "추천 검수 대기(인용 없음·불명확)"], ["s1-light", "언급만(중립·비추천·불명확)"]]),
      body: `<div class="viz-bars">${rateRows}</div>`,
      table: tableView(["브랜드", "추천 확정", "검수 대기", "언급", "추천률", "언급률", "문항별 평균 추천률", "1번째 등장"], a.brands.map((b) => [b.name, b.n_recommended, b.n_pending, b.n_mentioned, pctText(b.recommend_rate), pctText(b.mention_rate), pctText(b.recommend_rate_qmean), b.n_first])),
      note: "막대 전체 길이가 언급률, 진한 부분이 추천률이에요. 문항마다 완료 횟수가 다르면 문항별 비율의 평균(표)을 기본값으로 봐요." })}
    ${chart({ title: "브랜드 언급 점유율", denom: `추적 브랜드 ${a.brands.length}개의 언급 ${h.n_tracked_mentions}건 기준`, body: `<div class="viz-bars">${shareRows}</div>`,
      table: tableView(["브랜드", "언급", "점유율"], a.brands.map((b) => [b.name, b.n_mentioned, pctText(b.share)])),
      note: "선택한 브랜드 사이의 지표예요. 전체 시장 점유율이 아니에요." })}
    ${chart({ title: "추적 외 브랜드 등장 (추천 확정)", denom: `유효 응답 ${h.n_valid}건 · 응답당 1회`, body: a.other_brands.length ? `<div class="viz-bars">${a.other_brands.map((o) => bar({ label: o.name, series: [{ pct: pct(o.n, h.n_valid), cls: state.myBrand.trim() ? (isMine(o.name) ? "s1" : "dim") : "s1", text: `${o.n}건` }] })).join("")}</div>` : `<p class="viz-empty">데이터 없음</p>`,
      note: "등록 브랜드 별칭과 정확히 일치하지 않는 표기예요. 오타·별칭 누락이면 프로젝트 설정의 별칭을 보완해요." })}
    ${chart({ title: "인용된 출처 도메인", denom: `유효 응답 ${h.n_valid}건 · 응답당 도메인 1회 · API citation 메타데이터만`, body: a.cited_hosts.length ? `<div class="viz-bars">${a.cited_hosts.map((o) => bar({ label: o.host, series: [{ pct: pct(o.n, h.n_valid), text: `${o.n}건(${pctText(pct(o.n, h.n_valid))})` }] })).join("")}</div>` : `<p class="viz-empty">데이터 없음</p>`,
      note: "브랜드별 인용률은 소유 도메인(owned_domains)이 등록되지 않아 데이터 없음이에요." })}
  </div>
  <section class="viz wide" style="margin-top:1rem"><h3>질문별 추천 브랜드</h3><p class="denom">문항마다 응답 1건씩 기호로 표시해요(반복 실행은 기호가 여러 개). 원문을 열면 답변 전체·판정 근거·인용 URL을 볼 수 있어요.</p>
    <div class="lv-key">${Object.values(LEVEL).map(([s, l]) => `<span>${s} ${esc(l)}</span>`).join("")}</div>
    <div style="overflow-x:auto"><table class="qtable"><thead><tr><th>의도</th><th>질문</th>${a.brands.map((b) => `<th>${esc(b.name)}${b.role === "own" ? " (자사)" : ""}</th>`).join("")}<th>그 외 추천</th><th>원문</th></tr></thead><tbody>${qRows}</tbody></table></div>
  </section>`;
  return `<section class="bd-series" id="apitest">${html}</section>`;
}

/* ---------- ④ 연결 데이터 ---------- */

function externalSection(d) {
  return `<section class="bd-series" id="external">${seriesHead("연결 데이터", "외부 소스", "소유 사이트 공식 내보내기·제휴 정산 같은 외부 기록은 연결 후보예요. 고객 계정 접근권한·계약이 아직 없어 모두 미연결이며, 0이 아니라 데이터 없음으로 둬요.")}
    <div class="ext-grid">${d.external.map((e) => `<div class="ext"><b>${esc(e.label)}</b><span class="st">미연결 · 데이터 없음</span><p>${esc(e.value)}</p><p>${esc(e.how)}</p></div>`).join("")}</div>
  </section>`;
}

/* ---------- 원문 서랍 ---------- */

function openDrawer(title, body) {
  const d = $("drawer");
  d.hidden = false;
  d.innerHTML = `<header><h2>${esc(title)}</h2><button class="btn ghost" id="close">닫기</button></header>${body}`;
  $("close").onclick = () => (d.hidden = true);
  d.scrollTop = 0;
  d.focus?.();
}

function highlightSpans(text, spans) {
  const sorted = spans.filter((s) => s.start != null && s.end != null && s.start < s.end && s.end <= text.length).sort((a, b) => a.start - b.start);
  let out = "";
  let pos = 0;
  for (const s of sorted) {
    if (s.start < pos) continue;
    out += `${esc(text.slice(pos, s.start))}<mark>${esc(text.slice(s.start, s.end))}</mark>`;
    pos = s.end;
  }
  return out + esc(text.slice(pos));
}

async function openEvidence({ slot, code, market }) {
  const s = state.data.consumer.slots.find((x) => x.slot === slot);
  const label = code === "__skipped__" ? "응답 안 함" : code === "__review__" ? "코드 없음(원문만)" : code === "" ? "원문 답변"
    : (s?.by_market?.flatMap((m) => m.codes) ?? s?.codes ?? s?.distribution ?? []).find((c) => c.code === code)?.label ?? code;
  const title = `${s?.title ?? slot} · ${market ? `${MARKET[market] ?? market} · ` : ""}${label}`;
  openDrawer(title, `<p class="thinking">원문을 불러오고 있어요…</p>`);
  const q = new URLSearchParams({ dataset: state.dataset, slot, code, ...(market ? { market } : {}), ...(state.category ? { category: state.category } : {}) });
  const { rows = [], error } = await fetch(`/api/interview-stats/evidence?${q}`).then((r) => r.json());
  if (error) return openDrawer(title, `<p class="error">${esc(error)}</p>`);
  openDrawer(title, `<p class="caveat">${rows.length}건 · 강조 부분이 Claude가 고른 근거 구간이며, 서버가 원문에 실제로 있는지 확인했어요. 참여자를 알아볼 수 있는 정보는 제출 단계에서 가리도록 안내해요.</p>
    <ol>${rows.map((r) => `<li>
      <div class="q">Q. ${esc(r.question_text ?? "(질문 없음: 자동 채움)")}</div>
      <p class="a">${r.answer_text != null ? highlightSpans(r.answer_text, [{ start: r.start_offset, end: r.end_offset }])
        : r.answer_kind === "skip" ? "(건너뜀)" : r.answer_kind === "option" ? "(보기를 눌러 답함)" : esc(r.value_text ?? "")}</p>
      <div class="meta"><span class="badge">${esc(SOURCE[r.source] ?? r.source ?? "-")}</span>${r.review_required ? `<span class="badge warn">검수 대기</span>` : ""}${r.rank ? `<span class="badge">${r.rank}순위</span>` : ""}
        <span>${esc(MARKET[r.market] ?? r.market)} · ${esc(r.lang)} · ${esc(r.interview_id.slice(-6))} · ${fmtDate(r.created_at)}</span></div></li>`).join("") || `<li>해당하는 원문이 없어요.</li>`}</ol>`);
}

async function openResponse(id) {
  openDrawer("API 테스트 응답 원문", `<p class="thinking">원문을 불러오고 있어요…</p>`);
  const r = await fetch(`/api/brand/api-test/responses/${encodeURIComponent(id)}`).then((x) => x.json());
  if (r.error) return openDrawer("API 테스트 응답 원문", `<p class="error">${esc(r.error)}</p>`);
  const MT = { recommended: "추천", discouraged: "비추천", neutral: "중립", uncertain: "불명확" };
  const spans = r.products.map((p) => ({ start: p.start_offset, end: p.end_offset }));
  openDrawer(`${r.question_id} · 응답 원문`, `
    <p class="caveat">${esc(r.question_text)}</p>
    <div class="meta"><span class="badge">${r.outcome === "valid" ? "유효" : `오류: ${esc(r.error ?? r.outcome)}`}</span><span class="badge">${r.search_used ? "웹 검색 실행" : "검색 미실행"}</span>
      <span>${esc(r.country)} · ${esc(r.model_id ?? "-")} · 수집 ${fmtDate(r.collected_at)} · 분석 ${esc(r.analysis_version ?? "-")}</span></div>
    <h3>브랜드·제품 판정 (${r.products.length})</h3>
    <ul class="judg">${r.products.map((p) => `<li><div><b>${esc(p.brand ?? "-")}</b> ${esc(p.product ?? "")} <span class="badge ${p.mention_type === "recommended" ? "info" : ""}">${esc(MT[p.mention_type] ?? p.mention_type)}</span>${p.review_required ? `<span class="badge warn">검수 대기${p.issues.length ? `: ${esc(p.issues.join(", "))}` : ""}</span>` : ""}${p.list_position ? `<span class="badge">${p.list_position}번째</span>` : ""}</div>
      <div class="ev">근거: ${esc(p.evidence_text ?? "-")}${p.citation_ids.length ? ` · 인용 ${esc(p.citation_ids.join(", "))}` : " · 연결된 인용 없음"}</div></li>`).join("") || "<li>판정 없음</li>"}</ul>
    <h3>답변 원문 (근거 구간 강조)</h3>
    <div class="raw">${r.text ? highlightSpans(r.text, spans) : "원문 없음"}</div>
    <h3>공식 citation (${r.citations.length})</h3>
    ${r.citations.length ? `<ol class="cites">${r.citations.map((c) => `<li>${esc(c.id)} <a href="${esc(safeHref(c.url) ?? "#")}" target="_blank" rel="noopener noreferrer nofollow">${esc(c.title || c.url)}</a> <small>${esc(host(c.url))}${c.in_search_results ? "" : " · 검색 결과 밖"}</small></li>`).join("")}</ol>` : `<p class="viz-empty">인용 없음 · 답변에 공식 citation이 붙지 않았어요.</p>`}`);
}

function openApiBrand(brandId) {
  const a = state.data.api_test;
  if (a.status !== "connected") return;
  const b = a.brands.find((x) => x.brand_id === brandId);
  if (!b) return;
  const rows = a.questions.filter((q) => q.brands[brandId].some((l) => l !== "none"));
  openDrawer(`${b.name} · 문항별 판정`, `<p class="caveat">유효 ${a.header.n_valid}건 중 언급 ${b.n_mentioned} · 추천 확정 ${b.n_recommended} · 검수 대기 ${b.n_pending} · 1번째 등장 ${b.n_first}. 문항별 평균 추천률 ${pctText(b.recommend_rate_qmean)}, 언급률 ${pctText(b.mention_rate_qmean)}.</p>
    <div class="lv-key">${Object.values(LEVEL).map(([s, l]) => `<span>${s} ${esc(l)}</span>`).join("")}</div>
    <ol>${rows.map((q) => `<li><div class="qrow"><span><span class="lv">${q.brands[brandId].map((l) => LEVEL[l][0]).join("")}</span> ${esc(q.intent_id ?? "")} ${esc(q.text)}</span>
      <span>${q.response_ids.map((id, i) => `<button type="button" class="link" data-kind="response" data-rid="${esc(id)}">원문${q.response_ids.length > 1 ? ` ${i + 1}` : ""}</button>`).join(" ")}</span></div></li>`).join("") || "<li>언급된 문항이 없어요.</li>"}</ol>`);
}

function openRecBrand(brand) {
  const r = state.data.recommend;
  if (!r.requests.total) return;
  const items = r.recent.flatMap((x) => x.candidates.filter((c) => normBrand(c.brand ?? "(브랜드 미표기)") === normBrand(brand)).map((c) => ({ ...c, rec: x })));
  openDrawer(`${brand} · 후보로 등장한 요청`, `<p class="caveat">최근 ${r.recent.length}건의 요청 안에서 찾은 후보예요. 가격·판매처는 검색 시점의 답변 원문에 그대로 있을 때만 표시해요.</p>
    <ol>${items.map((c) => `<li><div><b>${esc(c.product_name)}</b> <span class="badge">${c.explicit_rank ?? c.position}번째</span></div>
      <div class="ev">${esc(c.rec.question_text)}</div>
      <div class="meta">${c.price_text ? `<span class="badge">${esc(c.price_text)}${c.seller ? ` · ${esc(c.seller)}` : ""}</span>` : `<span class="badge">확인된 가격 없음</span>`}
        ${c.buy_url && safeHref(c.buy_url) ? `<a href="${esc(c.buy_url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(host(c.buy_url))}</a>` : ""}
        ${c.sources.map((s) => (safeHref(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(s.title || host(s.url))}</a>` : "")).join(" ")}
        <span>${fmtDate(c.rec.created_at)}</span> <button type="button" class="link" data-kind="recommendation" data-rid="${esc(c.rec.id)}">답변 원문</button></div></li>`).join("") || "<li>최근 요청 안에는 없어요.</li>"}</ol>`);
}

async function openRecommendation(id) {
  openDrawer("추천 답변 원문", `<p class="thinking">원문을 불러오고 있어요…</p>`);
  const r = await fetch(`/api/recommendations/${encodeURIComponent(id)}`).then((x) => x.json());
  if (r.error) return openDrawer("추천 답변 원문", `<p class="error">${esc(r.error)}</p>`);
  openDrawer(`${r.id.slice(-6)} · Claude 답변 원문`, `<p class="caveat">${esc(r.question_text)}</p>
    <div class="meta"><span class="badge">${esc(r.status)}${r.failure ? `: ${esc(FAILURE[r.failure] ?? r.failure)}` : ""}</span><span>${esc(r.collection?.search_country ?? "")} · ${esc(r.collection?.model_id ?? "-")} · 수집 ${fmtDate(r.collection?.collected_at)} · 웹 검색 ${r.collection?.search_used ? "실행" : "미실행"}</span></div>
    <div class="raw">${esc(r.answer_text ?? "원문 없음")}</div>
    <h3>공식 citation (${(r.sources ?? []).length})</h3>
    ${(r.sources ?? []).length ? `<ol class="cites">${r.sources.map((s) => `<li>${esc(s.id)} <a href="${esc(safeHref(s.url) ?? "#")}" target="_blank" rel="noopener noreferrer nofollow">${esc(s.title || s.url)}</a></li>`).join("")}</ol>` : `<p class="viz-empty">인용 없음</p>`}`);
}

/* ---------- 이벤트 ---------- */

function handleOpen(el) {
  const k = el.dataset.kind;
  if (k === "evidence") openEvidence({ slot: el.dataset.slot, code: el.dataset.code, market: el.dataset.market });
  else if (k === "response") openResponse(el.dataset.rid);
  else if (k === "apibrand") openApiBrand(el.dataset.brand);
  else if (k === "recbrand") openRecBrand(el.dataset.brand);
  else if (k === "recommendation") openRecommendation(el.dataset.rid);
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-kind]");
  if (el && el.dataset.kind !== "none") handleOpen(el);
});
const tip = $("tip");
function showTip(el, x, y) {
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  tip.style.left = `${Math.min(x + 14, innerWidth - tip.offsetWidth - 8)}px`;
  tip.style.top = `${y + 14}px`;
}
$("out").addEventListener("mousemove", (e) => {
  const el = e.target.closest("[data-tip]");
  if (!el) { tip.hidden = true; return; }
  showTip(el, e.clientX, e.clientY);
});
$("out").addEventListener("mouseleave", () => (tip.hidden = true));
$("out").addEventListener("focusin", (e) => {
  const el = e.target.closest("[data-tip]");
  if (!el) return;
  const r = el.getBoundingClientRect();
  showTip(el, r.left, r.bottom);
});
$("out").addEventListener("focusout", () => (tip.hidden = true));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { $("drawer").hidden = true; tip.hidden = true; } });

$("cats").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]");
  if (!b) return;
  state.category = b.dataset.cat;
  load();
});
$("dataset").addEventListener("click", (e) => {
  const b = e.target.closest("[data-ds]");
  if (!b) return;
  state.dataset = b.dataset.ds;
  load();
});
let brandTimer = null;
$("my-brand").addEventListener("input", (e) => {
  state.myBrand = e.target.value;
  localStorage.setItem("sieve.brand.my", state.myBrand);
  clearTimeout(brandTimer);
  brandTimer = setTimeout(() => { if (state.data) { const y = scrollY; render(); scrollTo(0, y); } }, 250);
});
$("reload").addEventListener("click", load);
$("my-brand").value = state.myBrand;
load();
