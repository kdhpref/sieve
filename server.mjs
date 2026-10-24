// 소비자 참여 화면 정적 서버. 외부 패키지 없음.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

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
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  const file = path === "/codebook.json" ? CODEBOOK : join(ROOT, path === "/" ? "index.html" : path);
  if (file !== CODEBOOK && !file.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
  }
}).listen(PORT, () => console.log(`sieve consumer screen: http://localhost:${PORT}`));
