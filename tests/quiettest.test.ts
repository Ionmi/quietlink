import { expect, test } from "bun:test";
import { qtReduce, initialQT, verdict, type QTState, type QTInput, type QTEffect } from "../src/domain/quiettest";

const W = { band: "6", channel: 5, router: "r" };
const step = (s: QTState, ...ins: QTInput[]) =>
  ins.reduce(
    (a, i) => {
      const r = qtReduce(a.s, i, 1000);
      return { s: r.state, e: [...a.e, ...r.effects] };
    },
    { s, e: [] as QTEffect[] },
  );
const start: QTInput = { kind: "start", now: 0, activeLeases: 0, inGrace: false, wifi: W };
const stats = (cond: "A" | "B", spikes: number, block: number, run = 1): QTInput => ({ kind: "block-stats", run, block, stats: { cond, sent: 5, lost: 0, spikes, p95: 4, max: 9 } });

test("refuses when leases active or in grace", () => {
  expect(step(initialQT, { ...start, activeLeases: 1 } as QTInput).s).toMatchObject({ phase: "invalid", reason: "busy" });
  expect(step(initialQT, { ...start, inGrace: true } as QTInput).s.phase).toBe("invalid");
});

test("start sets fast probing and waits for awdl up", () => {
  const r = step(initialQT, start, { kind: "tick", now: 500, wifi: W });
  expect(r.s.phase).toBe("arming-A");
  expect(r.e).toContainEqual({ kind: "set-probe-interval", ms: 200 });
  expect(r.e.some((e) => e.kind === "collect-block")).toBe(false);
});

test("A timing starts only after awdl observed up; B after hold ack and down", () => {
  const r = step(initialQT, start, { kind: "tick", now: 500, wifi: W });
  const r2 = step(r.s, { kind: "awdl-observed", up: true, now: 600 }, { kind: "tick", now: 1600, wifi: W });
  expect(r2.e).toContainEqual({ kind: "collect-block", run: 1, block: 0, cond: "A", from: 600, to: 1600 });
  expect(r2.e).toContainEqual({ kind: "test-hold" });
  expect(r2.s.phase).toBe("arming-B");
  const r3 = step(r2.s, { kind: "awdl-observed", up: false, now: 1650 });
  expect(r3.s.phase).toBe("arming-B"); // down without hold-ack does not start B
  const r4 = step(r3.s, { kind: "hold-ack", run: 1, now: 1700 }, { kind: "tick", now: 2700, wifi: W });
  expect(r4.e).toContainEqual({ kind: "collect-block", run: 1, block: 1, cond: "B", from: 1700, to: 2700 });
  expect(r4.e).toContainEqual({ kind: "test-release" });
  expect(r4.s.phase).toBe("arming-A");
});

test("full A-B-A-B run ends done with results and normal probing", () => {
  let s = step(initialQT, start).s;
  for (let block = 0; block < 4; block++) {
    const cond = block % 2 === 0 ? "A" : "B";
    const t0 = 10_000 * (block + 1);
    s = cond === "A"
      ? step(s, { kind: "awdl-observed", up: true, now: t0 }).s
      : step(s, { kind: "hold-ack", run: 1, now: t0 }, { kind: "awdl-observed", up: false, now: t0 }).s;
    const r = step(s, { kind: "tick", now: t0 + 1000, wifi: W }, stats(cond, cond === "A" ? 7 : 0, block));
    s = r.s;
    if (block === 3) expect(r.e).toContainEqual({ kind: "set-probe-interval", ms: null });
  }
  expect(s.phase).toBe("done");
  expect(verdict(s)).toEqual({ a: { sent: 10, lost: 0, spikes: 14 }, b: { sent: 10, lost: 0, spikes: 0 } });
});

test("wifi change invalidates and releases", () => {
  const r = step(initialQT, start, { kind: "awdl-observed", up: true, now: 1 }, { kind: "tick", now: 2, wifi: { ...W, band: "5" } });
  expect(r.s).toMatchObject({ phase: "invalid", reason: "network-changed" });
  expect(r.e).toContainEqual({ kind: "test-release" });
  expect(r.e).toContainEqual({ kind: "set-probe-interval", ms: null });
});

test("trigger hands over without restore", () => {
  const r = step(initialQT, start, { kind: "trigger-started" });
  expect(r.s.phase).toBe("cancelled");
  expect(r.e).toContainEqual({ kind: "hand-over-release" });
  expect(r.e).not.toContainEqual({ kind: "test-release" });
});

test("transition failure invalidates", () => {
  const r = step(initialQT, start, { kind: "transition-failed", reason: "no-privilege" });
  expect(r.s).toMatchObject({ phase: "invalid", reason: "no-privilege" });
  expect(r.e).toContainEqual({ kind: "test-release" });
});

test("user cancel releases", () => {
  const r = step(initialQT, start, { kind: "cancel" });
  expect(r.s.phase).toBe("cancelled");
  expect(r.e).toContainEqual({ kind: "test-release" });
});

test("down observed before hold-ack still starts B on ack", () => {
  const a = step(initialQT, start, { kind: "awdl-observed", up: true, now: 0 }, { kind: "tick", now: 1000, wifi: W });
  const r = step(a.s, { kind: "awdl-observed", up: false, now: 1100 }, { kind: "hold-ack", run: 1, now: 1200 });
  expect(r.s.phase).toBe("B");
  expect(r.s.blockStart).toBe(1200);
});

test("hold-ack from an old run is ignored", () => {
  const a = step(initialQT, start, { kind: "awdl-observed", up: true, now: 0 }, { kind: "tick", now: 1000, wifi: W });
  const r = step(a.s, { kind: "hold-ack", run: 0, now: 1100 }, { kind: "awdl-observed", up: false, now: 1200 });
  expect(r.s.phase).toBe("arming-B");
});

test("AWDL going down during A invalidates the block", () => {
  const r = step(initialQT, start, { kind: "awdl-observed", up: true, now: 0 }, { kind: "awdl-observed", up: false, now: 10 });
  expect(r.s).toMatchObject({ phase: "invalid", reason: "condition-changed" });
});

test("transient AWDL re-enable during B is part of quiet mode and does not invalidate", () => {
  const a = step(initialQT, start, { kind: "awdl-observed", up: true, now: 0 }, { kind: "tick", now: 1000, wifi: W }, { kind: "hold-ack", run: 1, now: 1100 }, { kind: "awdl-observed", up: false, now: 1100 });
  const r = step(a.s, { kind: "awdl-observed", up: true, now: 1300 });
  expect(r.s.phase).toBe("B");
});

test("stats are accepted once per block and only for the current run", () => {
  let s = step(initialQT, start).s;
  s = step(s, stats("A", 3, 0), stats("A", 3, 0), stats("A", 9, 0, 0)).s;
  expect(s.results).toHaveLength(1);
});

test("no verdict after cancellation even with A and B results", () => {
  const r = step(initialQT, start, stats("A", 3, 0), stats("B", 0, 1), { kind: "cancel" });
  expect(verdict(r.s)).toBeNull();
});

test("inputs after finishing are ignored and verdict needs both conditions", () => {
  const r = step(initialQT, start, { kind: "cancel" }, { kind: "awdl-observed", up: true, now: 5 });
  expect(r.s.phase).toBe("cancelled");
  expect(verdict(r.s)).toBeNull();
});

test("[final] arming times out", () => {
  const r = step(initialQT, start, { kind: "tick", now: 16_000, wifi: W });
  expect(r.s).toMatchObject({ phase: "invalid", reason: "timeout" });
  expect(r.e).toContainEqual({ kind: "test-release" });
});
