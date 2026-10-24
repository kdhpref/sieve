// Claude API 웹 검색 테스트(질문집 30문항) 결과 읽기. 이전 API 측정 데모가 남긴 data/sieve.db를 읽기 전용으로 연다.
// 착수 문서 5장 지표: 언급률·추천률(확정/검수 대기 분리)·언급 점유율·표시 순서. 파일이 없으면 null(미연결 · 데이터 없음).
// 한국어(KR) 문항만 집계한다. 대상 시장을 영미권으로 바꾼 뒤 이전 일본어 문항은 범위 밖이고, 영어·US 문항은 아직 수집 전이다.
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { INTENTS } from "../recommend/query.mjs";

const LEGACY_CATEGORY = { toner: "SK-TONER" };
const QUESTION_LANG = "ko";
const COUNTRY = "KR";
const PREFIX_KO = "한국에서 구매할 수 있는 한국 브랜드 토너 중에서";
// 실제로 실행한 질문은 한국어다. 영어 화면에는 같은 의도의 영어 질문집 문장을 참고용으로 붙인다.
const PREFIX_EN = "Among Korean-brand toners available to buy in Korea,";
const questionText = (intent) => (intent && INTENTS[intent] ? {
  text: `${PREFIX_KO} ${INTENTS[intent].ko}`,
  text_en: `${PREFIX_EN} ${INTENTS[intent].en.charAt(0).toLowerCase()}${INTENTS[intent].en.slice(1)}`,
} : null);

const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null); // xs는 이미 % 값
const norm = (s) => String(s ?? "").normalize("NFC").replace(/\s+/g, "").toLowerCase();

/** 분석 결과의 브랜드 문자열을 등록 브랜드(별칭)로 맞춘다. 부분 일치가 아니라 별칭과 같을 때만(착수 문서 9장). */
function brandMatcher(brands) {
  const index = new Map();
  for (const b of brands) {
    for (const a of [b.canonical_name, ...(b.aliases_ko ?? []), ...(b.aliases_en ?? [])]) if (a) index.set(norm(a), b.brand_id);
  }
  return (name) => index.get(norm(name)) ?? null;
}

