// 제품 유형 일러스트(SVG). 유리 용기는 내용물이 차오르는 애니메이션을 위해 몸통으로 clipPath를 만든다.
// 특정 브랜드·상품을 연상시키지 않도록 형태만 그린다.
const INK = "#1D2B2A";

// body: 몸통 요소(외곽선 + clipPath 공용), top: 내용물 영역의 위쪽 y, parts: 뚜껑·부속, glass: 투명 용기 여부
const SHAPES = {
  bottle: {
    body: `<rect x="38" y="44" width="44" height="82" rx="10"/>`, top: 44, glass: true,
    parts: `<rect x="50" y="32" width="20" height="14" rx="2" fill="#fff" stroke="${INK}" stroke-width="1.5"/>
            <rect x="46" y="12" width="28" height="22" rx="5" fill="${INK}"/>`,
  },
  padjar: {
    body: `<rect x="22" y="62" width="76" height="62" rx="12"/>`, top: 62, glass: true,
    parts: `<rect x="18" y="46" width="84" height="18" rx="7" fill="${INK}"/>
            <g fill="#fff" stroke="${INK}" stroke-width="1" opacity=".9">
              <ellipse cx="60" cy="84" rx="30" ry="5"/><ellipse cx="60" cy="94" rx="30" ry="5"/><ellipse cx="60" cy="104" rx="30" ry="5"/>
            </g>`,
  },
  mist: {
    body: `<rect x="40" y="48" width="40" height="78" rx="14"/>`, top: 48, glass: true,
    parts: `<rect x="52" y="28" width="16" height="22" rx="3" fill="${INK}"/>
            <rect x="66" y="31" width="10" height="5" rx="2" fill="${INK}"/>
            <g fill="${INK}" opacity=".35"><circle cx="86" cy="30" r="1.6"/><circle cx="93" cy="26" r="1.3"/><circle cx="92" cy="35" r="1.3"/><circle cx="99" cy="31" r="1"/></g>`,
  },
  dropper: {
    body: `<rect x="40" y="64" width="40" height="62" rx="9"/>`, top: 64, glass: true,
    parts: `<rect x="46" y="46" width="28" height="20" rx="3" fill="${INK}"/>
            <ellipse cx="60" cy="30" rx="9" ry="15" fill="${INK}"/>`,
  },
  pump: {
    body: `<rect x="36" y="56" width="48" height="70" rx="14"/>`, top: 56, glass: true,
    parts: `<rect x="48" y="44" width="24" height="14" rx="3" fill="${INK}"/>
            <rect x="55" y="26" width="10" height="20" fill="${INK}"/>
            <rect x="55" y="22" width="30" height="8" rx="3" fill="${INK}"/>`,
  },
  jar: {
    body: `<rect x="24" y="76" width="72" height="48" rx="12"/>`, top: 76, glass: true,
    parts: `<rect x="20" y="58" width="80" height="20" rx="8" fill="${INK}"/>`,
  },
  tube: {
    body: `<path d="M32 22 H88 L76 108 H44 Z"/>`, top: 22, glass: false,
    parts: `<rect x="32" y="16" width="56" height="8" rx="1" fill="#fff" stroke="${INK}" stroke-width="1.5"/>
            <rect x="46" y="108" width="28" height="18" rx="4" fill="${INK}"/>`,
  },
  stick: {
    body: `<rect x="44" y="58" width="32" height="68" rx="9"/>`, top: 58, glass: false,
    parts: `<rect x="44" y="18" width="32" height="38" rx="9" fill="${INK}" transform="rotate(-12 60 37)"/>`,
  },
  sheet: {
    body: `<path d="M30 20 H90 V126 H30 Z"/>`, top: 20, glass: false,
    parts: `<path d="M30 34 l4 -3 -4 -3" fill="none" stroke="${INK}" stroke-width="1.2"/>
            <path d="M60 46 C78 46 82 62 81 78 C80 98 70 112 60 112 C50 112 40 98 39 78 C38 62 42 46 60 46 Z" fill="#fff" stroke="${INK}" stroke-width="1.2"/>
            <g fill="${INK}" opacity=".7"><ellipse cx="52" cy="72" rx="5" ry="2.5"/><ellipse cx="68" cy="72" rx="5" ry="2.5"/><ellipse cx="60" cy="96" rx="6" ry="2.5"/></g>`,
  },
  compact: {
    body: `<ellipse cx="60" cy="100" rx="40" ry="22"/>`, top: 78, glass: false,
    parts: `<ellipse cx="60" cy="96" rx="28" ry="14" fill="#fff" opacity=".35"/>
            <path d="M20 96 C20 50 100 50 100 96" fill="#fff" stroke="${INK}" stroke-width="1.5" transform="translate(0 -40)"/>
            <path d="M32 54 C40 30 80 30 88 54" fill="none" stroke="${INK}" stroke-width="1" opacity=".3"/>`,
  },
  lip: {
    body: `<path d="M50 34 L70 46 V72 H50 Z"/>`, top: 34, glass: false,
    parts: `<rect x="46" y="70" width="28" height="12" rx="2" fill="#fff" stroke="${INK}" stroke-width="1.5"/>
            <rect x="44" y="82" width="32" height="44" rx="4" fill="${INK}"/>`,
  },
};

export function productSVG(item, idSuffix = "") {
  const s = SHAPES[item.shape];
  const id = `clip-${item.code}${idSuffix}`;
  const liquid = s.glass
    ? `<rect class="liquid" x="0" y="${s.top}" width="120" height="${130 - s.top}" fill="${item.tint}"/>`
    : `<rect x="0" y="0" width="120" height="140" fill="${item.tint}"/>`;
  return `<svg viewBox="0 0 120 140" aria-hidden="true" focusable="false" class="product ${s.glass ? "is-glass" : ""}">
    <defs><clipPath id="${id}">${s.body}</clipPath></defs>
    <g clip-path="url(#${id})">
      <g fill="#fff" opacity=".55">${s.body}</g>
      ${liquid}
      <rect x="0" y="0" width="9" height="140" fill="#fff" opacity=".45" transform="translate(${shineX(s)} 0)"/>
    </g>
    <g fill="none" stroke="${INK}" stroke-width="1.5">${s.body}</g>
    ${s.parts}
  </svg>`;
}

// 몸통 왼쪽 가장자리에 세로 반사광을 둔다
function shineX(s) {
  const m = s.body.match(/x="(\d+)"|M(\d+)|cx="(\d+)"/);
  const x = Number(m?.[1] ?? m?.[2] ?? m?.[3] ?? 40);
  return s.body.includes("ellipse") ? x - 30 : x + 6;
}
