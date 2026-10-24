# 화장품 카테고리 체계 명세

버전 v0.1 (초안) | 2026-10-24 | 기준 문서: [K_Brand_GEO_Demo_Kickoff_20261024.md](K_Brand_GEO_Demo_Kickoff_20261024.md)

소비자 제출의 ‘원래 고민’(pre_offer)과 API 테스트 질문집을 같은 기준으로 분류하기 위한 체계다. 본 문서의 분류·코드는 개발용 초안이며, 영어 표시명은 현지 언어 검수 전이다.

## 1 설계 원칙

1. **두 축 분리.** 무엇을 사는가(축 A 제품 유형)와 왜 찾는가(축 B 구매 기준·고민)를 별도로 기록한다. “민감 피부용 토너” 같은 결합 항목을 만들지 않는다.
2. **구매 의도 ID 공유.** 축 B의 각 항목은 질문집([data/question-set-v1.json](../data/question-set-v1.json))의 구매 의도 ID(01~15)에 매핑한다. 이 매핑으로 API 테스트와 소비자 제출을 의도 단위로 나란히 본다(착수 문서 12장).
3. **고정 코드 + 다국어 표시명.** 저장·집계는 코드로 하고, 화면에는 한국어·영어 표시명을 쓴다. 표시명을 바꿔도 코드는 바꾸지 않는다.
4. **P0는 토너만 활성.** 나머지 제품 유형은 코드만 정의하고 화면에 노출하지 않는다.
5. **효능이 아니라 진술로 기록.** 축 B는 소비자가 말한 고민이다. 제품이 그 고민에 맞는지, 효능이 있는지 판정하지 않는다(착수 문서 12장: 피부 적합성·의료적 효능 판정 도구로 확장하지 않음).

## 2 축 A. 제품 유형

### 2.1 대분류·중분류

`active`는 소비자가 선택할 수 있는지를 뜻한다. P0에서는 `SK-TONER`와 `SK-PAD`만 선택할 수 있다. `SK-PAD`는 별도 코드이지만 토너 캠페인 안의 선택지로 함께 받는다(5장 결정 사항 1). 비활성 유형은 화면에 “준비 중”으로 흐리게 표시하며 선택할 수 없다.

| 대분류 | 중분류 코드 | 한국어 | English | P0 active |
| --- | --- | --- | --- | --- |
| SK 스킨케어 | `SK-TONER` | 토너·스킨 | Toner | ✅ |
| | `SK-PAD` | 토너패드 | Toner pad | ✅ (토너 캠페인 내) |
| | `SK-MIST` | 미스트 | Face mist | |
| | `SK-SERUM` | 에센스·세럼·앰플 | Essence / serum / ampoule | |
| | `SK-EMUL` | 로션·에멀전 | Lotion / emulsion | |
| | `SK-CREAM` | 크림 | Cream | |
| | `SK-EYE` | 아이크림 | Eye cream | |
| | `SK-OIL` | 페이스 오일 | Face oil | |
| | `SK-AIO` | 올인원 | All-in-one | |
| CL 클렌징 | `CL-OIL` | 클렌징 오일·밤 | Cleansing oil / balm | |
| | `CL-WATER` | 클렌징 워터 | Cleansing water | |
| | `CL-FOAM` | 클렌징 폼 | Foam cleanser | |
| | `CL-PEEL` | 필링·각질 제거 | Peeling | |
| SU 선케어 | `SU-CREAM` | 선크림 | Sunscreen | |
| | `SU-STICK` | 선스틱 | Sun stick | |
| | `SU-TONEUP` | 톤업 선크림 | Tone-up sunscreen | |
| MA 마스크·팩 | `MA-SHEET` | 시트 마스크 | Sheet mask | |
| | `MA-WASH` | 워시오프 팩 | Wash-off mask | |
| | `MA-SLEEP` | 슬리핑 팩 | Sleeping mask | |
| BM 베이스 메이크업 | `BM-CUSHION` | 쿠션 | Cushion | |
| | `BM-FOUND` | 파운데이션 | Foundation | |
| | `BM-PRIMER` | 프라이머 | Primer | |
| | `BM-CONCEAL` | 컨실러 | Concealer | |
| | `BM-POWDER` | 파우더 | Powder | |
| CM 색조 메이크업 | `CM-LIP` | 립(틴트 등) | Lip / tint | |
| | `CM-EYE` | 아이 | Eye makeup | |
| | `CM-CHEEK` | 치크 | Cheek | |
| — | `OTHER` | 기타(직접 입력) | Other | ✅ |

