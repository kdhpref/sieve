# sieve

소비자가 AI로 화장품을 알아보고 실제로 무엇을 샀는지, 또는 왜 사지 않았는지를 한국·영미권 K뷰티 상품 단위로 연결해 브랜드에 제공한다. 소비자는 짧은 제출로 조사 보상을 받고, 브랜드는 조사비를 낸다. 초기 시장은 미국, 초기 분야는 토너다.

> 해커톤 데모다. 실제 보상 지급·결제·외부 참여자 모집은 하지 않으며, 화면의 소비자 제출은 모두 **내부 테스트**로 표시되고 실제 집계에서 제외된다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [K_Brand_GEO_Demo_Kickoff_20261024.md](docs/K_Brand_GEO_Demo_Kickoff_20261024.md) | 사업 구조(보상형 소비자 제출)와 데모 착수 보고서 v2.2. **모든 작업의 기준 문서** |
| [cosmetics-category-spec.md](docs/cosmetics-category-spec.md) | 화장품 카테고리 체계: 제품 유형 × 구매 기준·고민, 질문집 의도 ID 매핑 |
| [interview-guideline.md](docs/interview-guideline.md) | 소비자 맞춤 질문 지침(AI 인터뷰): 다음 질문 규칙, 정량 코드북([data/interview-codebook-v0.1.json](data/interview-codebook-v0.1.json))과 집계 규칙 |
| [recommendation-spec.md](docs/recommendation-spec.md) | 제품 추천 받기(데모 부가 기능): 조건 대화 → Claude 웹 검색 후보·출처, 조사 집계와 분리 |

## 실행

Node.js 24 이상이 필요하다(`node:sqlite` 사용). 외부 패키지는 없다.

```bash
cp .env.local.example .env.local   # ANTHROPIC_API_KEY 입력
```

```bash
npm start   # http://localhost:3000 (node server.mjs 3100 처럼 포트 지정 가능)
```

```bash
npm test
```

| 환경변수 | 용도 |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude 호출. 서버에서만 읽고 브라우저·로그에 출력하지 않는다. 없으면 인터뷰는 고정 문구 질문으로 진행된다 |
| `INTERVIEW_MODEL` | 인터뷰 모델(기본 `claude-sonnet-5-5`) |
| `RECOMMEND_MODEL` | 제품 추천 수집·분석 모델(기본은 `INTERVIEW_MODEL`과 같음) |
| `PORT` | 서버 포트(기본 3000) |

## 화면

| 경로 | 내용 |
| --- | --- |
| `/` | 소비자 참여 화면(한국어·영어 전환). 제품 종류를 고른 뒤 두 갈래로 나뉜다 |
| `/interview.html` | AI 인터뷰 화면(내부 테스트). 혜택 전 기록 → 결과와 이유 |
| `/stats.html` | 소비자 제출 정량 집계. 모든 막대에서 산정 대상 원문으로 이동 |

소비자 화면의 두 갈래:

- **구매 과정 공유하기**: 제품 종류 → AI 대화 붙여넣기 → 간단 질문(원래 고민) → 결과(산 제품·만족도 또는 안 산 이유) → 확인 후 잠금. 기록은 현재 브라우저 localStorage에만 저장되며, 잠근 뒤에는 화면에서 고칠 수 없다.
- **제품 추천 받기**(부가): 채팅으로 조건 대화를 진행한다. 보기가 4개 이하인 질문만 버튼을 함께 보여주고, 5개 이상이면 글로만 받는다. 조건이 확정되면 Claude 웹 검색으로 찾은 후보와 비교 이유·출처를 보여준다. 출처 검증을 통과한 항목만 표시하고 "Sieve 추천"으로 표기하지 않는다. 검색 시장(KR/US)은 대화 언어를 따른다.

## API

| API | 내용 |
| --- | --- |
| `POST /api/interviews` | 인터뷰 시작(mode: research / recommend) |
| `GET /api/interviews/:id`, `GET /api/interviews/:id/turns` | 상태와 질문·답 원문 |
| `POST /api/interviews/:id/answer` | 답 제출. 다음 질문은 서버가 정한다 |
| `POST /api/interviews/:id/lock` | 혜택 전(pre_offer) 기록 잠금 |
| `POST /api/interviews/:id/offer` | 혜택 노출 후(post_offer) 결과·이유 |
| `POST /api/recommendations` | 확정 조건으로 Claude 웹 검색 작업 생성(202) |
| `GET /api/recommendations/:id` | 진행 상태, 후보·근거·인용, 수집 조건 |
| `GET /api/interview-stats[?dataset=real]` | 소비자 제출 집계(기본은 내부 테스트) |
| `GET /api/interview-stats/evidence` | 집계 수치의 산정 대상 원문 |
| `GET /api/brand/overview[?category=]` | 브랜드 담당자용 요약. 소비자 제출·추천 요청·API 테스트를 합산하지 않고 각각 반환하며, 미연결 외부 데이터는 "데이터 없음"으로 표시 |
| `GET /api/brand/api-test/responses/:id` | API 테스트 응답 원문 |

브랜드 담당자 화면(`/brand.html`)은 아직 없고 API만 준비되어 있다.

## 구조

```
server.mjs              정적 서버 + /api 라우팅, /codebook.json
lib/api.mjs             라우트 정의
lib/interview/          인터뷰 흐름·Claude 호출·검증·저장(node:sqlite)·집계
lib/recommend/          제품 추천: 질문 조립·Claude 웹 검색·검증·제품 사진
lib/brand/              브랜드 요약 집계, 이전 API 측정 결과(data/sieve.db) 읽기 전용 조회
public/                 소비자 화면(app.js·share.js·recommend.js·i18n.js 등), 인터뷰·집계 화면
data/                   코드북·금칙어 JSON, 실제 API 응답 스냅샷, 로컬 DB(*.db, git 제외)
tests/                  node --test
```

## 데이터 원칙

- 원문(질문·답·Claude 응답)은 불변 저장하고 판정·집계는 따로 파생한다.
- API 테스트, 소비자 제출(자기보고), 추천 요청은 서로 다른 계열이며 합산하지 않는다.
- 예시·내부 테스트·미연결·추정 데이터는 실제 측정과 구분해 표시한다. 미연결은 0이 아니라 "데이터 없음"이다.
- `data/sieve.db`(이전 API 측정 데모 결과)는 있을 때만 읽기 전용으로 연다. 이전 API 측정 데모 코드는 커밋 `458ee62`에 있다.

## 배포

Vercel에서 동작한다. 서버리스에서는 DB를 `/tmp`에 두므로 인스턴스가 바뀌면 기록이 지워지는 시연용 저장이다. 추천 수집은 요청 안에서 끝까지 기다린다.
