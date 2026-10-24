// 인터뷰 API. 응답은 모두 JSON이며 API 키나 원본 Claude 응답은 내보내지 않는다.
import { HttpError } from "./interview/service.mjs";
import { computeStats, evidenceFor } from "./interview/stats.mjs";

const MAX_BODY = 16 * 1024;

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "요청이 너무 큽니다");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON 형식이 아닙니다");
  }
}

const send = (res, status, body) =>
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }).end(JSON.stringify(body));

export function createApi({ service, store, recommend }) {
  const routes = [
    ["POST", /^\/api\/interviews$/, async (req) => [201, await service.start(await readJson(req))]],
    ["GET", /^\/api\/interviews\/([\w-]+)$/, async (_req, [id]) => [200, service.get(id)]],
    ["GET", /^\/api\/interviews\/([\w-]+)\/turns$/, async (_req, [id]) => [200, { turns: service.turns(id) }]],
    ["POST", /^\/api\/interviews\/([\w-]+)\/answer$/, async (req, [id]) => [200, await service.answer(id, await readJson(req))]],
    ["POST", /^\/api\/interviews\/([\w-]+)\/lock$/, async (_req, [id]) => [200, await service.lock(id)]],
    ["POST", /^\/api\/interviews\/([\w-]+)\/offer$/, async (req, [id]) => [200, await service.offer(id, await readJson(req))]],
    ["POST", /^\/api\/recommendations$/, async (req) => {
      const { status, body } = recommend.create(await readJson(req));
      return [status, body];
    }],
    ["GET", /^\/api\/recommendations\/([\w-]+)$/, async (_req, [id]) => [200, recommend.get(id)]],
    ["GET", /^\/api\/interview-stats$/, async (_req, _m, q) => [200, computeStats(store, { internal: q.get("dataset") !== "real" })]],
    ["GET", /^\/api\/interview-stats\/evidence$/, async (_req, _m, q) => [200, {
      rows: evidenceFor(store, { internal: q.get("dataset") !== "real", slot: q.get("slot"), code: q.get("code"), market: q.get("market") || null }),
    }]],
  ];

  return async function handle(req, res) {
    const url = new URL(req.url, "http://x");
    if (!url.pathname.startsWith("/api/")) return false;
    const route = routes.find(([method, re]) => method === req.method && re.test(url.pathname));
    if (!route) { send(res, 404, { error: "없는 API입니다" }); return true; }
    try {
      const [status, body] = await route[2](req, url.pathname.match(route[1]).slice(1), url.searchParams);
      send(res, status, body);
    } catch (err) {
      if (err instanceof HttpError) send(res, err.status, { error: err.message });
      else if (/unknown slot/.test(err.message)) send(res, 400, { error: "없는 슬롯입니다" });
      else {
        console.error("[api]", req.method, url.pathname, err.message);
        send(res, 500, { error: "서버 오류가 발생했습니다" });
      }
    }
    return true;
  };
}
