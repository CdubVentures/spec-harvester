const AUTOMATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS automation_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES automation_jobs(id),
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const VALID_TRANSITIONS = {
  queued: new Set(['running']),
  running: new Set(['done', 'failed']),
  failed: new Set(['queued']),
  done: new Set()
};

export class AutomationQueue {
  constructor(db) {
    this._db = db;
    db.exec(AUTOMATION_SCHEMA);
  }

  enqueue({ jobType, dedupeKey, payload }) {
    const existing = this._db.prepare(
      `SELECT * FROM automation_jobs WHERE dedupe_key = ?`
    ).get(dedupeKey);

    if (existing) {
      return this._parseRow(existing);
    }

    const result = this._db.prepare(
      `INSERT INTO automation_jobs (job_type, dedupe_key, payload) VALUES (?, ?, ?)`
    ).run(jobType, dedupeKey, JSON.stringify(payload || {}));

    return this._parseRow(
      this._db.prepare(`SELECT * FROM automation_jobs WHERE id = ?`).get(result.lastInsertRowid)
    );
  }

  transition(jobId, newStatus) {
    const job = this._db.prepare(`SELECT * FROM automation_jobs WHERE id = ?`).get(jobId);
    if (!job) return null;

    const allowed = VALID_TRANSITIONS[job.status];
    if (!allowed || !allowed.has(newStatus)) {
      throw new Error(`Invalid transition: ${job.status} → ${newStatus}`);
    }

    this._db.prepare(
      `UPDATE automation_jobs SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(newStatus, jobId);

    this._db.prepare(
      `INSERT INTO automation_actions (job_id, action) VALUES (?, ?)`
    ).run(jobId, `${job.status} → ${newStatus}`);

    return this._parseRow(
      this._db.prepare(`SELECT * FROM automation_jobs WHERE id = ?`).get(jobId)
    );
  }

  getJob(jobId) {
    const row = this._db.prepare(`SELECT * FROM automation_jobs WHERE id = ?`).get(jobId);
    return row ? this._parseRow(row) : null;
  }

  queryByStatus(status) {
    return this._db.prepare(
      `SELECT * FROM automation_jobs WHERE status = ? ORDER BY created_at ASC`
    ).all(status).map((row) => this._parseRow(row));
  }

  queryByJobType(jobType) {
    return this._db.prepare(
      `SELECT * FROM automation_jobs WHERE job_type = ? ORDER BY created_at ASC`
    ).all(jobType).map((row) => this._parseRow(row));
  }

  _parseRow(row) {
    return {
      ...row,
      payload: JSON.parse(row.payload || '{}')
    };
  }
}
