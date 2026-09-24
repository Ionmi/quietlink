import { expect, test } from "bun:test";
import { reduce, initialMode, type ModeState, type ModeInput, type Effect } from "../src/domain/mode";
import { LeaseSet } from "../src/domain/leases";

const cfg = { graceMs: 10_000 };
const run = (s: ModeState, ...inputs: ModeInput[]) =>
  inputs.reduce(
    (acc, i) => {
      const r = reduce(acc.state, i, cfg);
      return { state: r.state, effects: [...acc.effects, ...r.effects] };
    },
    { state: s, effects: [] as Effect[] },
  );
const on = (now = 0): ModeInput => ({ kind: "leases-changed", activeCount: 1, now });
const off = (now: number): ModeInput => ({ kind: "leases-changed", activeCount: 0, now });
const ok = (generation = 1, token = 7): ModeInput => ({ kind: "hold-ok", generation, token });

test("first lease activates and holds with new generation", () => {
  const r = reduce(initialMode, on(), cfg);
  expect(r.state.phase).toBe("activating");
  expect(r.effects).toEqual([{ kind: "hold", generation: 1 }]);
});

test("stale hold-ok is ignored", () => {
  expect(run(initialMode, on(), ok(0, 9)).state.phase).toBe("activating");
});

test("renews every tick while active", () => {
  const r = run(initialMode, on(), ok(), { kind: "tick", now: 1000 });
  expect(r.state.phase).toBe("active");
  expect(r.effects.at(-1)).toEqual({ kind: "renew", token: 7 });
});

test("grace keeps quiet and a new lease cancels it without release", () => {
  const r = run(initialMode, on(), ok(), off(5000), on(8000));
  expect(r.state.phase).toBe("active");
  expect(r.effects.some((e) => e.kind === "release")).toBe(false);
});

test("grace still renews the lease", () => {
  const r = run(initialMode, on(), ok(), off(5000), { kind: "tick", now: 6000 });
  expect(r.state.phase).toBe("grace");
  expect(r.effects.at(-1)).toEqual({ kind: "renew", token: 7 });
});

test("grace expiry releases", () => {
  const r = run(initialMode, on(), ok(), off(5000), { kind: "tick", now: 15_001 });
  expect(r.state.phase).toBe("restoring");
  expect(r.effects.at(-1)).toEqual({ kind: "release", token: 7, generation: 1 });
});

test("released returns to inactive", () => {
  const r = run(initialMode, on(), ok(), off(5000), { kind: "tick", now: 15_001 }, { kind: "released", generation: 1 });
  expect(r.state.phase).toBe("inactive");
  expect(r.state.token).toBeNull();
});

test("lease-expired drops to inactive and rebuilds", () => {
  const r = run(initialMode, on(), ok(), { kind: "lease-expired", generation: 1 });
  expect(r.state.phase).toBe("inactive");
  expect(r.effects.at(-1)).toEqual({ kind: "rebuild-leases" });
});

test("emergency suppresses manual leases, grace and retries until reenable", () => {
  let r = run(initialMode, on(), { kind: "emergency" }, { kind: "leases-changed", activeCount: 2, now: 1 }, { kind: "hold-failed", generation: 1, error: "x", now: 2 }, { kind: "tick", now: 60_000 });
  expect(r.state.phase).toBe("suppressed");
  expect(r.effects.filter((e) => e.kind === "hold")).toHaveLength(1);
  expect(r.effects).toContainEqual({ kind: "restore-now" });
  r = run(r.state, { kind: "reenable" });
  expect(r.state.phase).toBe("inactive");
  expect(r.effects).toEqual([{ kind: "rebuild-leases" }]);
});

