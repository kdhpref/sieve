// 화면 로직. 모든 외부 문자열은 textContent로만 넣고, 링크는 http/https만 허용한다.

const $ = (sel) => document.querySelector(sel);
const SVG_NS = "http://www.w3.org/2000/svg";

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

function safeLink(url, label) {
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") {
      return h("a", { href: u.href, target: "_blank", rel: "noopener noreferrer" }, label ?? u.href);
    }
  } catch {}
  return h("span", { class: "muted" }, label ?? url);
}

const truncate = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

// SVG 텍스트를 픽셀 폭 기준으로 자른다. 한글·한자·가나는 라틴 문자보다 넓게 계산한다.
function fitText(t, px, fontPx) {
  let w = 0;
  for (let i = 0; i < t.length; i++) {
    w += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(t[i]) ? fontPx : fontPx * 0.58;
    if (w > px) return t.slice(0, Math.max(0, i - 1)) + "…";
  }
  return t;
}
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString("ko-KR", { hour12: false }) : "—");

const MENTION_LABEL = { recommended: "추천", discouraged: "비추천", neutral: "중립 언급", uncertain: "불명확" };
const STATUS_LABEL = { running: "수집 중", succeeded: "완료", partial: "일부 완료(출력 잘림)", failed: "실패" };
const KIND_LABEL = { api: "실제 API 응답", example: "예시 데이터" };

const state = { config: null, runs: [], run: null, selected: null, polling: null };

// ---------- 데이터 로드 ----------

async function api(path, opts) {
  const res = await fetch(path, opts);
  return { status: res.status, body: await res.json() };
}

async function loadConfig() {
  state.config = (await api("/api/config")).body;
  const { question, settings, api_key_configured } = state.config;
  $("#questionText").textContent = question.text;
  const meta = $("#questionMeta");
  meta.replaceChildren(
    ...[["질문 ID", question.question_id], ["언어·국가", `${question.language} · ${question.country}`], ["모델", settings.model], ["검색 도구", `${settings.web_search_tool} (max_uses ${settings.max_uses})`]].flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]),
  );
  const key = $("#keyStatus");
  key.textContent = api_key_configured ? "API 키 설정됨" : "API 키 없음 — 저장된 기록만 조회 가능";
  key.className = `key ${api_key_configured ? "ok" : "warn"}`;
  updateRunButton();
}

async function loadRuns() {
  state.runs = (await api("/api/runs")).body.runs;
  renderRunList();
}

async function openRun(id) {
  const { status, body } = await api(`/api/runs/${id}`);
  if (status !== 200) return;
  state.run = body;
  state.selected = null;
  renderRunList();
  renderRun();
  if (body.status === "running") startPolling(id);
}

function startPolling(id) {
  clearInterval(state.polling);
  state.polling = setInterval(async () => {
    const { body } = await api(`/api/runs/${id}`);
    if (body.status !== "running") {
      clearInterval(state.polling);
      state.polling = null;
      state.config.active_run_id = null;
      updateRunButton();
      await loadRuns();
      if (state.run?.run_id === id) openRun(id);
    }
  }, 3000);
}

function updateRunButton() {
  const btn = $("#runBtn");
  const hint = $("#runHint");
  const running = Boolean(state.config?.active_run_id);
  btn.disabled = !state.config?.api_key_configured || running;
  btn.textContent = running ? "수집 중…" : "이 질문 실행";
  hint.textContent = !state.config?.api_key_configured
    ? ".env.local에 ANTHROPIC_API_KEY를 넣고 서버를 다시 시작하세요."
    : running
      ? "새 실행 기록이 추가되는 중입니다. 수집은 수십 초 이상 걸릴 수 있습니다."
      : "실행할 때마다 별도 실행 기록이 저장됩니다.";
}

$("#runBtn").addEventListener("click", async () => {
  $("#runBtn").disabled = true;
  const { status, body } = await api("/api/runs", { method: "POST" });
  if (body.run_id) {
    state.config.active_run_id = body.run_id;
    updateRunButton();
    await loadRuns();
    openRun(body.run_id);
  } else {
    $("#runHint").textContent = body.error || `실행 실패 (HTTP ${status})`;
    updateRunButton();
  }
});

