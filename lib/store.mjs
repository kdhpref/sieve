// 실행 기록을 data/runs/<run_id>.json 으로 저장한다. (데모 단계: 파일 저장, 이후 SQLite로 이전)
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "..", "data", "runs");
const ID_RE = /^[a-z0-9-]+$/;

export async function saveRun(run) {
  await mkdir(DIR, { recursive: true });
  const file = join(DIR, `${run.run_id}.json`);
  await writeFile(`${file}.tmp`, JSON.stringify(run, null, 2));
  await rename(`${file}.tmp`, file);
}

export async function getRun(id) {
  if (!ID_RE.test(id)) return null;
  try {
    return JSON.parse(await readFile(join(DIR, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

export async function listRuns() {
  await mkdir(DIR, { recursive: true });
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".json"));
  const runs = await Promise.all(files.map((f) => getRun(f.slice(0, -5))));
  return runs
    .filter(Boolean)
    .map((r) => ({
      run_id: r.run_id,
      data_kind: r.data_kind,
      status: r.status,
      created_at: r.created_at,
      finished_at: r.finished_at ?? null,
      products: r.analysis?.products?.filter((p) => p.mention_type === "recommended").length ?? null,
      citations: r.parsed?.citations?.length ?? null,
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
