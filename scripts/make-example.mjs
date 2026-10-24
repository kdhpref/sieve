// 화면 확인용 예시 스냅샷 생성. 실제 Claude 응답이 아니며 브랜드·URL은 모두 가상이다.
// 실제 수집과 같은 파서·검증 코드를 거쳐 data/runs/example-0001.json 을 만든다.
import { QUESTION, SETTINGS } from "../lib/config.mjs";
import { parseCollected } from "../lib/extraction/parse.mjs";
import { validateProducts } from "../lib/extraction/analyze.mjs";
import { saveRun } from "../lib/store.mjs";

const cite = (url, title, cited_text) => ({ type: "web_search_result_location", url, title, cited_text, encrypted_index: "example" });
const A = "https://shop-a.example.com/toner/calm", B = "https://brand-b.example.org/products/hydra-toner",
  R = "https://review-site.example.net/sensitive-toner-2026", C = "https://mall-c.example.com/item/123";

const content = [
  { type: "text", text: "민감 피부용 토너를 확인하기 위해 검색해 보겠습니다." },
  { type: "server_tool_use", id: "srv1", name: "web_search", input: { query: "민감성 피부 토너 추천 한국 브랜드" } },
  { type: "web_search_tool_result", tool_use_id: "srv1", content: [
    { type: "web_search_result", url: A, title: "예시 브랜드 A 카밍 토너 | 공식몰", page_age: "2026-09-02" },
    { type: "web_search_result", url: B, title: "예시 브랜드 B 하이드라 토너", page_age: "2026-08-15" },
    { type: "web_search_result", url: R, title: "2026 민감 피부 토너 비교 리뷰 (예시)", page_age: "2026-10-01" },
    { type: "web_search_result", url: C, title: "예시 브랜드 C 약산성 토너 - 예시몰", page_age: "2026-07-20" },
    { type: "web_search_result", url: "https://blog.example.net/post/99", title: "토너 사용 후기 모음 (예시)", page_age: null },
  ]},
  { type: "text", text: "\n\n민감한 피부를 고려한 한국 브랜드 토너 후보 3개입니다. 나열 순서는 우열을 뜻하지 않습니다.\n\n1. **예시 브랜드 A 카밍 토너**\n" },
  { type: "text", text: "무향료이며 피부 자극 테스트를 완료했다고 공식몰에 표기되어 있어 민감 피부에 먼저 고려할 만합니다.", citations: [cite(A, "예시 브랜드 A 카밍 토너 | 공식몰", "무향료, 피부 자극 테스트 완료")] },
  { type: "text", text: " 리뷰 비교에서도 자극이 적다는 평가가 많았습니다.", citations: [cite(R, "2026 민감 피부 토너 비교 리뷰 (예시)", "A 토너는 자극 관련 불만이 가장 적었다")] },
  { type: "text", text: "\n\n2. **예시 브랜드 B 하이드라 토너**\n" },
  { type: "text", text: "보습 성분 중심의 처방으로 건조함을 함께 느끼는 민감 피부에 적합하다고 소개됩니다.", citations: [cite(B, "예시 브랜드 B 하이드라 토너", "보습 중심 처방, 건조한 민감 피부용")] },
  { type: "text", text: " 다만 에탄올 함유 여부는 확인되지 않았습니다." },
  { type: "text", text: "\n\n3. **예시 브랜드 C 약산성 토너**\n" },
  { type: "text", text: "약산성 pH를 표기하고 있으며 가격대가 낮아 처음 시도하기 좋습니다.", citations: [cite(C, "예시 브랜드 C 약산성 토너 - 예시몰", "pH 5.5 약산성"), cite(R, "2026 민감 피부 토너 비교 리뷰 (예시)", "C 토너는 가성비 항목에서 높은 점수")] },
  { type: "text", text: "\n\n참고로 예시 브랜드 D 토너는 향료가 포함되어 있어 향료를 피하려는 경우 권하지 않습니다.", citations: [cite(R, "2026 민감 피부 토너 비교 리뷰 (예시)", "D 토너는 향료 함유")] },
];

const parsed = parseCollected(content);
const products = validateProducts([
  { brand: "예시 브랜드 A", product: "카밍 토너", mention_type: "recommended", evidence_text: "무향료이며 피부 자극 테스트를 완료했다고 공식몰에 표기되어 있어 민감 피부에 먼저 고려할 만합니다.", segment_ids: ["s3", "s4"], list_position: 1, explicit_rank: 0, review_required: false },
  { brand: "예시 브랜드 B", product: "하이드라 토너", mention_type: "recommended", evidence_text: "보습 성분 중심의 처방으로 건조함을 함께 느끼는 민감 피부에 적합하다고 소개됩니다.", segment_ids: ["s6"], list_position: 2, explicit_rank: 0, review_required: false },
  { brand: "예시 브랜드 C", product: "약산성 토너", mention_type: "recommended", evidence_text: "약산성 pH를 표기하고 있으며 가격대가 낮아 처음 시도하기 좋습니다.", segment_ids: ["s9"], list_position: 3, explicit_rank: 0, review_required: false },
  { brand: "예시 브랜드 D", product: "토너", mention_type: "discouraged", evidence_text: "예시 브랜드 D 토너는 향료가 포함되어 있어 향료를 피하려는 경우 권하지 않습니다.", segment_ids: ["s10"], list_position: 4, explicit_rank: 0, review_required: false },
], parsed);

await saveRun({
  run_id: "example-0001",
  data_kind: "example",
  status: "succeeded",
  created_at: "2026-10-24T00:00:00.000Z",
  finished_at: "2026-10-24T00:00:00.000Z",
  question: QUESTION,
  settings: SETTINGS,
  collection: { collected_at: null, model_id: "(예시 — 수집 안 함)", stop_reason: "end_turn", latency_ms: null, usage: null, sha256: null, raw_responses: [] },
  parsed,
  analysis: { status: "succeeded", products },
  cost_estimate: null,
});
console.log("segments", parsed.segments.length, "citations", parsed.citations.length, "products", products.map((p) => [p.brand, p.segment_ids, p.citation_ids, p.issues]));