// ---------- 실행 목록 ----------

function renderRunList() {
  const list = $("#runList");
  if (!state.runs.length) return list.replaceChildren(h("li", { class: "muted" }, "아직 기록이 없습니다."));
  list.replaceChildren(
    ...state.runs.map((r) =>
      h(
        "li",
        { class: `run-item ${state.run?.run_id === r.run_id ? "active" : ""}`, onclick: () => openRun(r.run_id) },
        h("div", { class: "row" }, h("span", { class: `pill kind-${r.data_kind}` }, KIND_LABEL[r.data_kind] ?? r.data_kind), h("span", { class: `pill st-${r.status}` }, STATUS_LABEL[r.status] ?? r.status)),
        h("div", { class: "time" }, fmtTime(r.created_at)),
        r.products != null ? h("div", { class: "muted small" }, `추천 ${r.products} · citation ${r.citations ?? 0}`) : null,
      ),
    ),
  );
}

// ---------- 관계 계산 ----------

function indexRun(run) {
  const parsed = run.parsed ?? { segments: [], citations: [], search: { results: [], queries: [] }, text: "" };
  const products = run.analysis?.products ?? [];
  const segById = new Map(parsed.segments.map((x) => [x.id, x]));
  const citeById = new Map(parsed.citations.map((x) => [x.id, x]));
  const sources = [];
  const sourceByUrl = new Map();
  for (const c of parsed.citations) {
    if (!sourceByUrl.has(c.url)) {
      const src = { id: `u${sources.length + 1}`, url: c.url, title: c.title, domain: c.domain, citation_ids: [] };
      sources.push(src);
      sourceByUrl.set(c.url, src);
    }
    sourceByUrl.get(c.url).citation_ids.push(c.id);
  }
  const productsBySeg = new Map();
  for (const p of products) for (const sid of p.segment_ids) (productsBySeg.get(sid) ?? productsBySeg.set(sid, []).get(sid)).push(p);
  return { parsed, products, segById, citeById, sources, sourceByUrl, productsBySeg };
}

/** 선택된 노드와 연결된 제품·문장·출처 집합 */
function related(idx, sel) {
  const r = { products: new Set(), segments: new Set(), sources: new Set() };
  if (!sel) return null;
  const addSeg = (sid) => {
    r.segments.add(sid);
    for (const cid of idx.segById.get(sid)?.citation_ids ?? []) r.sources.add(idx.sourceByUrl.get(idx.citeById.get(cid).url).id);
  };
  if (sel.type === "product") {
    const p = idx.products.find((x) => x.id === sel.id);
    r.products.add(p.id);
    p.segment_ids.forEach(addSeg);
  } else if (sel.type === "segment") {
    addSeg(sel.id);
    for (const p of idx.productsBySeg.get(sel.id) ?? []) r.products.add(p.id);
  } else if (sel.type === "source") {
    r.sources.add(sel.id);
    const src = idx.sources.find((x) => x.id === sel.id);
    for (const seg of idx.parsed.segments) {
      if (seg.citation_ids.some((cid) => src.citation_ids.includes(cid))) {
        r.segments.add(seg.id);
        for (const p of idx.productsBySeg.get(seg.id) ?? []) r.products.add(p.id);
      }
    }
  }
  return r;
}

function select(sel) {
  const same = state.selected && sel && state.selected.type === sel.type && state.selected.id === sel.id;
  state.selected = same ? null : sel;
  renderRun();
}

// ---------- 실행 상세 ----------

