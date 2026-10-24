# 04. 기술 아키텍처 (초안)

웹에서 동작하며 Vercel에 배포하는 것을 전제로 한다.

## 1. 스택

| 영역 | 선택 (안) | 비고 |
| --- | --- | --- |
| 프레임워크 | **Next.js (App Router) + TypeScript** | Vercel 네이티브 |
| UI | Tailwind CSS, shadcn/ui, Framer Motion | 보상 연출·카드 애니메이션 |
| 캐릭터 연출 | 초기: 일러스트 + CSS/Lottie, 확장: Live2D(pixi-live2d-display) 또는 Rive | |
| LLM 연동 | **Vercel AI SDK** (+ AI Gateway) | 모델 교체·멀티 프로바이더·스트리밍 |
| 모델 | Claude (Sonnet 계열 = 메인 작업, Haiku 계열 = 캐릭터 대사·분류 등 경량 작업) | 비용 티어링 |
| 백그라운드 작업 (파견) | Vercel Workflow / Queues 또는 Inngest | 장시간·재시도 가능한 에이전트 실행 |
| 스케줄링 | Vercel Cron | 데일리 퀘스트 생성, 출석 리셋, 주간 리포트 |
| DB | Postgres (Neon 또는 Supabase) + Drizzle ORM | 유저, 캐릭터, 퀘스트, 카드, 재화 |
| 캐시 / 실시간 카운터 | Upstash Redis | 스태미나 회복, 레이트 리밋, 리더보드 |
| 인증 | Auth.js 또는 Clerk | 소셜 로그인(Google, Apple, Kakao, LINE) |
| 결제 | Stripe | 구독 + 단건(스킨) |
| 화면 없는 접점 | PWA + Web Push, TTS(음성 브리핑), 이메일(Resend) | |
| i18n | next-intl | ko / en / ja 우선 |
| 관측 | Vercel Analytics, Sentry, LLM 트레이싱(Langfuse 등) | |

## 2. 시스템 구성

```
┌────────────────────────── Client (PWA) ──────────────────────────┐
│  캐릭터 홈 · 퀘스트 보드 · 도감 · 보상 수령 연출 · (보조) 챗      │
└───────────────┬──────────────────────────────────▲───────────────┘
                │ Server Actions / Route Handlers  │ Web Push
┌───────────────▼──────────────────────────────────┴───────────────┐
│                    Next.js on Vercel                              │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ Game Engine │  │ Agent Runtime│  │ Notification Service     │ │
│  │ EXP/레벨/   │◀▶│ 오케스트레이터│─▶│ 푸시 · 이메일 · TTS      │ │
│  │ 재화/퀘스트 │  │ + 역할별 에이전트│ └──────────────────────────┘ │
│  └──────┬──────┘  └──────┬───────┘                               │
│         │                │ AI SDK / Tools (검색, 캘린더 …)        │
└─────────┼────────────────┼───────────────────────────────────────┘
          ▼                ▼
   Postgres / Redis     LLM Providers (Claude 등)
          ▲
   Vercel Cron / Workflow (파견 작업, 데일리 리셋)
```

### 핵심 설계 포인트

- **Agent Runtime ↔ Game Engine 분리**: 에이전트는 작업 결과(+메타데이터: 난이도, 사용 도구, 소요 시간)만 반환. 보상 계산은 Game Engine이 결정론적으로 수행 → 밸런스 조정이 모델과 독립적.
- **캐릭터 = 역할별 에이전트 설정**: `persona(말투, 보이스) + system prompt + 허용 도구 + 모델 티어`. 수집·전직은 이 설정의 해금/변경.
- **스태미나 = 토큰 예산**: 작업 견적(예상 토큰)을 행동력으로 환산. 서버에서 원자적으로 차감(Redis).
- **비동기 우선**: 파견 작업은 요청-응답이 아니라 job으로 실행, 상태(대기/진행/완료/수령)를 DB에 저장. 클라이언트는 수령 시점에 연출.

## 3. 초기 데이터 모델 (개략)

```
User(id, locale, timezone, rank, stamina, currency…)
Character(id, key, role, persona, model_tier, tools[])
UserCharacter(user_id, character_id, level, exp, affinity, skin_id)
Quest(id, user_id, type[daily|weekly|season|custom], spec, status, reward)
Dispatch(id, user_id, user_character_id, quest_id, status, started_at, finished_at, result_ref)
Card(id, user_id, dispatch_id, grade, title, content, share_slug)
Attendance(user_id, date)
Season(id, theme, starts_at, ends_at), SeasonPass(user_id, season_id, tier, premium)
```

## 4. 디렉터리 구조 (예정)

```
/app            Next.js 라우트 (홈, 퀘스트, 도감, 설정)
/components     UI · 연출 컴포넌트
/lib/agents     에이전트 런타임, 캐릭터 정의, 도구
/lib/game       레벨/보상/스태미나/퀘스트 로직 (순수 함수, 테스트 용이)
/lib/db         스키마, 쿼리
/messages       i18n 문자열 (ko, en, ja)
/docs           기획 문서
```
