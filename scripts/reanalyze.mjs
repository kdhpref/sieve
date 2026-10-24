// 저장된 실행 기록의 원문으로 분석만 다시 수행한다. 유료 수집은 반복하지 않는다.
// 사용: node scripts/reanalyze.mjs <run_id>   (서버 API: POST /api/runs/<run_id>/reanalyze)
import { loadEnv } from "../lib/env.mjs";
loadEnv();
const { reanalyzeRun } = await import("../lib/runner.mjs");
const r = await reanalyzeRun(process.argv[2] ?? "");
console.log(JSON.stringify(r));
process.exit(r.status === 200 ? 0 : 1);