function renderRun() {
  const run = state.run;
  const main = $("#main");
  if (!run) return;
  const idx = indexRun(run);
  const rel = related(idx, state.selected);

  const blocks = [renderBanner(run)];
  if (run.status === "running") {
    blocks.push(h("div", { class: "card center" }, h("div", { class: "spinner" }), "Claude가 웹 검색 후 답변을 작성하는 중입니다. 완료되면 자동으로 표시됩니다."));
  } else if (run.status === "failed" && !run.parsed) {
    blocks.push(h("div", { class: "card error" }, h("h3", {}, "수집 실패"), h("p", {}, run.error?.message ?? "알 수 없는 오류"), run.error?.http_status ? h("p", { class: "muted" }, `HTTP ${run.error.http_status} · ${run.error.type ?? ""}`) : null));
  } else {
    blocks.push(renderSummary(run, idx));
    blocks.push(h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, "추천 근거 흐름"), h("span", { class: "muted small" }, "노드를 클릭하면 연결된 근거만 강조됩니다")), renderGraph(idx, rel)));
    blocks.push(h("div", { class: "two-col" }, renderAnswer(idx, rel), renderDetail(idx)));
    blocks.push(renderSources(idx, rel));
    blocks.push(renderConditions(run));
  }
  main.replaceChildren(...blocks);
}

function renderBanner(run) {
  if (run.data_kind === "example") {
    return h("div", { class: "banner example" }, h("strong", {}, "예시 데이터"), " — 화면 구성 확인용으로 만든 가상 응답입니다. 실제 Claude 수집 결과가 아니며 브랜드·URL은 모두 가상입니다.");
  }
  return h(
    "div",
    { class: "banner api" },
    h("strong", {}, "저장된 실제 API 응답"),
    ` — 수집 시각 ${fmtTime(run.collection?.collected_at ?? run.created_at)} · 모델 ${run.collection?.model_id ?? run.settings?.model} · 표본 1건 (실시간 응답이 아닌 저장 기록)`,
  );
}

function renderSummary(run, idx) {
  const rec = idx.products.filter((p) => p.mention_type === "recommended");
  const review = idx.products.filter((p) => p.review_required).length;
  const stat = (label, value, note) => h("div", { class: "stat" }, h("div", { class: "stat-v" }, value), h("div", { class: "stat-l" }, label), note ? h("div", { class: "stat-n" }, note) : null);
  const analysisNote = run.analysis?.status === "failed" ? h("div", { class: "banner warn" }, `브랜드·추천 분석 실패: ${run.analysis.error}. 원문과 citation은 그대로 확인할 수 있습니다.`) : null;
  return h(
    "div",
    {},
    analysisNote,
    h(
      "div",
      { class: "stats" },
      stat("추천된 제품", run.analysis?.status === "succeeded" ? rec.length : "—", `언급 전체 ${idx.products.length}`),
      stat("공식 citation", idx.parsed.citations.length, `출처 URL ${idx.sources.length}개`),
      stat("검색 결과(인용 안 됨 포함)", idx.parsed.search.results.length, `검색 ${idx.parsed.search.queries.length}회`),
      stat("검수 대기", run.analysis?.status === "succeeded" ? review : "—", "근거 불일치·불명확"),
      stat("검색 실행", idx.parsed.search.used ? "예" : "아니오", run.status === "partial" ? "출력 잘림" : null),
    ),
  );
}

