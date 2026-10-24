import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCollected } from "../lib/extraction/parse.mjs";
import { validateProducts } from "../lib/extraction/analyze.mjs";

const content = [
  { type: "server_tool_use", name: "web_search", input: { query: "q" } },
  { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://a.example.com/x", title: "A" }] },
  { type: "text", text: "후보는 다음과 같습니다. " },
  { type: "text", text: "A 토너는 무향료입니다.", citations: [{ type: "web_search_result_location", url: "https://a.example.com/x", title: "A", cited_text: "무향료" }] },
  { type: "text", text: " B 토너도 있습니다.", citations: [{ type: "web_search_result_location", url: "https://z.example.com/", title: "Z", cited_text: "B" }] },
];

test("parse: segments, citations, search results are separated", () => {
  const p = parseCollected(content);
  assert.equal(p.segments.length, 3);
  assert.equal(p.text, "후보는 다음과 같습니다. A 토너는 무향료입니다. B 토너도 있습니다.");
  assert.deepEqual(p.segments[1].citation_ids, ["c1"]);
  assert.equal(p.citations[0].in_search_results, true);
  assert.equal(p.citations[1].in_search_results, false); // 검색 결과에 없는 citation은 표시
  assert.equal(p.search.used, true);
});

test("parse: tool error object is not treated as results", () => {
  const p = parseCollected([{ type: "server_tool_use", name: "web_search", input: { query: "q" } }, { type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } }]);
  assert.equal(p.search.used, false);
  assert.deepEqual(p.search.errors, ["max_uses_exceeded"]);
});

test("validate: evidence must exist verbatim, unknown segment ids dropped", () => {
  const p = parseCollected(content);
  const [ok, bad] = validateProducts([
    { brand: "A", product: "", mention_type: "recommended", evidence_text: "A 토너는 무향료입니다.", segment_ids: [], list_position: 1, explicit_rank: 0, review_required: false },
    { brand: "B", product: "", mention_type: "recommended", evidence_text: "B 토너가 최고입니다.", segment_ids: ["s9"], list_position: 2, explicit_rank: 0, review_required: false },
  ], p);
  assert.deepEqual(ok.segment_ids, ["s2"]); // 원문 위치로 segment 보강
  assert.deepEqual(ok.citation_ids, ["c1"]);
  assert.equal(ok.review_required, false);
  assert.equal(bad.evidence_found, false);
  assert.equal(bad.review_required, true);
  assert.deepEqual(bad.segment_ids, []);
});

test("validate: support segments add citations, drop unknown/duplicate ids", () => {
  const p = parseCollected(content);
  const [x] = validateProducts([
    { brand: "B", product: "", mention_type: "recommended", evidence_text: "후보는 다음과 같습니다.", segment_ids: ["s1"], support_segment_ids: ["s3", "s1", "s99"], list_position: 1, explicit_rank: 0, review_required: false },
  ], p);
  assert.deepEqual(x.segment_ids, ["s1"]);
  assert.deepEqual(x.support_segment_ids, ["s3"]); // 판정 문장 중복·없는 id 제거
  assert.deepEqual(x.citation_ids, ["c2"]); // 판정 문장엔 citation이 없어도 지원 문장의 출처가 연결됨
  assert.ok(x.issues.includes("존재하지 않는 지원 segment id 제거됨"));
});
