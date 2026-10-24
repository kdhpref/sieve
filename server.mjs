// 소비자 참여 화면 정적 서버 + 인터뷰 API(/api/*). 외부 패키지 없음.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { loadEnv } from "./lib/env.mjs";
import { openStore } from "./lib/interview/store.mjs";
import { createClaude } from "./lib/interview/claude.mjs";
import { createInterviewService } from "./lib/interview/service.mjs";
import { createApi } from "./lib/api.mjs";

loadEnv();
// Vercel 서버리스는 /tmp만 쓸 수 있다. 인스턴스가 바뀌면 지워지므로 시연용으로만 쓴다.
const DB_DIR = process.env.VERCEL ? "/tmp" : join(import.meta.dirname, "data");
const store = openStore(join(DB_DIR, "interview.db"));
const blockedTerms = JSON.parse(readFileSync(join(import.meta.dirname, "data", "interview-blocked-terms.json"), "utf8")).terms;
const claude = createClaude();
const api = createApi({ service: createInterviewService({ store, claude, blockedTerms }), store });

const ROOT = join(import.meta.dirname, "public");
// 인터뷰 코드북(docs/interview-guideline.md)은 data/의 이 파일 하나만 내보낸다
const CODEBOOK = join(import.meta.dirname, "data", "interview-codebook-v0.1.json");
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
  const file = path === "/codebook.json" ? CODEBOOK : join(ROOT, path === "/" ? "index.html" : path);
  if (file !== CODEBOOK && !file.startsWith(ROOT)) return res.writeHead(403).end();
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