// 4단 흐름도: 질문 → 제품 → 근거 문장 → 출처
function renderGraph(idx, rel) {
  const { products, sources } = idx;
  const usedSegIds = new Set(products.flatMap((p) => p.segment_ids));
  let segs = idx.parsed.segments.filter((x) => usedSegIds.has(x.id));
  if (!products.length) segs = idx.parsed.segments.filter((x) => x.citation_ids.length);
  const segSourceIds = new Set(segs.flatMap((x) => x.citation_ids.map((cid) => idx.sourceByUrl.get(idx.citeById.get(cid).url).id)));
  const srcs = sources.filter((x) => segSourceIds.has(x.id));

  if (!segs.length) return h("p", { class: "muted" }, "연결할 근거 문장이 없습니다. (citation이 없는 응답이거나 분석 결과가 없음)");

  const W = 1080, rowH = 46, nodeH = 36, top = 34;
  const cols = { q: 10, p: 200, s: 450, u: 820 };
  const widths = { q: 150, p: 210, s: 330, u: 250 };
  const rows = Math.max(products.length, segs.length, srcs.length, 1);
  const H = top + rows * rowH + 10;
  const y = (i, n) => top + ((rows - n) * rowH) / 2 + i * rowH;

  const pos = new Map();
  products.forEach((p, i) => pos.set(p.id, { x: cols.p, y: y(i, products.length) }));
  segs.forEach((x, i) => pos.set(x.id, { x: cols.s, y: y(i, segs.length) }));
  srcs.forEach((x, i) => pos.set(x.id, { x: cols.u, y: y(i, srcs.length) }));
  const qPos = { x: cols.q, y: y(0, 1) };

  const dim = (kind, id) => (rel && !rel[kind].has(id) ? " dim" : "");
  const edge = (x1, y1, x2, y2, cls) => {
    const mx = (x1 + x2) / 2;
    return s("path", { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, class: `edge ${cls}` });
  };

  const edges = [];
  for (const p of products) {
    const a = pos.get(p.id);
    edges.push(edge(qPos.x + widths.q, qPos.y + nodeH / 2, a.x, a.y + nodeH / 2, `m-${p.mention_type}${dim("products", p.id)}`));
    for (const sid of p.segment_ids) {
      const b = pos.get(sid);
      if (b) edges.push(edge(a.x + widths.p, a.y + nodeH / 2, b.x, b.y + nodeH / 2, `m-${p.mention_type}${rel && !(rel.products.has(p.id) && rel.segments.has(sid)) ? " dim" : ""}`));
    }
  }
  for (const seg of segs) {
    const a = pos.get(seg.id);
    for (const cid of seg.citation_ids) {
      const src = idx.sourceByUrl.get(idx.citeById.get(cid).url);
      const b = pos.get(src.id);
      if (b) edges.push(edge(a.x + widths.s, a.y + nodeH / 2, b.x, b.y + nodeH / 2, `cite${rel && !(rel.segments.has(seg.id) && rel.sources.has(src.id)) ? " dim" : ""}`));
    }
  }

  const isSel = (type, id) => state.selected?.type === type && state.selected.id === id;
  const node = (type, id, p, w, label, sub, cls) =>
    s(
      "g",
      { class: `node ${cls}${isSel(type, id) ? " sel" : ""}`, transform: `translate(${p.x},${p.y})`, onclick: () => select({ type, id }) },
      s("title", {}, label),
      s("rect", { width: w, height: nodeH, rx: 8 }),
      s("text", { x: 10, y: sub ? 15 : 22, class: "nl" }, fitText(label, w - 20, type === "segment" ? 12 : 13)),
      sub ? s("text", { x: 10, y: 29, class: "ns" }, fitText(sub, w - 20, 11)) : null,
    );

  const nodes = [
    s("g", { class: "node q", transform: `translate(${qPos.x},${qPos.y})` }, s("rect", { width: widths.q, height: nodeH, rx: 8 }), s("text", { x: 10, y: 15, class: "nl" }, "질문"), s("text", { x: 10, y: 29, class: "ns" }, fitText(state.run.question.text, widths.q - 20, 11))),
    ...products.map((p) => node("product", p.id, pos.get(p.id), widths.p, p.product ? `${p.brand} ${p.product}` : p.brand, `${MENTION_LABEL[p.mention_type]}${p.review_required ? " · 검수 필요" : ""}`, `m-${p.mention_type}${dim("products", p.id)}`)),
    ...segs.map((x) => node("segment", x.id, pos.get(x.id), widths.s, x.text.replace(/\s+/g, " ").trim(), `${x.id} · citation ${x.citation_ids.length}`, `seg${x.citation_ids.length ? "" : " nocite"}${dim("segments", x.id)}`)),
    ...srcs.map((x) => node("source", x.id, pos.get(x.id), widths.u, x.domain ?? x.url, x.title, `src${dim("sources", x.id)}`)),
  ];

  const header = [["질문", cols.q], ["추천·언급 제품", cols.p], ["근거 문장 (답변 원문)", cols.s], ["인용 출처 (공식 citation)", cols.u]].map(([t, x]) => s("text", { x, y: 18, class: "colh" }, t));

  return h("div", { class: "graph-wrap" }, s("svg", { viewBox: `0 0 ${W} ${H}`, class: "graph", width: "100%" }, ...header, ...edges, ...nodes));
}

