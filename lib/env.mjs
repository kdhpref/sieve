// .env.local 의 KEY=VALUE 를 읽는다 (이미 설정된 환경변수가 우선). 값은 출력하지 않는다.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function loadEnv() {
  const file = join(import.meta.dirname, "..", ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
