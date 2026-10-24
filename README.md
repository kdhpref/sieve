# sieve

소비자가 AI로 화장품을 알아보고 실제로 무엇을 샀는지, 또는 왜 사지 않았는지를 한국·영미권 K뷰티 상품 단위로 연결해 브랜드에 제공한다. 소비자는 짧은 제출로 조사 보상을 받고, 브랜드는 조사비를 낸다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [K_Brand_GEO_Demo_Kickoff_20261024.md](docs/K_Brand_GEO_Demo_Kickoff_20261024.md) | Sieve K뷰티 AI 구매 과정 분석: 사업 구조(보상형 소비자 제출)와 데모 착수 보고서 v2.1 (에이전트 기준 문서) |
| [cosmetics-category-spec.md](docs/cosmetics-category-spec.md) | 화장품 카테고리 체계: 제품 유형 × 구매 기준·고민, 질문집 의도 ID 매핑 |
| [interview-guideline.md](docs/interview-guideline.md) | 소비자 맞춤 질문 지침(AI 인터뷰): 모델 선택, 다음 질문 규칙, 정량 코드북([data/interview-codebook-v0.1.json](data/interview-codebook-v0.1.json))과 집계 규칙 |
| [recommendation-spec.md](docs/recommendation-spec.md) | 제품 추천 받기(데모 부가 기능): 조건 대화 → Claude 웹 검색 결과·출처, 추천 참여 보상, 조사 집계와 분리 |

## 소비자 참여 화면 실행

소비자 참여 화면이다. 제품 종류를 고른 뒤 두 갈래로 나뉜다. **구매 과정 공유**(혜택 노출 전 pre_offer): ① 제품 종류 → ② AI 대화 붙여넣기 → ③ 원래 고민 → ④ AI 답 정리 → ⑤ 확인 후 잠금. **제품 추천 받기**: 지침([interview-guideline.md](docs/interview-guideline.md)) 기준 인터뷰를 채팅으로 진행한다(`public/recommend.js`, `/api/interviews`). 보기가 4개 이하인 질문만 버튼으로도 답할 수 있고, 5개 이상이면 글로만 답한다. 추천 결과 생성은 [recommendation-spec.md](docs/recommendation-spec.md) 기준으로 아직 구현 전이다.

```bash
npm start   # http://localhost:3000 (node server.mjs 3100 처럼 포트 지정 가능)
```

- 구조: `public/categories.js`(제품 유형), `public/concerns.js`(고민·피부 타입 유도 질문), `public/share.js`(대화 붙여넣기·AI 답 정리), `public/illustrations.js`(제품 일러스트 SVG), `public/app.js`(단계 이동·잠금), `server.mjs`(정적 서버, `/codebook.json`).
- 내부 테스트 화면이며 실제 보상을 지급하지 않는다. 기록은 브라우저 localStorage(`sieve.pre_offer.locked`)에만 저장되고, 잠근 뒤에는 화면에서 고칠 수 없다.
- 이전 API 측정 데모는 커밋 `458ee62`와 git stash에 보관되어 있다.
