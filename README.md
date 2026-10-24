# sieve

소비자가 AI로 화장품을 알아보고 실제로 무엇을 샀는지, 또는 왜 사지 않았는지를 한·일 K뷰티 상품 단위로 연결해 브랜드에 제공한다. 소비자는 짧은 제출로 조사 보상을 받고, 브랜드는 조사비를 낸다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [K_Brand_GEO_Demo_Kickoff_20261024.md](docs/K_Brand_GEO_Demo_Kickoff_20261024.md) | Sieve K뷰티 AI 구매 과정 분석: 사업 구조(보상형 소비자 제출)와 데모 착수 보고서 v2.0 (에이전트 기준 문서) |
| [cosmetics-category-spec.md](docs/cosmetics-category-spec.md) | 화장품 카테고리 체계: 제품 유형 × 구매 기준·고민, 질문집 의도 ID 매핑 |
| [interview-guideline.md](docs/interview-guideline.md) | 소비자 맞춤 질문 지침(AI 인터뷰): 모델 선택, 다음 질문 규칙, 정량 코드북([data/interview-codebook-v0.1.json](data/interview-codebook-v0.1.json))과 집계 규칙 |

## 소비자 참여 화면 실행

소비자 참여 흐름의 혜택 노출 전(pre_offer) 4단계 화면이다. ① 찾던 제품 종류 → ② 원래 고민 → ③ AI 대화 공유 → ④ 확인 후 잠금. 분류 체계는 [cosmetics-category-spec.md](docs/cosmetics-category-spec.md), 3단계 슬롯과 보기는 [interview-guideline.md](docs/interview-guideline.md)와 `data/interview-codebook-v0.1.json`을 따른다. 외부 패키지 없이 Node만으로 동작한다.

```bash
npm start   # http://localhost:3000 (node server.mjs 3100 처럼 포트 지정 가능)
```

- 구조: `public/categories.js`(제품 유형), `public/concerns.js`(고민·피부 타입 유도 질문), `public/share.js`(3단계 대화 공유), `public/illustrations.js`(제품 일러스트 SVG), `public/app.js`(단계 이동·잠금), `server.mjs`(정적 서버, `/codebook.json`).
- 내부 테스트 화면이며 실제 보상을 지급하지 않는다. 기록은 브라우저 localStorage(`sieve.pre_offer.locked`)에만 저장되고, 잠근 뒤에는 화면에서 고칠 수 없다.
- 이전 API 측정 데모는 커밋 `458ee62`와 git stash에 보관되어 있다.
