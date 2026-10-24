// 축 B 구매 기준·고민. 코드·intent_id는 docs/cosmetics-category-spec.md 3장을 따른다.
// skinType: 같은 값끼리는 하나만 고를 수 있다(피부 타입). free: 고르면 자유 입력을 받는다.
export const CONCERN_GROUPS = [
  {
    ko: "피부 타입", hint: "하나만 골라 주세요. 민감한 편이라면 함께 고를 수 있어요.", items: [
      { code: "skin_dry", ko: "건성", en: "Dry", sub: { ko: "건조하고 당겨요", en: "Feels dry and tight" }, intent: "04", skinType: true },
      { code: "skin_oily", ko: "지성", en: "Oily", sub: { ko: "유분이 많아요", en: "Gets oily" }, intent: "06", skinType: true },
      { code: "skin_combo", ko: "복합성", en: "Combination", sub: { ko: "부위마다 달라요", en: "Varies by area" }, intent: "07", skinType: true },
      { code: "skin_unknown", ko: "잘 모름", en: "Not sure", sub: { ko: "질문으로 찾아볼게요", en: "We'll help you find out" }, intent: null, skinType: true },
      { code: "skin_sensitive", ko: "민감한 편", en: "Sensitive", sub: { ko: "자극에 예민해요", en: "Reacts easily" }, intent: "01" },
    ],
  },
  {
    ko: "피하고 싶은 성분", items: [
      { code: "avoid_fragrance", ko: "향료", intent: "02" },
      { code: "avoid_ethanol", ko: "에탄올", intent: "03" },
      { code: "avoid_other", ko: "다른 성분", intent: null, free: "피하고 싶은 성분을 적어 주세요" },
    ],
  },
  {
    ko: "원하는 사용감", items: [
      { code: "feel_nonsticky", ko: "끈적임 적음", intent: "05" },
      { code: "feel_light", ko: "가벼운 사용감", intent: "06" },
    ],
  },
  {
    ko: "쓰려던 상황", items: [
      { code: "use_premakeup", ko: "화장 전", intent: "08" },
      { code: "use_night", ko: "저녁 보습", intent: "09" },
      { code: "use_beginner", ko: "스킨케어 입문", intent: "10" },
    ],
  },
  {
    ko: "가격·용량", items: [
      { code: "price_per_volume", ko: "용량당 가격", intent: "11" },
      { code: "size_trial", ko: "작은 용량으로 먼저", intent: "12" },
      { code: "size_refill", ko: "리필·대용량", intent: "13" },
    ],
  },
  {
    ko: "구매 정보", items: [
      { code: "buy_official", ko: "공식 판매처·배송 확인", intent: "14" },
      { code: "info_local_lang", ko: "내 언어로 된 전성분·사용법", intent: "15" },
    ],
  },
  {
    ko: "그 밖의 고민", items: [
      { code: "other", ko: "직접 적을게요", intent: null, free: "어떤 고민이었는지 적어 주세요" },
    ],
  },
];

// 명세 3.2 피부 타입 유도 질문
export const SKIN_GUIDE = {
  question: {
    ko: "오후 2~3시쯤 거울을 보거나 얼굴을 만졌을 때 기름기가 얼마나 도나요?",
    en: "Around 2–3 pm, when you look in the mirror or touch your face, how oily is it?",
  },
  answers: [
    { code: "guide_oily", text: { ko: "기름종이나 수정 화장이 꼭 필요하고, 얼굴 전체가 번들거려요", en: "I need blotting paper or touch-ups, and my whole face is shiny" }, result: "skin_oily" },
    { code: "guide_combo", text: { ko: "코와 이마 주변만 번들거리고, 볼 쪽은 여전히 건조해요", en: "Only my nose and forehead are shiny; my cheeks still feel dry" }, result: "skin_combo" },
    { code: "guide_dry", text: { ko: "유분감은 거의 없고, 오히려 화장이 들뜨거나 각질이 일어나요", en: "Barely any oil; my makeup lifts or my skin gets flaky" }, result: "skin_dry" },
    { code: "guide_none", text: { ko: "어느 쪽도 아니거나 잘 모르겠어요", en: "None of these, or I'm not sure" }, result: "skin_unknown" },
  ],
};

// 명세 2.2 토너 속성 태그(선택)
export const TONER_ATTRS = [
  { key: "texture", ko: "제형", values: [["water", "묽은 워터"], ["essence", "점도 있는 에센스"], ["pad", "패드"], ["mist", "미스트"]] },
  { key: "usage", ko: "쓰는 방법", values: [["absorb", "흡수시키기"], ["wipe", "닦아내기"], ["layering", "여러 번 바르기"], ["pack", "화장솜 팩"]] },
  { key: "size", ko: "용량", values: [["mini", "소용량·미니"], ["regular", "일반"], ["large", "대용량"], ["refill", "리필"]] },
];

export const ALL_CONCERNS = CONCERN_GROUPS.flatMap((g) => g.items);