// 답변 원문: 근거 문장은 제품 판정 색, citation이 있는 문장에는 [c1] 표시
function renderAnswer(idx, rel) {
  const frag = idx.parsed.segments.map((seg) => {
    const prods = idx.productsBySeg.get(seg.id) ?? [];
    const mention = prods[0]?.mention_type;
    const cls = ["seg", seg.citation_ids.length ? "cited" : "", mention ? `hl-${mention}` : "", rel && !rel.segments.has(seg.id) ? "dim" : "", state.selected?.type === "segment" && state.selected.id === seg.id ? "sel" : ""].filter(Boolean).join(" ");
    return h(
      "span",
      { class: cls, onclick: seg.citation_ids.length || prods.length ? () => select({ type: "segment", id: seg.id }) : null },
      renderInline(seg.text),
      ...seg.citation_ids.map((cid) => h("sup", { class: "cref" }, cid)),
    );
  });
  return h("section", { class: "card answer" }, h("div", { class: "card-head" }, h("h2", {}, "답변 원문"), h("span", { class: "muted small" }, "밑줄 = 공식 citation이 붙은 문장")), h("div", { class: "answer-text" }, frag));
}

// **굵게** 정도만 해석하고 나머지는 그대로 텍스트로 둔다.
function renderInline(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part) => (part.startsWith("**") && part.endsWith("**") && part.length > 4 ? h("strong", {}, part.slice(2, -2)) : document.createTextNode(part)));
}

function renderDetail(idx) {
  const sel = state.selected;
  const wrap = (title, ...body) => h("section", { class: "card detail" }, h("h2", {}, title), ...body);
  if (!sel) {
    return wrap(
      "근거 상세",
      h("p", { class: "muted" }, "흐름도의 제품·문장·출처나 답변의 밑줄 문장을 클릭하세요."),
      idx.products.length ? h("ul", { class: "plist" }, idx.products.map((p) => h("li", { onclick: () => select({ type: "product", id: p.id }) }, h("span", { class: `pill m-${p.mention_type}` }, MENTION_LABEL[p.mention_type]), " ", p.brand, p.product ? ` · ${p.product}` : ""))) : null,
    );
  }
  const citeCard = (cid) => {
    const c = idx.citeById.get(cid);
    return h("div", { class: "cite" }, h("div", { class: "cite-h" }, h("span", { class: "cref" }, c.id), " ", safeLink(c.url, c.domain ?? c.url), c.in_search_results ? null : h("span", { class: "pill warn" }, "검색 결과 목록에 없음")), c.title ? h("div", { class: "small" }, c.title) : null, c.cited_text ? h("blockquote", {}, c.cited_text) : h("div", { class: "muted small" }, "인용 원문 없음"));
  };

  if (sel.type === "product") {
    const p = idx.products.find((x) => x.id === sel.id);
    return wrap(
      p.product ? `${p.brand} · ${p.product}` : p.brand,
      h("div", { class: "row" }, h("span", { class: `pill m-${p.mention_type}` }, MENTION_LABEL[p.mention_type]), p.list_position ? h("span", { class: "pill" }, `등장 순서 ${p.list_position}`) : null, p.explicit_rank ? h("span", { class: "pill" }, `명시 순위 ${p.explicit_rank}`) : null, p.review_required ? h("span", { class: "pill warn" }, "검수 필요") : null),
      h("h3", {}, "판정 근거 (원문 발췌)"),
      h("blockquote", { class: p.evidence_found ? "" : "bad" }, p.evidence_text || "—"),
      p.issues.length ? h("ul", { class: "issues" }, p.issues.map((x) => h("li", {}, x))) : h("p", { class: "ok small" }, "근거 문장이 원문에 존재함을 코드로 확인"),
      h("h3", {}, `근거를 뒷받침하는 출처 (${p.citation_ids.length})`),
      p.citation_ids.length ? p.citation_ids.map(citeCard) : h("p", { class: "muted" }, "이 근거 문장에는 공식 citation이 붙어 있지 않습니다. 모델의 일반 지식이거나 출처 표시가 누락된 문장일 수 있습니다."),
    );
  }
  if (sel.type === "segment") {
    const seg = idx.segById.get(sel.id);
    const prods = idx.productsBySeg.get(seg.id) ?? [];
    return wrap(`문장 ${seg.id}`, h("blockquote", {}, seg.text), prods.length ? h("p", { class: "small" }, "이 문장을 근거로 한 제품: ", prods.map((p) => `${p.brand}(${MENTION_LABEL[p.mention_type]})`).join(", ")) : null, h("h3", {}, `출처 (${seg.citation_ids.length})`), seg.citation_ids.length ? seg.citation_ids.map(citeCard) : h("p", { class: "muted" }, "공식 citation 없음"));
  }
  const src = idx.sources.find((x) => x.id === sel.id);
  return wrap(src.domain ?? "출처", h("p", {}, safeLink(src.url)), src.title ? h("p", { class: "small" }, src.title) : null, h("h3", {}, `이 출처의 인용 (${src.citation_ids.length})`), src.citation_ids.map(citeCard));
}

