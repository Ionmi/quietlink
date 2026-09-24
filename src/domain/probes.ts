import type { HelperEvent } from "../shared/protocol";

export type ProbeRecord = {
  target: string;
  id: number;
  seq: number;
  sentAt: number;
  outcome: "pending" | "reply" | "lost" | "error" | "unknown";
  resultAt?: number;
  rttMs?: number;
  late?: number;
};

export type Interruption = { start: number; end: number | null; lostCount: number; resolutionMs: number };

/**
 * Per-probe accounting from helper events. A probe is lost only when the helper
 * reports its deadline expired; late replies are observations, never un-losses.
 */
export class ProbeLedger {
  private byTarget = new Map<string, Map<string, ProbeRecord>>();
  private pauses: [number, number][] = [];

  constructor(private opts: { deadlineMs: number; windowMs: number }) {}

  private records(target: string) {
    let m = this.byTarget.get(target);
    if (!m) this.byTarget.set(target, (m = new Map()));
    return m;
  }

  onEvent(e: HelperEvent) {
    if (e.type === "probe-sent") {
      this.records(e.target).set(`${e.id}:${e.seq}`, { target: e.target, id: e.id, seq: e.seq, sentAt: e.ts, outcome: "pending" });
      this.prune(e.target, e.ts);
    } else if (e.type === "probe-result") {
      const r = this.records(e.target).get(`${e.id}:${e.seq}`);
      if (!r || r.outcome !== "pending") return;
      r.outcome = e.outcome;
      r.resultAt = e.ts;
      if (e.outcome === "reply") r.rttMs = e.rttMs;
    } else if (e.type === "probe-late") {
      const r = this.records(e.target).get(`${e.id}:${e.seq}`);
      if (r && r.outcome === "lost") r.late = e.rttMs;
    }
  }

  onHelperRestart(_now: number) {
    for (const m of this.byTarget.values()) for (const r of m.values()) if (r.outcome === "pending") r.outcome = "unknown";
  }

  onPause(from: number, to: number) {
    this.pauses.push([from, to]);
  }

  private paused(ts: number) {
    return this.pauses.some(([a, b]) => ts >= a && ts <= b);
  }

  private prune(target: string, now: number) {
    const m = this.records(target);
    for (const [k, r] of m) if (r.sentAt < now - this.opts.windowMs) m.delete(k);
    this.pauses = this.pauses.filter(([, b]) => b >= now - this.opts.windowMs);
  }

  private inWindow(target: string, now: number): ProbeRecord[] {
    return [...this.records(target).values()]
      .filter((r) => r.sentAt >= now - this.opts.windowMs && r.outcome !== "unknown" && !this.paused(r.sentAt))
      .sort((a, b) => a.sentAt - b.sentAt);
  }

  private latest(target: string) {
    let t = 0;
    for (const r of this.records(target).values()) t = Math.max(t, r.sentAt);
    return t;
  }

  window(target: string, now: number) {
    const rs = this.inWindow(target, now);
    const done = rs.filter((r) => r.outcome !== "pending");
    return {
      sent: done.length,
      lost: done.filter((r) => r.outcome === "lost").length,
      errors: done.filter((r) => r.outcome === "error").length,
      late: done.filter((r) => r.late !== undefined).length,
      replies: done.filter((r) => r.outcome === "reply").map((r) => r.rttMs ?? 0),
      provisional: rs.some((r) => r.outcome === "pending"),
    };
  }

  /** Settled probes sent within [from, to]; used for Quiet test blocks. */
  range(target: string, from: number, to: number) {
    const rs = [...this.records(target).values()].filter((r) => r.sentAt >= from && r.sentAt <= to && (r.outcome === "reply" || r.outcome === "lost"));
    return {
      sent: rs.length,
      lost: rs.filter((r) => r.outcome === "lost").length,
      replies: rs.filter((r) => r.outcome === "reply").sort((a, b) => a.sentAt - b.sentAt).map((r) => r.rttMs ?? 0),
    };
  }

  /**
   * Runs of >= 2 consecutive deadline losses. Anything that is not a deadline loss
   * (error, unknown, paused, gap across a pause) breaks the run, so losses are
   * never joined across unobserved intervals.
   */
  interruptions(target: string): Interruption[] {
    const all = [...this.records(target).values()].sort((a, b) => a.sentAt - b.sentAt);
    const observed = all.filter((r) => r.outcome === "reply" || r.outcome === "lost");
    const deltas = observed.slice(1).map((r, i) => r.sentAt - observed[i].sentAt).sort((a, b) => a - b);
    const resolutionMs = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 0;
    const out: Interruption[] = [];
    let lastReply: number | null = null;
    let run: ProbeRecord[] = [];
    const pauseBetween = (a: ProbeRecord, b: ProbeRecord) => this.pauses.some(([x, y]) => x <= b.sentAt && y >= a.sentAt);
    for (const r of all) {
      if (r.outcome === "pending") continue;
      const broken = r.outcome === "error" || r.outcome === "unknown" || this.paused(r.sentAt) || (run.length > 0 && pauseBetween(run[run.length - 1], r));
      if (broken) {
        run = [];
        lastReply = null;
        continue;
      }
      if (r.outcome === "reply") {
        if (run.length >= 2) out.push({ start: lastReply ?? run[0].sentAt, end: r.resultAt ?? r.sentAt, lostCount: run.length, resolutionMs });
        run = [];
        lastReply = r.resultAt ?? r.sentAt;
      } else run.push(r);
    }
    if (run.length >= 2) out.push({ start: lastReply ?? run[0].sentAt, end: null, lostCount: run.length, resolutionMs });
    return out;
  }
}
