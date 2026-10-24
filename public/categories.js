// 축 A 제품 유형. 코드·표시명은 docs/cosmetics-category-spec.md 2.1을 따른다.
// shape: 일러스트 형태, tint: 내용물 색. active=false는 "준비 중"으로 표시하고 선택할 수 없다.
export const CATEGORY_VERSION = "v0.1";

export const GROUPS = [
  {
    code: "SK", ko: "스킨케어", en: "Skincare", items: [
      { code: "SK-TONER", ko: "토너·스킨", en: "Toner", shape: "bottle", tint: "#BFE3DC", active: true },
      { code: "SK-PAD", ko: "토너패드", en: "Toner pad", shape: "padjar", tint: "#D9E8F5", active: true },
      { code: "SK-MIST", ko: "미스트", en: "Face mist", shape: "mist", tint: "#D6EEF0" },
      { code: "SK-SERUM", ko: "에센스·세럼·앰플", en: "Essence / serum / ampoule", shape: "dropper", tint: "#F3D9A8" },
      { code: "SK-EMUL", ko: "로션·에멀전", en: "Lotion / emulsion", shape: "pump", tint: "#F4EEE6" },
      { code: "SK-CREAM", ko: "크림", en: "Cream", shape: "jar", tint: "#F6F1EC" },
      { code: "SK-EYE", ko: "아이크림", en: "Eye cream", shape: "tube", tint: "#E9E2F3" },
      { code: "SK-OIL", ko: "페이스 오일", en: "Face oil", shape: "dropper", tint: "#EBCB7A" },
      { code: "SK-AIO", ko: "올인원", en: "All-in-one", shape: "jar", tint: "#DDEFE4" },
    ],
  },
  {
    code: "CL", ko: "클렌징", en: "Cleansing", items: [
      { code: "CL-OIL", ko: "클렌징 오일·밤", en: "Cleansing oil / balm", shape: "pump", tint: "#EFD58C" },
      { code: "CL-WATER", ko: "클렌징 워터", en: "Cleansing water", shape: "bottle", tint: "#E3F1F7" },
      { code: "CL-FOAM", ko: "클렌징 폼", en: "Foam cleanser", shape: "tube", tint: "#F7F7F7" },
      { code: "CL-PEEL", ko: "필링·각질 제거", en: "Peeling", shape: "tube", tint: "#F4DCD6" },
    ],
  },
  {
    code: "SU", ko: "선케어", en: "Sun care", items: [
      { code: "SU-CREAM", ko: "선크림", en: "Sunscreen", shape: "tube", tint: "#FFF3C9" },
      { code: "SU-STICK", ko: "선스틱", en: "Sun stick", shape: "stick", tint: "#FFE7A8" },
      { code: "SU-TONEUP", ko: "톤업 선크림", en: "Tone-up sunscreen", shape: "tube", tint: "#F8E1EA" },
    ],
  },
  {
    code: "MA", ko: "마스크·팩", en: "Masks", items: [
      { code: "MA-SHEET", ko: "시트 마스크", en: "Sheet mask", shape: "sheet", tint: "#DCEBF7" },
      { code: "MA-WASH", ko: "워시오프 팩", en: "Wash-off mask", shape: "jar", tint: "#D9D4CC" },
      { code: "MA-SLEEP", ko: "슬리핑 팩", en: "Sleeping mask", shape: "jar", tint: "#DCD6F2" },
    ],
  },
  {
    code: "BM", ko: "베이스", en: "Base", items: [
      { code: "BM-CUSHION", ko: "쿠션", en: "Cushion", shape: "compact", tint: "#EFD3BF" },
      { code: "BM-FOUND", ko: "파운데이션", en: "Foundation", shape: "pump", tint: "#E6C2A6" },
      { code: "BM-PRIMER", ko: "프라이머", en: "Primer", shape: "tube", tint: "#E5EEDF" },
      { code: "BM-CONCEAL", ko: "컨실러", en: "Concealer", shape: "stick", tint: "#EBC9AE" },
      { code: "BM-POWDER", ko: "파우더", en: "Powder", shape: "compact", tint: "#F3E6DC" },
    ],
  },
  {
    code: "CM", ko: "색조", en: "Color", items: [
      { code: "CM-LIP", ko: "립·틴트", en: "Lip / tint", shape: "lip", tint: "#E0727A" },
      { code: "CM-EYE", ko: "아이 메이크업", en: "Eye makeup", shape: "compact", tint: "#B9A3C9" },
      { code: "CM-CHEEK", ko: "치크", en: "Cheek", shape: "compact", tint: "#F2A7A0" },
    ],
  },
];
