// 소비자 참여 화면 정적 서버 + 인터뷰 API(/api/*). 외부 패키지 없음.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { loadEnv } from "./lib/env.mjs";
import { openStore } from "./lib/interview/store.mjs";
import { createClaude } from "./lib/interview/claude.mjs";
import { createInterviewService } from "./lib/interview/service.mjs";
import { createApi } from "./lib/api.mjs";
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
const api = createApi({ service: createInterviewService({ store, claude, blockedTerms }), store });

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
  // Vercel에서는 public/을 CDN이 직접 서빙하고, "/"는 vercel.json에서 index.html로 돌린다
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
});
