// 소비자 참여 화면 정적 서버 + 인터뷰 API(/api/*). 외부 패키지 없음.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { loadEnv } from "./lib/env.mjs";
import { openStore } from "./lib/interview/store.mjs";
import { createClaude } from "./lib/interview/claude.mjs";
import { createInterviewService } from "./lib/interview/service.mjs";
import { createApi } from "./lib/api.mjs";
import { createRecommendClaude } from "./lib/recommend/claude.mjs";
import { createRecommendService } from "./lib/recommend/service.mjs";
import { openApiTest } from "./lib/brand/apitest.mjs";
import { createBrandService } from "./lib/brand/overview.mjs";
// data/ JSON은 import로 읽어야 Vercel 함수 번들에 함께 들어간다
import blockedTermsFile from "./data/interview-blocked-terms.json" with { type: "json" };
// 인터뷰 코드북(docs/interview-guideline.md)은 data/의 이 파일 하나만 내보낸다
import codebook from "./data/interview-codebook-v0.1.json" with { type: "json" };

loadEnv();
// Vercel 서버리스는 /tmp만 쓸 수 있다. 인스턴스가 바뀌면 지워지므로 시연용으로만 쓴다.
const DB_DIR = process.env.VERCEL ? "/tmp" : join(import.meta.dirname, "data");
const store = openStore(join(DB_DIR, "interview.db"));
const blockedTerms = blockedTermsFile.terms;
const claude = createClaude();
const recommend = createRecommendService({ store, claude: createRecommendClaude() });
// 이전 API 측정 데모의 결과(data/sieve.db)는 있을 때만 읽기 전용으로 연다. 없으면 브랜드 화면에 "미연결"로 표시된다.
const apiTest = openApiTest(join(import.meta.dirname, "data", "sieve.db"));
const brand = createBrandService({ store, apiTest });
const api = createApi({ service: createInterviewService({ store, claude, blockedTerms }), store, recommend, brand });

const ROOT = join(import.meta.dirname, "public");
const CODEBOOK_JSON = JSON.stringify(codebook);
const PORT = Number(process.argv[2] ?? process.env.PORT) || 3000;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

createServer(async (req, res) => {
  if (await api(req, res)) return;
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (path === "/codebook.json") return res.writeHead(200, { "content-type": TYPES[".json"] }).end(CODEBOOK_JSON);
  // Vercel에서는 public/을 CDN이 직접 서빙하고 함수에는 넣지 않으므로 "/"는 CDN의 index.html로 보낸다
  if (path === "/" && process.env.VERCEL) return res.writeHead(302, { location: "/index.html" }).end();
  const file = join(ROOT, path === "/" ? "index.html" : path);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
  }
}).listen(PORT, () => {
  console.log(`sieve consumer screen: http://localhost:${PORT}`);
  console.log(`interview: ${claude ? `Claude ${claude.model}` : "ANTHROPIC_API_KEY 없음 — 고정 문구로 진행"}`);
  console.log(`brand screen: http://localhost:${PORT}/brand.html (API 테스트 결과 ${apiTest ? "연결됨" : "미연결"})`);
});
