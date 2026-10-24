# sieve

> **채팅창 다음의 인터페이스** — 한국의 엔터·게임 감각으로 만드는 personal agent

OpenAI·Anthropic·Google의 "도구형 비서"와 달리, sieve는 에이전트를 **키우고 수집하는 캐릭터**로, 할 일을 **퀘스트**로, 결과를 **보상 카드**로 바꿉니다.
에이전트는 사용자가 자리를 비운 사이 일하고(방치형 파견), 푸시·음성 브리핑으로 먼저 말을 겁니다 — 챗 화면을 열지 않아도 됩니다.

- 플랫폼: Web (PWA) → Vercel 배포
- 타깃: 한국 + 북미 동시, 이후 일본·동남아 (글로벌 전제 설계)

## 문서

| 문서 | 내용 |
| --- | --- |
| [K_Brand_GEO_Demo_Kickoff_20261024.md](docs/K_Brand_GEO_Demo_Kickoff_20261024.md) | Sieve K뷰티 AI 구매 과정 분석: 사업 구조(보상형 소비자 제출)와 데모 착수 보고서 v2.0 (에이전트 기준 문서) |

## 추천 근거 추적 데모 실행

고정 질문 1개(질문집 01번·한국어, 토너)를 Claude API + 웹 검색으로 실행하고, **추천 제품 → 근거 문장 → 공식 citation 출처** 흐름을 시각화한다. 외부 패키지 없이 Node 20+만으로 동작한다.

```bash
cp .env.local.example .env.local   # ANTHROPIC_API_KEY 입력
npm start                          # http://127.0.0.1:3000
npm test                           # 파싱·근거 검증 테스트
```

- 실행 기록은 `data/runs/<run_id>.json`에 원본 응답(raw JSON·SHA-256)과 함께 저장된다. 실행할 때마다 새 기록이 추가된다.
- `data/runs/example-0001.json`은 화면 확인용 **예시 데이터**(가상 브랜드·URL)이며 화면에 그렇게 표시된다. `node scripts/make-example.mjs`로 다시 만들 수 있다.
- 구조: `lib/providers`(Claude 호출) · `lib/extraction`(citation 파싱, 추천 판정 추출·검증) · `lib/runner.mjs`(비동기 수집) · `public/`(화면).