function renderSources(idx, rel) {
  const citedUrls = new Set(idx.sources.map((x) => x.url));
  const searchOnly = idx.parsed.search.results.filter((r) => !citedUrls.has(r.url));
  return h(
    "section",
    { class: "card" },
    h("h2", {}, "출처 구분"),
    h(
      "div",
      { class: "two-col tight" },
      h("div", {}, h("h3", {}, `공식 citation (${idx.sources.length})`), h("ul", { class: "slist" }, idx.sources.map((x) => h("li", { class: rel && !rel.sources.has(x.id) ? "dim" : "", onclick: () => select({ type: "source", id: x.id }) }, h("span", { class: "dom" }, x.domain), " ", h("span", { class: "muted small" }, truncate(x.title || x.url, 60)), h("span", { class: "pill" }, `인용 ${x.citation_ids.length}`))))),
      h("div", {}, h("h3", {}, `검색 결과에만 존재 (${searchOnly.length})`), h("p", { class: "muted small" }, "검색은 됐지만 답변에서 인용되지 않은 페이지. 추천 근거로 세지 않습니다."), h("ul", { class: "slist" }, searchOnly.map((r) => h("li", {}, h("span", { class: "dom" }, r.domain), " ", safeLink(r.url, truncate(r.title || r.url, 60)))))),
    ),
    idx.parsed.search.queries.length ? h("p", { class: "small" }, "실행된 검색어: ", idx.parsed.search.queries.map((q) => h("code", {}, q))) : null,
  );
}

function renderConditions(run) {
  const c = run.collection ?? {};
  const rows = [
    ["데이터 종류", KIND_LABEL[run.data_kind] ?? run.data_kind],
    ["실행 ID", run.run_id],
    ["상태", STATUS_LABEL[run.status] ?? run.status],
    ["질문 ID · 버전", `${run.question.question_id} · ${run.question.version}`],
    ["모델 (요청 / 응답)", `${run.settings.model} / ${c.model_id ?? "—"}`],
    ["검색 도구", `${run.settings.web_search_tool}, max_uses ${run.settings.max_uses}, 위치 ${run.settings.user_location?.country}`],
    ["수집 시각", fmtTime(c.collected_at)],
    ["응답 시간", c.latency_ms != null ? `${(c.latency_ms / 1000).toFixed(1)}초` : "—"],
    ["종료 사유", c.stop_reason ?? "—"],
    ["토큰 (입력 / 출력)", run.cost_estimate ? `${run.cost_estimate.input_tokens.toLocaleString()} / ${run.cost_estimate.output_tokens.toLocaleString()}` : "—"],
    ["추정 비용", run.cost_estimate ? `$${run.cost_estimate.usd} (계산 예시 단가 기준, 청구액 아님)` : "—"],
    ["원본 SHA-256", c.sha256 ? truncate(c.sha256, 24) : "—"],
  ];
  return h("section", { class: "card" }, h("h2", {}, "수집 조건"), h("dl", { class: "cond" }, rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])));
}

// ---------- 시작 ----------

await loadConfig();
await loadRuns();
if (state.config.active_run_id) openRun(state.config.active_run_id);
else if (state.runs[0]) openRun(state.runs[0].run_id);
