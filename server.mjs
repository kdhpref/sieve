// 의존성 없는 웹 서버: 정적 화면(public/)과 JSON API를 제공한다.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";

// .env.local 의 KEY=VALUE 를 읽는다 (이미 설정된 환경변수가 우선).
const envFile = join(import.meta.dirname, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const { QUESTION, SETTINGS } = await import("./lib/config.mjs");
const { getRun, listRuns } = await import("./lib/store.mjs");
const { startRun, activeRunId } = await import("./lib/runner.mjs");
const { hasApiKey } = await import("./lib/providers/claude.mjs");

const PUBLIC = join(import.meta.dirname, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function handleApi(req, res, url) {
  const path = url.pathname;
  if (req.method === "GET" && path === "/api/config") {
    return json(res, 200, { question: QUESTION, settings: SETTINGS, api_key_configured: hasApiKey(), active_run_id: activeRunId() });
  }
  if (req.method === "GET" && path === "/api/runs") return json(res, 200, { runs: await listRuns() });
  if (req.method === "POST" && path === "/api/runs") {
    const r = await startRun();
    return json(res, r.status, r);
  }
  const m = path.match(/^\/api\/runs\/([a-z0-9-]+)$/);
  if (req.method === "GET" && m) {
    const run = await getRun(m[1]);
    return run ? json(res, 200, run) : json(res, 404, { error: "not found" });
  }
  return json(res, 404, { error: "not found" });
}

async function serveStatic(res, url) {
  const rel = normalize(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return json(res, 403, { error: "forbidden" });
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else await serveStatic(res, url);
  } catch (err) {
    console.error("request error:", err.message);
    json(res, 500, { error: "internal error" });
  }
}).listen(PORT, HOST, () => {
  console.log(`sieve demo → http://${HOST}:${PORT}  (API key ${hasApiKey() ? "configured" : "NOT configured"})`);
});
