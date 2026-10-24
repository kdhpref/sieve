// 축 A 제품 유형. 코드·표시명은 docs/cosmetics-category-spec.md 2.1을 따른다.
// shape: 일러스트 형태, tint: 내용물 색. active=false는 "준비 중"으로 표시하고 선택할 수 없다.
export const CATEGORY_VERSION = "v0.1";

export const GROUPS = [
  {
    code: "SK", ko: "스킨케어", items: [
      { code: "SK-TONER", ko: "토너·스킨", ja: "化粧水", shape: "bottle", tint: "#BFE3DC", active: true },
      { code: "SK-PAD", ko: "토너패드", ja: "トナーパッド", shape: "padjar", tint: "#D9E8F5", active: true },
      { code: "SK-MIST", ko: "미스트", ja: "ミスト化粧水", shape: "mist", tint: "#D6EEF0" },
      { code: "SK-SERUM", ko: "에센스·세럼·앰플", ja: "美容液", shape: "dropper", tint: "#F3D9A8" },
      { code: "SK-EMUL", ko: "로션·에멀전", ja: "乳液", shape: "pump", tint: "#F4EEE6" },
      { code: "SK-CREAM", ko: "크림", ja: "クリーム", shape: "jar", tint: "#F6F1EC" },
      { code: "SK-EYE", ko: "아이크림", ja: "アイクリーム", shape: "tube", tint: "#E9E2F3" },
      { code: "SK-OIL", ko: "페이스 오일", ja: "フェイスオイル", shape: "dropper", tint: "#EBCB7A" },
      { code: "SK-AIO", ko: "올인원", ja: "オールインワン", shape: "jar", tint: "#DDEFE4" },
    ],
  },
  {
    code: "CL", ko: "클렌징", items: [
      { code: "CL-OIL", ko: "클렌징 오일·밤", ja: "クレンジングオイル", shape: "pump", tint: "#EFD58C" },
      { code: "CL-WATER", ko: "클렌징 워터", ja: "クレンジングウォーター", shape: "bottle", tint: "#E3F1F7" },
      { code: "CL-FOAM", ko: "클렌징 폼", ja: "洗顔フォーム", shape: "tube", tint: "#F7F7F7" },
      { code: "CL-PEEL", ko: "필링·각질 제거", ja: "ピーリング", shape: "tube", tint: "#F4DCD6" },
    ],
  },
  {
    code: "SU", ko: "선케어", items: [
      { code: "SU-CREAM", ko: "선크림", ja: "日焼け止め", shape: "tube", tint: "#FFF3C9" },
      { code: "SU-STICK", ko: "선스틱", ja: "UVスティック", shape: "stick", tint: "#FFE7A8" },
      { code: "SU-TONEUP", ko: "톤업 선크림", ja: "トーンアップUV", shape: "tube", tint: "#F8E1EA" },
    ],
  },
  {
    code: "MA", ko: "마스크·팩", items: [
      { code: "MA-SHEET", ko: "시트 마스크", ja: "シートマスク", shape: "sheet", tint: "#DCEBF7" },
      { code: "MA-WASH", ko: "워시오프 팩", ja: "洗い流すパック", shape: "jar", tint: "#D9D4CC" },
      { code: "MA-SLEEP", ko: "슬리핑 팩", ja: "スリーピングパック", shape: "jar", tint: "#DCD6F2" },
    ],
  },
  {
    code: "BM", ko: "베이스", items: [
      { code: "BM-CUSHION", ko: "쿠션", ja: "クッションファンデ", shape: "compact", tint: "#EFD3BF" },
      { code: "BM-FOUND", ko: "파운데이션", ja: "ファンデーション", shape: "pump", tint: "#E6C2A6" },
      { code: "BM-PRIMER", ko: "프라이머", ja: "化粧下地", shape: "tube", tint: "#E5EEDF" },
      { code: "BM-CONCEAL", ko: "컨실러", ja: "コンシーラー", shape: "stick", tint: "#EBC9AE" },
      { code: "BM-POWDER", ko: "파우더", ja: "パウダー", shape: "compact", tint: "#F3E6DC" },
    ],
  },
  {
    code: "CM", ko: "색조", items: [
      { code: "CM-LIP", ko: "립·틴트", ja: "リップ・ティント", shape: "lip", tint: "#E0727A" },
      { code: "CM-EYE", ko: "아이 메이크업", ja: "アイメイク", shape: "compact", tint: "#B9A3C9" },
      { code: "CM-CHEEK", ko: "치크", ja: "チーク", shape: "compact", tint: "#F2A7A0" },
    ],
  },
];
