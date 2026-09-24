import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsStore } from "../src/adapters/settings-store";
import { TelemetryStore } from "../src/adapters/telemetry-store";
import { acquireInstanceLock } from "../src/adapters/instance-lock";

const tmp = () => mkdtempSync(join(tmpdir(), "qls-"));
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

test("settings: defaults, merge, atomic rewrite, presets merged by id keeping user toggles", () => {
  const p = join(tmp(), "settings.json");
  const s = new SettingsStore(p);
  expect(s.get()).toMatchObject({ lang: "en", graceMs: 10_000, externalTarget: "1.1.1.1", inputTrigger: false, explainCuts: false });
  expect(s.get().rules.find((r) => r.id === "lol")).toBeTruthy();
  s.update({ lang: "es", rules: s.get().rules.map((r) => (r.id === "discord" ? { ...r, enabled: true } : r)) });
  const again = new SettingsStore(p);
  expect(again.get().lang).toBe("es");
  expect(again.get().rules.find((r) => r.id === "discord")!.enabled).toBe(true);
  expect(existsSync(p + ".tmp")).toBe(false);
  expect(statSync(p).mode & 0o777).toBe(0o600);
});

test("settings: corrupt file falls back to defaults", async () => {
  const p = join(tmp(), "settings.json");
  await Bun.write(p, "{nope");
  expect(new SettingsStore(p).get().lang).toBe("en");
});

test("settings: custom rules survive and unknown keys are dropped", async () => {
  const p = join(tmp(), "settings.json");
  await Bun.write(p, JSON.stringify({ evil: 1, rules: [{ id: "custom:x", label: "X", kind: "game", match: { bundlePrefix: "/Applications/X.app" }, enabled: true, verified: true }] }));
  const s = new SettingsStore(p).get();
  expect((s as any).evil).toBeUndefined();
  expect(s.rules.some((r) => r.id === "custom:x")).toBe(true);
  expect(s.rules.some((r) => r.id === "lol")).toBe(true);
});

test("telemetry: prune keeps 24 h of seconds/events and 30 d of sessions", () => {
  const t = new TelemetryStore(join(tmp(), "t.sqlite"));
  const now = 100 * DAY;
  t.addSecond({ ts: now - 25 * HOUR, target: "gw", count: 1, sum: 3, min: 3, max: 3, lost: 0, late: 0 });
  t.addSecond({ ts: now - 1 * HOUR, target: "gw", count: 2, sum: 6, min: 3, max: 3, lost: 0, late: 0 });
  t.addEvent({ ts: now - 25 * HOUR, kind: "interruption", data: {} });
  t.addEvent({ ts: now - HOUR, kind: "interruption", data: { lostCount: 2 } });
  const s = (id: string, end: number) => ({ id, start: end - 1000, end, triggers: [], p50: 3, p95: 4, max: 9, spikes: 0, interruptions: 0, lossPct: 0, awdlReenables: 0, notes: [] });
  t.addSession(s("old", now - 31 * DAY), []);
  t.addSession(s("new", now - 29 * DAY), []);
  t.flush();
  t.prune(now);
  expect(t.seconds("gw", 0)).toHaveLength(1);
  expect(t.events(0)).toHaveLength(1);
  expect(t.events(0)[0].data).toEqual({ lostCount: 2 });
  expect(t.sessions(10).map((x) => x.id)).toEqual(["new"]);
  t.close();
});

test("telemetry: clearAll empties tables and truncates the WAL", () => {
  const dir = tmp();
  const t = new TelemetryStore(join(dir, "t.sqlite"));
  for (let i = 0; i < 100; i++) t.addSecond({ ts: i, target: "gw", count: 1, sum: 1, min: 1, max: 1, lost: 0, late: 0 });
  t.flush();
  t.clearAll();
  expect(t.seconds("gw", 0)).toHaveLength(0);
  const wal = join(dir, "t.sqlite-wal");
  expect(!existsSync(wal) || statSync(wal).size === 0).toBe(true);
  t.close();
});

test("telemetry: batched inserts are visible after flush", () => {
  const t = new TelemetryStore(join(tmp(), "t.sqlite"));
  t.addSecond({ ts: 1, target: "gw", count: 1, sum: 1, min: 1, max: 1, lost: 0, late: 0 });
  expect(t.seconds("gw", 0)).toHaveLength(0);
  t.flush();
  expect(t.seconds("gw", 0)).toHaveLength(1);
  t.close();
});

test("instance lock is exclusive and releasable", () => {
  const p = join(tmp(), "instance.lock");
  const a = acquireInstanceLock(p);
  expect(a).not.toBeNull();
  expect(acquireInstanceLock(p)).toBeNull();
  a!.release();
  const b = acquireInstanceLock(p);
  expect(b).not.toBeNull();
  b!.release();
});