바디·헤어는 초기 범위(미국 K뷰티 토너 캠페인) 밖이므로 정의하지 않는다.

### 2.2 토너 속성 태그 (P0)

토너는 하위 유형으로 더 나누지 않고 속성 태그로 구분한다. 소비자는 아는 것만 고르며, 모든 속성은 선택 사항이다.

| 속성 키 | 값 코드 | 한국어 | English |
| --- | --- | --- | --- |
| `texture` | `water` | 워터(묽은) 타입 | Watery |
| | `essence` | 에센스(점도 있는) 타입 | Essence-like (slightly thick) |
| | `pad` | 패드 | Pad |
| | `mist` | 미스트 | Mist |
| `usage` | `absorb` | 흡수용 | Pat in |
| | `wipe` | 닦아내기용 | Wipe off |
| | `layering` | 여러 번 레이어링 | Layering |
| | `pack` | 토너팩(화장솜 팩) | Toner mask (soaked cotton pads) |
| `size` | `mini` | 소용량·미니 | Mini / travel size |
| | `regular` | 일반 | Regular size |
| | `large` | 대용량 | Large size |
| | `refill` | 리필 | Refill |
| `us_class` | `cosmetic` | 일반 화장품 | Cosmetic |
| | `otc_drug` | 일반의약품(OTC) | OTC drug |

`us_class`는 미국 판매 상품이 FDA 기준으로 일반 화장품(cosmetic, MoCRA 적용 대상)인지 OTC 의약품(예: 미국에서는 자외선 차단제가 OTC 의약품으로 분류됨)인지에 따라 표시·광고 표현 범위가 달라지는 구분이다. 토너가 어느 쪽에 해당하는지는 제품별 성분·효능 표방에 따라 달라질 수 있으므로 확정값이 아니라 검토 항목으로 둔다. 소비자 입력이 아니라 Product 엔터티(착수 문서 9장)에 공식 상품 정보로 등록하는 값이며, 근거 URL 없이 저장하지 않는다.

## 3 축 B. 구매 기준·고민

복수 선택이다. 단, 피부 타입(`skin_dry`·`skin_oily`·`skin_combo`·`skin_unknown`)은 그중 하나만 고를 수 있고 `skin_sensitive`는 함께 고를 수 있다. 코드는 화면 선택지 단위이고, `intent_id`는 질문집 매핑이다. 서로 다른 선택지가 같은 `intent_id`를 가질 수 있다(06).

