// 인터뷰 저장소(node:sqlite). 질문·답 원문(interview_turns)은 한 번 쓰면 바꾸지 않고,
// 정량 행(interview_values)은 단계 잠금 시 상태에서 파생해 쓴다. 기존 sieve.db와 분리된 파일을 쓴다.
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS interviews (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  lang TEXT NOT NULL,
  market TEXT NOT NULL,
  product_category TEXT NOT NULL,
  product_category_other TEXT,
  mode TEXT NOT NULL DEFAULT 'research',
  codebook_version TEXT NOT NULL,
  model_id TEXT,
  prompt_hash TEXT,
  is_internal_test INTEGER NOT NULL,
  verification_level TEXT NOT NULL,
  recruitment_channel TEXT NOT NULL,
  stage TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  pre_locked_at TEXT,
  offer_shown_at TEXT,
  post_completed_at TEXT
);
CREATE TABLE IF NOT EXISTS interview_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interview_id TEXT NOT NULL REFERENCES interviews(id),
  stage TEXT NOT NULL,
  slot TEXT NOT NULL,
  turn_no INTEGER NOT NULL,
  is_probe INTEGER NOT NULL,
  question_text TEXT NOT NULL,
  question_source TEXT NOT NULL,
  answer_kind TEXT,
  answer_codes_json TEXT,
  answer_value_num INTEGER,
  answer_text TEXT,
  asked_at TEXT NOT NULL,
  answered_at TEXT
);
CREATE TABLE IF NOT EXISTS interview_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interview_id TEXT NOT NULL REFERENCES interviews(id),
  stage TEXT NOT NULL,
  slot TEXT NOT NULL,
  value_code TEXT,
  value_num INTEGER,
  rank INTEGER,
  value_text TEXT,
  status TEXT NOT NULL,
  source TEXT,
  evidence_text TEXT,
  start_offset INTEGER,
  end_offset INTEGER,
  turn_id INTEGER,
  review_required INTEGER NOT NULL,
  review_status TEXT NOT NULL,
  codebook_version TEXT NOT NULL,
  model_id TEXT,
  prompt_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interview_id TEXT NOT NULL,
  turn_id INTEGER,
  slot TEXT,
  purpose TEXT NOT NULL,
  model_id TEXT,
  prompt_hash TEXT,
  input_json TEXT NOT NULL,
  raw_response_json TEXT,
  usage_json TEXT,
  cost_usd REAL,
  latency_ms INTEGER,
  stop_reason TEXT,
  error TEXT,
  validation_errors_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_values_slot ON interview_values(slot, value_code);
CREATE INDEX IF NOT EXISTS idx_turns_interview ON interview_turns(interview_id);
`;

const now = () => new Date().toISOString();

export function openStore(file) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  // mode 열이 없던 기존 DB 파일에 추가한다(기존 행은 조사 인터뷰).
  if (!db.prepare("PRAGMA table_info(interviews)").all().some((c) => c.name === "mode")) {
    db.exec("ALTER TABLE interviews ADD COLUMN mode TEXT NOT NULL DEFAULT 'research'");
  }

  const insert = (table, row) => {
    const keys = Object.keys(row);
    const sql = `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`;
    return Number(db.prepare(sql).run(...keys.map((k) => row[k] ?? null)).lastInsertRowid);
  };

  return {
    db,
    createInterview(row) {
      const ts = now();
      insert("interviews", { ...row, state_json: JSON.stringify(row.state_json), created_at: ts, updated_at: ts });
    },
    getInterview(id) {
      const row = db.prepare("SELECT * FROM interviews WHERE id = ?").get(id);
      return row ? { ...row, state: JSON.parse(row.state_json) } : null;
    },
    updateInterview(id, fields) {
      const f = { ...fields, updated_at: now() };
      if (f.state) { f.state_json = JSON.stringify(f.state); delete f.state; }
      const keys = Object.keys(f);
      db.prepare(`UPDATE interviews SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => f[k] ?? null), id);
    },
    insertTurn(row) {
      return insert("interview_turns", { ...row, asked_at: now() });
    },
    /** 답은 한 번만 기록된다. 이미 답한 턴이면 false. */
    answerTurn(id, { answer_kind, answer_codes, answer_value_num, answer_text }) {
      const r = db.prepare(`UPDATE interview_turns SET answer_kind = ?, answer_codes_json = ?, answer_value_num = ?, answer_text = ?, answered_at = ?
        WHERE id = ? AND answered_at IS NULL`).run(answer_kind, answer_codes ? JSON.stringify(answer_codes) : null, answer_value_num ?? null, answer_text ?? null, now(), id);
      return Number(r.changes) === 1;
    },
    turns(interviewId) {
      return db.prepare("SELECT * FROM interview_turns WHERE interview_id = ? ORDER BY id").all(interviewId);
    },
    insertValues(rows) {
      const ts = now();
      for (const r of rows) insert("interview_values", { ...r, created_at: ts });
    },
    insertLlmCall(row) {
      return insert("llm_calls", { ...row, created_at: now() });
    },
    transaction(fn) {
      db.exec("BEGIN");
      try {
        const out = fn();
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  };
}