test("fault backs off 1,2,5,10 s", () => {
  let s = run(initialMode, on(), { kind: "hold-failed", generation: 1, error: "no-privilege", now: 0 }).state;
  expect(s.phase).toBe("fault");
  expect(s.faultRetryAt).toBe(1000);
  let r = run(s, { kind: "tick", now: 999 });
  expect(r.effects).toEqual([]);
  r = run(s, { kind: "tick", now: 1000 });
  expect(r.effects).toEqual([{ kind: "hold", generation: 2 }]);
  s = run(r.state, { kind: "hold-failed", generation: 2, error: "x", now: 1000 }).state;
  expect(s.faultRetryAt).toBe(3000);
  s = run(s, { kind: "tick", now: 3000 }, { kind: "hold-failed", generation: 3, error: "x", now: 3000 }).state;
  expect(s.faultRetryAt).toBe(8000);
  s = run(s, { kind: "tick", now: 8000 }, { kind: "hold-failed", generation: 4, error: "x", now: 8000 }).state;
  expect(s.faultRetryAt).toBe(18_000);
  s = run(s, { kind: "tick", now: 18_000 }, { kind: "hold-failed", generation: 5, error: "x", now: 18_000 }).state;
  expect(s.faultRetryAt).toBe(28_000);
});

test("fault with no leases left goes inactive", () => {
  const s = run(initialMode, on(), { kind: "hold-failed", generation: 1, error: "x", now: 0 }, off(10)).state;
  expect(s.phase).toBe("inactive");
});

test("airdrop break releases then re-holds", () => {
  const r = run(initialMode, on(), ok(), { kind: "airdrop-break", now: 10, ms: 120_000 }, { kind: "released", generation: 1 }, { kind: "tick", now: 120_011 });
  expect(r.effects.map((e) => e.kind)).toEqual(["hold", "release", "hold"]);
  expect(r.state.phase).toBe("activating");
});

test("airdrop break with no leases left ends inactive", () => {
  const r = run(initialMode, on(), ok(), { kind: "airdrop-break", now: 10, ms: 1000 }, off(20), { kind: "tick", now: 2000 });
  expect(r.state.phase).toBe("inactive");
});

test("sleep releases and wake rebuilds", () => {
  const r = run(initialMode, on(), ok(), { kind: "sleep" }, { kind: "wake", now: 99 });
  expect(r.effects.map((e) => e.kind)).toEqual(["hold", "release", "rebuild-leases"]);
  expect(r.state.phase).toBe("inactive");
});

test("unknown sensor state expires sensor-bound leases only", () => {
  const set = new LeaseSet();
  set.add({ id: "game:1", source: "game", label: "LoL", since: 0, sensorBound: true });
  set.add({ id: "manual", source: "manual", label: "Manual", since: 0, sensorBound: false });
  expect(set.expireUnknown(31_000, 0, 30_000)).toEqual(["game:1"]);
  expect(set.active(31_000).map((l) => l.id)).toEqual(["manual"]);
});

test("timed leases expire", () => {
  const set = new LeaseSet();
  set.add({ id: "timed", source: "timed", label: "1 h", since: 0, expiresAt: 3_600_000, sensorBound: false });
  expect(set.active(3_599_999)).toHaveLength(1);
  expect(set.active(3_600_000)).toHaveLength(0);
});

test("lease arriving while release is pending re-activates after confirmation", () => {
  const r = run(initialMode, on(), ok(), off(5000), { kind: "tick", now: 15_001 }, on(15_100), { kind: "released", generation: 1 });
  expect(r.state.phase).toBe("activating");
  expect(r.effects.at(-1)).toEqual({ kind: "hold", generation: 2 });
});

test("cancelling before hold-ok releases the token that arrives later", () => {
  const r = run(initialMode, on(), off(10), ok(1, 42));
  expect(r.effects).toContainEqual({ kind: "release", token: 42, generation: 1 });
  expect(r.state.phase).toBe("restoring");
});

test("sleep before hold-ok releases the late token", () => {
  const r = run(initialMode, on(), { kind: "sleep" }, ok(1, 43));
  expect(r.effects).toContainEqual({ kind: "release", token: 43, generation: 1 });
});
