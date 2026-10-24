// 정량 집계(가이드 6.2). 잠긴 단계의 interview_values만 센다.
// 분모는 그 슬롯을 질문받은 사람(answered + skipped). 검수 대기 값은 확정 비율에서 뺀다.
import { ORDER, slotDef, codeLabel, intentIdOf, isMarketSlot, marketsOf, marketOptionCodes, isTextSlot, SLOT_TITLES, CODEBOOK_VERSION } from "../codebook.mjs";

function allOptionCodes(slot) {
  const def = slotDef(slot);
  if (slot === "primary_concern_code") return slotDef("concern_codes").options.map((o) => o.code);
  if (def.options_by_market) return [...new Set(Object.values(def.options_by_market).flat().map((o) => o.code))];
  return (def.options ?? []).map((o) => o.code);
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const countBy = (rows, key) => rows.reduce((acc, r) => ((acc[r[key]] = (acc[r[key]] ?? 0) + 1), acc), {});

const MARKET_LANG = { KR: "ko", US: "en" };

/** 한 슬롯(또는 한 시장)의 행으로 분모·코드별 건수를 낸다. 분모는 질문받은 사람(answered + skipped). */
function summarize(slot, rows, codeList, labelOf) {
  const def = slotDef(slot);
  const ids = (pred) => new Set(rows.filter(pred).map((r) => r.interview_id));
  const answered = ids((r) => r.status === "answered");
  const skipped = ids((r) => r.status === "skipped");
  const asked = answered.size + skipped.size;
  const pct = (n) => (asked ? Math.round((n / asked) * 1000) / 10 : null);
  const out = {
    asked, answered: answered.size, skipped: skipped.size, skipped_pct: pct(skipped.size),
    not_asked: ids((r) => r.status === "not_asked").size,
    review_without_code: ids((r) => r.status === "answered" && r.value_code == null && r.review_required).size,
  };
  if (def.type === "scale") {
    const nums = rows.filter((r) => r.status === "answered").map((r) => r.value_num);
    out.distribution = [];
    for (let n = def.min; n <= def.max; n++) {
      const c = nums.filter((x) => x === n).length;
      out.distribution.push({ code: String(n), label: String(n), n_confirmed: c, pct: pct(c), n_pending: 0 });
    }
    out.median = median(nums);
  } else if (!isTextSlot(slot)) {
    out.codes = codeList.map((code) => {
      const confirmed = ids((r) => r.value_code === code && !r.review_required).size;
      const item = { code, label: labelOf(code), n_confirmed: confirmed, pct: pct(confirmed), n_pending: ids((r) => r.value_code === code && r.review_required).size };
      if (def.type === "rank") {
        item.n_top1 = ids((r) => r.value_code === code && r.rank === 1 && !r.review_required).size;
        item.pct_top1 = pct(item.n_top1);
      }
      return item;
    });
  }
  return out;
}

export function computeStats(store, { internal = true } = {}) {
  const flag = internal ? 1 : 0;
  const itvs = store.db.prepare("SELECT * FROM interviews WHERE is_internal_test = ? AND mode = 'research'").all(flag);
  const values = store.db.prepare(
    "SELECT v.*, i.market FROM interview_values v JOIN interviews i ON i.id = v.interview_id WHERE i.is_internal_test = ? AND i.mode = 'research'",
  ).all(flag);
  const calls = store.db.prepare(
    "SELECT c.cost_usd, c.error, c.purpose FROM llm_calls c JOIN interviews i ON i.id = c.interview_id WHERE i.is_internal_test = ? AND i.mode = 'research'",
  ).all(flag);

  const locked = itvs.filter((i) => i.pre_locked_at);
  const completed = itvs.filter((i) => i.post_completed_at);
  const cost = calls.reduce((s, c) => s + (c.cost_usd ?? 0), 0);
  const dates = locked.map((i) => i.pre_locked_at).sort();

  const header = {
    dataset: internal ? "internal_test" : "real",
    codebook_version: CODEBOOK_VERSION,
    // 추천 모드(recommendation-spec.md 5장)는 별도 계열이라 집계에 넣지 않고 건수만 알린다.
    recommend_excluded: store.db.prepare("SELECT COUNT(*) AS n FROM interviews WHERE is_internal_test = ? AND mode = 'recommend'").get(flag).n,
    started: itvs.length,
    pre_locked: locked.length,
    post_completed: completed.length,
    offer_shown: completed.filter((i) => i.offer_shown_at).length,
    period: dates.length ? { from: dates[0], to: dates.at(-1) } : null,
    markets: countBy(locked, "market"),
    recruitment_channels: countBy(locked, "recruitment_channel"),
    verification_levels: countBy(locked, "verification_level"),
    llm: {
      calls: calls.length,
      failed: calls.filter((c) => c.error).length,
      cost_usd: Number(cost.toFixed(4)),
      cost_per_locked_usd: locked.length ? Number((cost / locked.length).toFixed(4)) : null,
    },
  };

  const slots = [];
  for (const stage of ["pre_offer", "post_offer"]) {
    for (const slot of ORDER[stage]) {
      const rows = values.filter((v) => v.slot === slot);
      const entry = { stage, slot, title: SLOT_TITLES[slot], type: slotDef(slot).type, ...summarize(slot, rows, allOptionCodes(slot), (c) => codeLabel(slot, c, "ko")) };
      if (isMarketSlot(slot)) {
        // 같은 코드가 시장마다 다른 뜻이라 합산하지 않는다. 시장별 분모로 따로 센다.
        delete entry.codes;
        const markets = [...new Set([...marketsOf(slot), ...rows.map((r) => r.market)])];
        entry.by_market = markets.map((market) => {
          const mRows = rows.filter((r) => r.market === market);
          const known = marketOptionCodes(slot, market);
          const extra = [...new Set(mRows.map((r) => r.value_code).filter((c) => c && !known.includes(c)))];
          const lang = MARKET_LANG[market] ?? "ko";
          return { market, in_codebook: known.length > 0, ...summarize(slot, mRows, [...known, ...extra], (c) => codeLabel(slot, c, lang, market)) };
        });
      }
      slots.push(entry);
    }
  }

  // 가장 중요한 고민 → 질문집 구매 의도 ID. API 테스트와 의도 단위로 나란히 보기 위한 값.
  const primaryRows = values.filter((v) => v.slot === "primary_concern_code" && v.status === "answered" && v.value_code && !v.review_required);
  const intents = {};
  for (const r of primaryRows) {
    const id = intentIdOf(r.value_code) ?? "none";
    intents[id] = (intents[id] ?? 0) + 1;
  }

  return {
    header,
    slots,
    intents: Object.entries(intents).map(([intent_id, n]) => ({ intent_id, n })).sort((a, b) => a.intent_id.localeCompare(b.intent_id)),
    api_test: { status: "not_connected", note: "API 테스트 추천률 데이터가 이 화면에 아직 연결되지 않았습니다" },
  };
}

/** 막대 → 원문. code가 "__skipped__"면 건너뛴 응답, "__review__"면 코드 없이 검수 대기인 응답. */
export function evidenceFor(store, { internal = true, slot, code, market }) {
  slotDef(slot);
  let where = "v.slot = ? AND i.is_internal_test = ? AND i.mode = 'research'";
  const params = [slot, internal ? 1 : 0];
  if (market) { where += " AND i.market = ?"; params.push(market); }
  if (code === "__skipped__") where += " AND v.status = 'skipped'";
  else if (code === "__review__") where += " AND v.status = 'answered' AND v.value_code IS NULL AND v.review_required = 1";
  else if (slotDef(slot).type === "scale") { where += " AND v.status = 'answered' AND v.value_num = ?"; params.push(Number(code)); }
  else if (code) { where += " AND v.value_code = ?"; params.push(code); }
  else where += " AND v.status = 'answered'";
  return store.db.prepare(`
    SELECT v.interview_id, v.status, v.source, v.value_code, v.value_num, v.rank, v.value_text, v.review_required,
           v.evidence_text, v.start_offset, v.end_offset, v.created_at, i.market, i.lang,
           t.question_text, t.answer_text, t.answer_kind, t.question_source
    FROM interview_values v
    JOIN interviews i ON i.id = v.interview_id
    LEFT JOIN interview_turns t ON t.id = v.turn_id
    WHERE ${where}
    ORDER BY v.created_at DESC LIMIT 200`).all(...params);
}

