// 판매 페이지 대표 사진(og:image) 찾기. 웹 검색은 사진을 주지 않으므로, 인용된 판매 페이지의 공개 메타 태그만 읽는다.
// 착수 문서 9장: URL 자동 수집은 내부 주소 접근을 막는다. http/https만, 사설·루프백 주소 거부, 리다이렉트마다 재검사.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 6000;

export function isPrivateAddress(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9")
    || v6.startsWith("fea") || v6.startsWith("feb") || v6.startsWith("ff");
}

/** http/https이고 공개 주소로만 풀리는 URL이면 URL 객체, 아니면 null */
export async function publicUrl(raw, resolve = lookup) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return null;
  if (u.port && !["80", "443"].includes(u.port)) return null;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return null;
  const addrs = isIP(host) ? [{ address: host }] : await resolve(host, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) return null;
  return u;
}

const attr = (tag, name) => tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"))?.slice(2).find((v) => v != null) ?? null;
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** HTML에서 og:image → twitter:image 순으로 찾는다. 상대 경로는 페이지 기준으로 푼다. */
export function extractImage(html, pageUrl) {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const key of ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"]) {
    for (const tag of metas) {
      const name = (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase();
      if (name !== key) continue;
      const content = attr(tag, "content");
      if (!content) continue;
      try {
        const u = new URL(decode(content.trim()), pageUrl);
        if (["http:", "https:"].includes(u.protocol)) return u.href;
      } catch { /* 다음 후보 */ }
    }
  }
  return null;
}

async function readCapped(res) {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString("utf8");
}

/** 실패하면 null(사진 없음). 예외를 던지지 않는다. */
export async function findProductImage(pageUrl, { fetchImpl = fetch, resolve = lookup } = {}) {
  try {
    let url = pageUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const safe = await publicUrl(url, resolve);
      if (!safe) return null;
      const res = await fetchImpl(safe.href, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (compatible; SieveDemo/0.1; product-image-preview)" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return null;
        url = new URL(loc, safe).href;
        continue;
      }
      if (!res.ok || !/html/i.test(res.headers.get("content-type") ?? "")) return null;
      return extractImage(await readCapped(res), safe.href);
    }
    return null;
  } catch {
    return null;
  }
}
