// Claude 출력 검증(가이드 5.1). 통과하지 못한 값은 저장 시 review_required로 표시하거나 고정 문구로 대체한다.
import { slotDef, allowedCodes, isOptionSlot } from "../codebook.mjs";

const EXCLUSIVE = new Set(["ai_none", "v_none"]);
export const QUESTION_MAX_CHARS = { ko: 120, en: 200 }; // 받는 말 포함 최대 2문장

/** needle이 haystack 안에 그대로 있는지 찾는다(공백 차이는 허용). 원문 기준 [start, end) 또는 null. */
export function locate(haystack, needle) {
  if (typeof needle !== "string" || !needle.trim()) return null;
  const n = needle.normalize("NFC");
  const direct = haystack.indexOf(n);
  if (direct >= 0) return [direct, direct + n.length];
  const map = [];
  let norm = "";
  for (let i = 0; i < haystack.length; i++) {
    if (/\s/.test(haystack[i])) {
      if (norm === "" || norm.endsWith(" ")) continue;
      norm += " ";
    } else norm += haystack[i];
    map.push(i);
  }
  const target = n.replace(/\s+/g, " ").trim();
  const at = norm.indexOf(target);
  if (at < 0) return null;
  return [map[at], map[at + target.length - 1] + 1];
}

/**
 * 자유 답변 분류 결과 검증. 코드북에 없는 코드, 원문에 없는 근거는 버리고 errors에 남긴다.
 * futureSlots: 같은 단계에서 아직 묻지 않은 보기형 슬롯(다른 슬롯 후보 검증용).
 */
export function validateExtraction(raw, { slot, answer, ctx, futureSlots = [] }) {
  const def = slotDef(slot);
  const errors = [];
  if (raw?.slot !== slot) errors.push("slot_mismatch");
  let status = raw?.status;
  if (!["clear", "ambiguous", "no_answer"].includes(status)) {
    errors.push("bad_status");
    status = "ambiguous";
  }

  const allowed = allowedCodes(slot, ctx);
  const codes = [];
  for (const c of Array.isArray(raw?.codes) ? raw.codes : []) {
    if (!allowed.has(c?.code)) { errors.push(`code_not_in_codebook:${c?.code}`); continue; }
    if (codes.some((x) => x.code === c.code)) { errors.push(`duplicate_code:${c.code}`); continue; }
    const span = locate(answer, c.evidence_text);
    if (!span) { errors.push(`evidence_not_in_answer:${c.code}`); continue; }
    codes.push({
      code: c.code,
      rank: def.type === "rank" ? c.rank : null,
      evidence_text: answer.slice(span[0], span[1]),
      start_offset: span[0],
      end_offset: span[1],
    });
  }

  if (def.type === "single" && codes.length > 1) errors.push("single_slot_multiple_codes");
  if (def.type === "rank") {
    const ranks = codes.map((c) => c.rank);
    const ok = codes.length <= def.max_rank
      && ranks.every((r) => Number.isInteger(r) && r >= 1 && r <= def.max_rank)
      && new Set(ranks).size === ranks.length;
    if (!ok) errors.push("invalid_rank");
    codes.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  }
  if (codes.length > 1 && codes.some((c) => EXCLUSIVE.has(c.code))) errors.push("exclusive_code_combined");

  const hints = [];
  for (const h of Array.isArray(raw?.other_slots) ? raw.other_slots : []) {
    if (!futureSlots.includes(h?.slot) || !isOptionSlot(h.slot)) continue;
    if (!allowedCodes(h.slot, ctx).has(h.code)) continue;
    const span = locate(answer, h.evidence_text);
    if (span) hints.push({ slot: h.slot, code: h.code, evidence_text: answer.slice(span[0], span[1]) });
  }

  const probe = typeof raw?.probe_question === "string" && raw.probe_question.trim() ? raw.probe_question.trim() : null;
  return { status, codes, hints, probe_question: probe, errors };
}

/** 질문 문장 검증. 실패하면 호출자가 고정 문구로 대체한다. */
export function validateQuestion(text, { lang, stage, blockedTerms = [] }) {
  const errors = [];
  if (typeof text !== "string" || !text.trim()) return ["empty"];
  const t = text.trim();
  if (t.length > (QUESTION_MAX_CHARS[lang] ?? 120)) errors.push("too_long");
  const sentences = t.split(/[.?!。？！]+/).filter((s) => s.trim()).length;
  if (sentences > 2) errors.push("too_many_sentences");
  if ((t.match(/[?？]/g) ?? []).length > 1) errors.push("multiple_questions");
  if (stage === "pre_offer") {
    const lower = t.toLowerCase();
    const hit = blockedTerms.find((term) => term && lower.includes(term.toLowerCase()));
    if (hit) errors.push(`blocked_term:${hit}`);
  }
  if (/<[a-z/][^>]*>/i.test(t)) errors.push("markup");
  return errors;
}