| 그룹 | 선택지 코드 | 한국어 | English | intent_id |
| --- | --- | --- | --- | --- |
| 피부 타입 | `skin_sensitive` | 민감성 | Sensitive | 01 |
| | `skin_dry` | 건성(건조함) | Dry | 04 |
| | `skin_oily` | 지성 | Oily | 06 |
| | `skin_combo` | 복합성 | Combination | 07 |
| | `skin_unknown` | 잘 모름 | Not sure | — |
| 피하고 싶은 성분 | `avoid_fragrance` | 향료 | Fragrance | 02 |
| | `avoid_ethanol` | 에탄올 | Alcohol (ethanol) | 03 |
| | `avoid_other` | 기타(직접 입력) | Other ingredients | — |
| 사용감 | `feel_nonsticky` | 끈적임 적음 | Not sticky | 05 |
| | `feel_light` | 가벼운 사용감 | Lightweight feel | 06 |
| 사용 상황 | `use_premakeup` | 화장 전 | Before makeup | 08 |
| | `use_night` | 저녁 보습 | Night-time hydration | 09 |
| | `use_beginner` | 스킨케어 입문 | New to skincare | 10 |
| 가격·용량 | `price_per_volume` | 용량당 가격 | Price per volume | 11 |
| | `size_trial` | 소용량으로 먼저 써보기 | Try a small size first | 12 |
| | `size_refill` | 리필·대용량 | Refill or large size | 13 |
| 구매 정보 | `buy_official` | 공식 판매처·배송 확인 | Official seller and shipping | 14 |
| | `info_local_lang` | 현지어 전성분·사용법 | Full ingredients and directions in my language | 15 |
| 기타 | `other` | 직접 입력 | Other (free text) | — |

### 3.1 질문집에 없는 고민

각질·피부결, 진정, 모공 등 질문집에 없는 고민은 `other` + 자유 입력으로 받는다. `intent_id`가 없으므로 API 테스트와 비교 대상이 아님을 화면·보고서에 표시한다. 자유 입력은 사람 검수로 묶어 두고, 반복되는 고민은 질문집 v2 추가 후보로 검토한다. 자유 입력을 근거로 새 코드를 자동 생성하지 않는다.

### 3.2 피부 타입을 모를 때의 유도 질문

`skin_unknown`을 고르면 바로 확정하지 않고, 생활 장면을 예로 든 질문 1개를 보여준다. 참여자의 자기 판단을 돕는 질문이며 피부 진단이 아니다. 화면과 보고서에서 “유도 질문으로 고른 피부 타입”으로 구분한다.

> 오후 2~3시쯤 거울을 보거나 얼굴을 만졌을 때 기름기가 얼마나 도나요?

| 답 코드 | 보기 | 결과 선택지 |
| --- | --- | --- |
| `guide_oily` | 기름종이나 수정 화장이 꼭 필요하고, 얼굴 전체가 번들거린다 | `skin_oily` (06) |
| `guide_combo` | 코와 이마 주변만 번들거리고, 볼 쪽은 여전히 건조하다 | `skin_combo` (07) |
| `guide_dry` | 유분감은 거의 없고, 오히려 화장이 들뜨거나 각질이 일어난다 | `skin_dry` (04) |
| `guide_none` | 어느 쪽도 아니거나 잘 모르겠다 | `skin_unknown` 유지 |

- 보기를 고르면 `concern_codes`의 `skin_unknown`을 결과 선택지로 바꾸고, `skin_type_source`=`guided`, `skin_guide_answer`=답 코드로 저장한다.
- 이 질문은 유분 기준이라 민감성을 판단하지 않는다. `skin_sensitive`는 피부 타입과 함께 따로 고를 수 있다.
- 질문은 건너뛸 수 있다. 건너뛰면 `skin_unknown`을 유지한다.
- 영어 문구는 현지 언어 검수 대상이다.

### 3.3 질문집 매핑 확인

질문집 v1의 15개 의도 중 축 B에 매핑되지 않은 의도는 없다. 06은 질문 본문이 “지성 피부 + 가벼운 사용감”을 함께 묻기 때문에 두 선택지가 같은 의도에 매핑된다. 소비자 집계에서는 선택지 단위 건수와 의도 단위 건수를 모두 보존한다.

## 4 소비자 제출 흐름에서의 사용

혜택 노출 전 기록(pre_offer) 단계에서 다음 순서로 받는다. 이 값은 pre_offer와 함께 잠기며 이후 수정할 수 없다(착수 문서 4장).

