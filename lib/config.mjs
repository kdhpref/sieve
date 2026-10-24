// 데모 고정 설정. 질문집 9장 01번(한국어)을 그대로 사용한다.
export const QUESTION = {
  question_id: "q01-ko",
  intent_id: "01",
  language: "ko",
  country: "KR",
  version: "v1",
  text: "한국에서 구매할 수 있는 한국 브랜드 토너 중에서 민감한 피부를 고려한 제품을 비교해줘. 후보 3개와 비교 이유를 알려줘.",
};

export const COLLECT_SYSTEM = [
  "사용자의 구매 질문에 해당 언어로 답하라.",
  "현재 구매 가능성과 상품 정보를 확인하기 위해 웹 검색을 사용하라.",
  "확인된 정보와 확인되지 않은 정보를 구분하라.",
  "특정 브랜드에 유리한 조건을 추가하지 말라.",
  "추천 순서가 우열을 뜻하지 않으면 그 점을 명시하라.",
  "검색 출처는 제공되는 인용 기능으로 표시하라.",
].join(" ");

export const SETTINGS = {
  provider: "anthropic",
  model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5",
  web_search_tool: "web_search_20250305",
  max_uses: 3,
  max_tokens: 4000,
  user_location: { type: "approximate", country: "KR" },
  request_timeout_ms: 90_000,
  max_pause_continues: 3,
};
