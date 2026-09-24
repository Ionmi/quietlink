// Quiet test: alternating A (baseline) / B (quiet mode) blocks of router probes.
// Pure state machine; the controller executes effects and feeds observations back.
export type QTPhase = "idle" | "arming-A" | "A" | "arming-B" | "B" | "done" | "invalid" | "cancelled";
export type WifiFingerprint = { band: string | null; channel: number | null; router: string | null };
export type BlockStats = { cond: "A" | "B"; sent: number; lost: number; spikes: number; p95: number | null; max: number | null };

export type QTState = {
  phase: QTPhase;
  block: number;
  blockStart: number | null;
  holdAcked: boolean;
  results: BlockStats[];
  reason?: string;
  baseline: WifiFingerprint | null;
};

export type QTInput =
  | { kind: "start"; now: number; activeLeases: number; inGrace: boolean; wifi: WifiFingerprint }
  | { kind: "awdl-observed"; up: boolean; now: number }
  | { kind: "hold-ack"; now: number }
  | { kind: "transition-failed"; reason: string }
  | { kind: "tick"; now: number; wifi: WifiFingerprint }
  | { kind: "block-stats"; stats: BlockStats }
  | { kind: "trigger-started" }
  | { kind: "cancel" };

export type QTEffect =
  | { kind: "test-hold" }
  | { kind: "test-release" }
  | { kind: "hand-over-release" }
  | { kind: "collect-block"; cond: "A" | "B"; from: number; to: number }
  | { kind: "set-probe-interval"; ms: number | null };

export const TEST_PROBE_MS = 200;
export const BLOCKS = 4;
export const initialQT: QTState = { phase: "idle", block: 0, blockStart: null, holdAcked: false, results: [] };

type Out = { state: QTState; effects: QTEffect[] };
const RUNNING: QTPhase[] = ["arming-A", "A", "arming-B", "B"];
const condOf = (block: number): "A" | "B" => (block % 2 === 0 ? "A" : "B");
const sameWifi = (a: WifiFingerprint, b: WifiFingerprint) => a.band === b.band && a.channel === b.channel && a.router === b.router;

function stop(s: QTState, phase: "invalid" | "cancelled", release: QTEffect["kind"], reason?: string): Out {
  return {
    state: { ...s, phase, reason, blockStart: null },
    effects: [{ kind: release } as QTEffect, { kind: "set-probe-interval", ms: null }],
  };
}

export function qtReduce(s: QTState, i: QTInput, blockMs = 60_000): Out {
  const running = RUNNING.includes(s.phase);
  const none: Out = { state: s, effects: [] };

  if (i.kind === "start") {
    if (running) return none;
    if (i.activeLeases > 0 || i.inGrace) return { state: { ...initialQT, phase: "invalid", reason: "busy" }, effects: [] };
    return { state: { ...initialQT, phase: "arming-A", baseline: i.wifi }, effects: [{ kind: "set-probe-interval", ms: TEST_PROBE_MS }] };
  }
  if (i.kind === "block-stats") return s.phase === "idle" ? none : { state: { ...s, results: [...s.results, i.stats] }, effects: [] };
  if (!running) return none;

  switch (i.kind) {
    case "cancel":
      return stop(s, "cancelled", "test-release");
    case "trigger-started":
      return stop(s, "cancelled", "hand-over-release");
    case "transition-failed":
      return stop(s, "invalid", "test-release", i.reason);
    case "hold-ack":
      return s.phase === "arming-B" ? { state: { ...s, holdAcked: true }, effects: [] } : none;
    case "awdl-observed":
      if (s.phase === "arming-A" && i.up) return { state: { ...s, phase: "A", blockStart: i.now }, effects: [] };
      if (s.phase === "arming-B" && !i.up && s.holdAcked) return { state: { ...s, phase: "B", blockStart: i.now }, effects: [] };
      return none;
    case "tick": {
      if (s.baseline && !sameWifi(s.baseline, i.wifi)) return stop(s, "invalid", "test-release", "network-changed");
      if ((s.phase !== "A" && s.phase !== "B") || s.blockStart === null || i.now - s.blockStart < blockMs) return none;
      const collect: QTEffect = { kind: "collect-block", cond: condOf(s.block), from: s.blockStart, to: i.now };
      const next = s.block + 1;
      if (next >= BLOCKS) {
        return {
          state: { ...s, phase: "done", block: next, blockStart: null },
          effects: [collect, ...(s.phase === "B" ? [{ kind: "test-release" } as QTEffect] : []), { kind: "set-probe-interval", ms: null }],
        };
      }
      if (condOf(next) === "B") return { state: { ...s, phase: "arming-B", block: next, blockStart: null, holdAcked: false }, effects: [collect, { kind: "test-hold" }] };
      return { state: { ...s, phase: "arming-A", block: next, blockStart: null }, effects: [collect, { kind: "test-release" }] };
    }
  }
}

export function verdict(s: QTState) {
  const sum = (cond: "A" | "B") => {
    const rs = s.results.filter((r) => r.cond === cond);
    return rs.length ? { sent: rs.reduce((a, r) => a + r.sent, 0), lost: rs.reduce((a, r) => a + r.lost, 0), spikes: rs.reduce((a, r) => a + r.spikes, 0) } : null;
  };
  const a = sum("A");
  const b = sum("B");
  return a && b ? { a, b } : null;
}
