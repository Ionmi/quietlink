import { Database } from "bun:sqlite";
import type { SessionSummary } from "../domain/session";

export type SecondRow = { ts: number; target: string; count: number; sum: number; min: number; max: number; lost: number; late: number };
export type EventRow = { ts: number; kind: string; data: any };

const HOUR = 3_600_000;

/** Local SQLite (WAL). Per-second aggregates and events 24 h, sessions 30 d. */
export class TelemetryStore {
  private db: Database;
  private queue: SecondRow[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(path: string, opts: { autoFlushMs?: number } = {}) {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS seconds (ts INTEGER, target TEXT, count INTEGER, sum REAL, min REAL, max REAL, lost INTEGER, late INTEGER);
      CREATE INDEX IF NOT EXISTS seconds_ts ON seconds(target, ts);
      CREATE TABLE IF NOT EXISTS events (ts INTEGER, kind TEXT, data TEXT);
      CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, start INTEGER, end INTEGER, summary TEXT, hist TEXT);`);
    if (opts.autoFlushMs) this.timer = setInterval(() => this.flush(), opts.autoFlushMs);
  }

  addSecond(row: SecondRow) {
    this.queue.push(row);
  }

  flush() {
    if (!this.queue.length) return;
    const ins = this.db.prepare("INSERT INTO seconds VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const rows = this.queue;
    this.queue = [];
    this.db.transaction(() => {
      for (const r of rows) ins.run(r.ts, r.target, r.count, r.sum, r.min, r.max, r.lost, r.late);
    })();
  }

  addEvent(e: EventRow) {
    this.db.prepare("INSERT INTO events VALUES (?, ?, ?)").run(e.ts, e.kind, JSON.stringify(e.data ?? {}));
  }

  addSession(s: SessionSummary, hist: number[]) {
    this.db.prepare("INSERT OR REPLACE INTO sessions VALUES (?, ?, ?, ?, ?)").run(s.id, s.start, s.end, JSON.stringify(s), JSON.stringify(hist));
  }

  seconds(target: string, since: number): SecondRow[] {
    return this.db.prepare("SELECT * FROM seconds WHERE target = ? AND ts >= ? ORDER BY ts").all(target, since) as SecondRow[];
  }

  events(since: number): EventRow[] {
    return (this.db.prepare("SELECT * FROM events WHERE ts >= ? ORDER BY ts").all(since) as { ts: number; kind: string; data: string }[]).map((r) => ({ ...r, data: JSON.parse(r.data) }));
  }

  sessions(limit: number): SessionSummary[] {
    return (this.db.prepare("SELECT summary FROM sessions ORDER BY end DESC LIMIT ?").all(limit) as { summary: string }[]).map((r) => JSON.parse(r.summary));
  }

  prune(now: number) {
    this.db.prepare("DELETE FROM seconds WHERE ts < ?").run(now - 24 * HOUR);
    this.db.prepare("DELETE FROM events WHERE ts < ?").run(now - 24 * HOUR);
    this.db.prepare("DELETE FROM sessions WHERE end < ?").run(now - 30 * 24 * HOUR);
  }

  clearAll() {
    this.queue = [];
    this.db.exec("DELETE FROM seconds; DELETE FROM events; DELETE FROM sessions;");
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.flush();
    this.db.close();
  }
}