1. **제품 유형.** 대분류 탭과 일러스트 선반에서 1개를 고른다. 기본 선택은 없다. P0는 `SK-TONER`·`SK-PAD`만 선택할 수 있고, 목록에 없으면 “찾던 제품이 목록에 없어요”에서 `OTHER`와 자유 입력으로 받는다.
2. **토너 속성(선택).** 아는 항목만 고른다.
3. **고민(복수 선택).** 축 B에서 고른다. `skin_unknown`을 고르면 3.2의 유도 질문을 보여준다.
4. **가장 중요한 고민 1개(필수).** 3에서 고른 것 중 1개. API 문항이 의도 1개 단위이므로 대표 의도가 있어야 1:1 비교가 가능하다. 대표 고민이 `skin_unknown`·`other`처럼 의도가 없는 항목이면 `primary_intent_id`는 null이다.

화면에는 특정 브랜드·상품명·제휴 혜택을 함께 표시하지 않는다.

### 4.1 Submission 저장 필드 (pre_offer 단계 추가분)

| 필드 | 타입 | 규칙 |
| --- | --- | --- |
| `category_version` | string | 본 문서 버전(예: `v0.1`). 집계는 같은 버전끼리만 |
| `product_category` | string | 축 A 중분류 코드 1개. 필수 |
| `product_category_other` | string? | `OTHER`일 때만 |
| `product_attrs` | object | 2.2 속성 키·값 코드. 미선택 키는 생략 |
| `concern_codes` | string[] | 축 B 선택지 코드. 1개 이상 |
| `concern_other_text` | string? | `avoid_other`·`other` 선택 시 |
| `primary_concern_code` | string | `concern_codes` 중 1개. 필수 |
| `skin_type_source` | string? | 피부 타입 선택 시 `self`(직접 선택) 또는 `guided`(3.2 유도 질문) |
| `skin_guide_answer` | string? | 유도 질문에 답했을 때의 답 코드 |
| `intent_ids` | string[] | `concern_codes`에서 파생. 중복 제거. 저장 시 코드로 계산 |
| `primary_intent_id` | string? | `primary_concern_code`에서 파생. 없으면 null |

`intent_ids`·`primary_intent_id`는 파생값이다. 매핑표를 수정하면 원 선택값(`concern_codes`)에서 다시 계산하며, 소비자에게 재입력을 요구하지 않는다(착수 문서 8장: 원본과 판정 분리).

### 4.2 검증 규칙

- `product_category`는 2.1의 활성 코드여야 한다. 비활성 코드는 거절한다.
- `primary_concern_code`가 `concern_codes`에 없으면 거절한다.
- 자유 입력은 HTML 이스케이프 후 저장하고, 개인정보 포함 여부를 검수 단계에서 확인한다.

## 5 결정 사항과 미결 사항

| # | 항목 | 현재 결정 | 상태 |
| --- | --- | --- | --- |
| 1 | 토너패드를 토너에 포함할지 | 별도 코드 `SK-PAD`로 두되 P0 토너 캠페인에서 함께 받는다. 집계는 `SK-TONER`와 분리해 표시 | 결정 |
| 2 | “토너” ↔ “toner” 대응 | 영어권에서 “toner”는 수렴·각질 제거용(astringent, exfoliating toner)을 떠올리게 할 수 있고, K뷰티의 보습형 토너는 “essence”·“hydrating toner”·“lotion”(아시아 브랜드가 묽은 화장수를 부르는 표현)과 경계가 겹친다. 영어 표시명 전체를 현지 언어 검수 | 보류 (현재 표시명으로 진행) |
| 3 | `skin_unknown` 처리 | 유지하되, 고르면 3.2 유도 질문으로 피부 타입 선택을 돕는다. 유도로 고른 값은 `skin_type_source`로 구분 | 결정 |
| 4 | 질문집에 없는 고민의 편입 | 자유 입력 검수 후 질문집 v2에서 검토. 데모 중 코드 추가 없음 | 결정 |
| 5 | `us_class` 입력 주체 | 소비자가 아니라 공식 상품 정보 등록 시 근거 URL과 함께. cosmetic/OTC 구분 자체는 제품별 검토 항목 | 결정 |