export function createApiTestReader(db) {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name));
  for (const t of ["projects", "runs", "responses", "analyses"]) if (!tables.has(t)) throw new Error(`legacy table missing: ${t}`);

  function project() {
    const row = db.prepare("SELECT data FROM projects ORDER BY updated_at DESC LIMIT 1").get();
    return row ? parse(row.data, null) : null;
  }

  /** 응답마다 가장 최근 분석 1개만 쓴다(재분석은 기존 판정을 대체, 착수 문서 8장). */
  function latestAnalyses() {
    const rows = db.prepare("SELECT * FROM analyses WHERE status = 'succeeded' ORDER BY created_at").all();
    const byResponse = new Map();
    for (const a of rows) byResponse.set(a.response_id, a);
    return byResponse;
  }

  function responses() {
    return db.prepare(`SELECT r.*, run.settings, run.question_set_version FROM responses r JOIN runs run ON run.run_id = r.run_id
      WHERE r.country = ? AND r.question_id LIKE ? ORDER BY r.collected_at`).all(COUNTRY, `%-${QUESTION_LANG}`);
  }

  return {
    /** 브랜드별·문항별 지표. category가 레거시 프로젝트의 제품 유형과 다르면 no_data. */
    overview({ category = null } = {}) {
      const prj = project();
      if (!prj) return { status: "not_connected", note: "저장된 API 테스트 프로젝트가 없습니다" };
      const prjCategory = LEGACY_CATEGORY[prj.category] ?? prj.category;
      if (category && category !== prjCategory) {
        return { status: "no_data", note: `API 테스트는 ${prjCategory} 질문집으로만 실행했습니다. 이 제품 유형의 테스트는 수집 전(데이터 없음)입니다.`, project_category: prjCategory };
      }
      const all = responses();
      const valid = all.filter((r) => r.outcome === "valid");
      const errors = all.filter((r) => r.outcome !== "valid");
      const analyses = latestAnalyses();
      const match = brandMatcher(prj.brands ?? []);
      const tracked = (prj.brands ?? []).map((b) => ({ brand_id: b.brand_id, role: b.role, name: b.canonical_name, name_en: b.aliases_en?.[0] ?? null }));

      // 응답별 브랜드 판정: 추천 확정 > 추천 검수 대기 > 언급(중립·비추천·불명확). 한 응답에서 브랜드당 1회만 센다.
      const perResponse = valid.map((r) => {
        const products = parse(analyses.get(r.response_id)?.products, []);
        const byBrand = new Map();
        const others = [];
        for (const p of products) {
          const id = match(p.brand);
          const level = p.mention_type === "recommended" ? (p.review_required ? "pending" : "recommended") : "mentioned";
          if (!id) { if (level === "recommended") others.push(p.brand); continue; }
          const cur = byBrand.get(id) ?? { level: null, first: false, products: new Set() };
          const rank = { recommended: 3, pending: 2, mentioned: 1 };
          if (!cur.level || rank[level] > rank[cur.level]) cur.level = level;
          if (p.list_position === 1) cur.first = true;
          if (p.product) cur.products.add(p.product);
          byBrand.set(id, cur);
        }
        const cites = parse(r.parsed, {}).citations ?? [];
        return { r, byBrand, others, products, cite_hosts: [...new Set(cites.map((c) => host(c.url)).filter(Boolean))] };
      });

      const questionIds = [...new Set(all.map((r) => r.question_id))].sort();
      const byQuestion = (qid) => perResponse.filter((x) => x.r.question_id === qid);
      const totalTrackedMentions = perResponse.reduce((s, x) => s + x.byBrand.size, 0);

      const brands = tracked.map((b) => {
        const has = (x, pred) => x.byBrand.has(b.brand_id) && pred(x.byBrand.get(b.brand_id));
        const mentioned = perResponse.filter((x) => has(x, () => true));
        const recommended = perResponse.filter((x) => has(x, (v) => v.level === "recommended"));
        const pending = perResponse.filter((x) => has(x, (v) => v.level === "pending"));
        const first = perResponse.filter((x) => has(x, (v) => v.first));
        // 문항별 완료 횟수가 다르면 문항별 비율의 평균을 기본값으로(착수 문서 5장 비교 가능성)
        const perQ = (set) => questionIds.map((qid) => { const q = byQuestion(qid); return q.length ? (q.filter((x) => set.includes(x)).length / q.length) * 100 : null; }).filter((v) => v != null);
        return {
          ...b,
          n_mentioned: mentioned.length, n_recommended: recommended.length, n_pending: pending.length, n_first: first.length,
          mention_rate: pct(mentioned.length, valid.length), recommend_rate: pct(recommended.length, valid.length),
          mention_rate_qmean: mean(perQ(mentioned)), recommend_rate_qmean: mean(perQ(recommended)),
          share: pct(mentioned.length, totalTrackedMentions),
          products: [...new Set(perResponse.flatMap((x) => [...(x.byBrand.get(b.brand_id)?.products ?? [])]))].slice(0, 5),
        };
      });

      const questions = questionIds.map((qid) => {
        const intent = qid.match(/^q(\d{2})/)?.[1] ?? null;
        const rows = byQuestion(qid);
        const errs = errors.filter((r) => r.question_id === qid).length;
        const qt = questionText(intent);
        return {
          question_id: qid, intent_id: intent, text: qt?.text ?? qid, text_en: qt?.text_en ?? qid,
          n_valid: rows.length, n_error: errs,
          brands: Object.fromEntries(tracked.map((b) => [b.brand_id, rows.map((x) => x.byBrand.get(b.brand_id)?.level ?? "none")])),
          others: [...new Set(rows.flatMap((x) => x.others))],
          response_ids: rows.map((x) => x.r.response_id),
        };
      });

      const otherCounts = {};
      for (const x of perResponse) for (const o of new Set(x.others)) otherCounts[o] = (otherCounts[o] ?? 0) + 1;
      const hostCounts = {};
      for (const x of perResponse) for (const h of x.cite_hosts) hostCounts[h] = (hostCounts[h] ?? 0) + 1;
      const settings = parse(all.at(-1)?.settings, {});
      const dates = valid.map((r) => r.collected_at).sort();
      const cost = all.reduce((s, r) => s + (r.cost_usd ?? 0), 0) + [...analyses.values()].reduce((s, a) => s + (a.cost_usd ?? 0), 0);

      return {
        status: "connected",
        note: `${COUNTRY}·한국어 ${questionIds.length}문항의 Claude API 웹 검색 테스트예요. 영어·US 문항은 수집 전(데이터 없음)이고, 이전 일본어 문항은 대상 시장 변경으로 범위 밖이라 넣지 않았어요.`,
        project: { project_id: prj.project_id, name: prj.name, category: prjCategory, brands: tracked },
        header: {
          question_set_version: all.at(-1)?.question_set_version ?? null, n_questions: questionIds.length,
          n_valid: valid.length, n_error: errors.length, n_search_used: valid.filter((r) => r.search_used).length,
          period: dates.length ? { from: dates[0], to: dates.at(-1) } : null,
          models: [...new Set(valid.map((r) => r.model_id).filter(Boolean))],
          search_tool: settings.web_search_tool ?? null, max_uses: settings.max_uses ?? null, country: COUNTRY, lang: QUESTION_LANG,
          cost_usd: Number(cost.toFixed(4)), n_tracked_mentions: totalTrackedMentions,
        },
        brands,
        questions,
        other_brands: Object.entries(otherCounts).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
        cited_hosts: Object.entries(hostCounts).map(([h, n]) => ({ host: h, n })).sort((a, b) => b.n - a.n).slice(0, 12),
      };
    },

    /** 원문 보기: 답변 텍스트, 인용 메타데이터, 브랜드 판정 근거 구간. 없으면 null. */
    response(id) {
      const r = db.prepare("SELECT * FROM responses WHERE response_id = ?").get(id);
      if (!r) return null;
      const a = latestAnalyses().get(id);
      const parsed = parse(r.parsed, {});
      const intent = r.question_id.match(/^q(\d{2})/)?.[1] ?? null;
      return {
        response_id: r.response_id, question_id: r.question_id, intent_id: intent,
        question_text: questionText(intent)?.text ?? r.question_id, question_text_en: questionText(intent)?.text_en ?? r.question_id,
        country: r.country, collected_at: r.collected_at, model_id: r.model_id, search_used: Boolean(r.search_used),
        outcome: r.outcome, error: parse(r.error, null)?.message ?? r.error ?? null,
        text: r.text ?? parsed.text ?? null,
        citations: (parsed.citations ?? []).map((c) => ({ id: c.id, url: c.url, title: c.title ?? null, in_search_results: Boolean(c.in_search_results) })),
        products: parse(a?.products, []).map((p) => ({
          brand: p.brand, product: p.product, mention_type: p.mention_type, evidence_text: p.evidence_text,
          start_offset: p.start_offset ?? null, end_offset: p.end_offset ?? null, list_position: p.list_position ?? null,
          citation_ids: p.citation_ids ?? [], review_required: Boolean(p.review_required), issues: p.issues ?? [],
        })),
        analysis_version: a?.version ?? null,
      };
    },
  };
}

/** data/sieve.db가 있을 때만 연다(로컬 전용). 없거나 열 수 없으면 null → 화면에는 미연결로 표시. */
export function openApiTest(file) {
  if (!existsSync(file)) return null;
  try {
    return createApiTestReader(new DatabaseSync(file, { readOnly: true }));
  } catch (err) {
    console.error("[api-test] 읽기 실패:", err.message);
    return null;
  }
}
