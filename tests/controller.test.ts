import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Controller, type HelperLike, type WardenLike } from "../src/app/controller";
import { SettingsStore } from "../src/adapters/settings-store";
import { TelemetryStore } from "../src/adapters/telemetry-store";
import type { HelperCommand, HelperEvent, WardenResponse, WardenStatus } from "../src/shared/protocol";

const LOL = "/Applications/League of Legends.app/Contents/LoL/Game/LeagueofLegends.app/Contents/MacOS/LeagueofLegends";

class FakeHelper implements HelperLike {
  sent: HelperCommand[] = [];
  private fns: ((e: HelperEvent) => void)[] = [];
  private restartFns: (() => void)[] = [];
  on(fn: (e: HelperEvent) => void) { this.fns.push(fn); return () => {}; }
  onRestart(fn: () => void) { this.restartFns.push(fn); return () => {}; }
  send(c: HelperCommand) { this.sent.push(c); }
  start() {}
  stop() {}
  checkHealth() {}
  emit(e: any) { for (const f of this.fns) f({ v: 1, ts: 0, ...e }); }
  restart() { for (const f of this.restartFns) f(); }
}

class FakeWarden implements WardenLike {
  log: any[] = [];
  token = 100;
  renewError: string | null = null;
  holdError: string | null = null;
  status: WardenStatus = { awdlUp: true, holding: false, tookDown: false, recovering: false, privilege: true, lastError: null, wifiPending: false, restoredByWarden: 0 };
  lastStatus: WardenStatus | null = this.status;
  async request(req: any): Promise<WardenResponse> {
    this.log.push(req);
    if (req.op === "hold") {
      if (this.holdError) return { v: 1, id: 0, ok: false, error: this.holdError as any };
      this.status = { ...this.status, holding: true, awdlUp: false };
      return { v: 1, id: 0, ok: true, token: ++this.token, status: this.status };
    }
    if (req.op === "renew" && this.renewError) return { v: 1, id: 0, ok: false, error: this.renewError as any };
    if (req.op === "release" || req.op === "restore-now") this.status = { ...this.status, holding: false, awdlUp: true };
    return { v: 1, id: 0, ok: true, status: this.status };
  }
  async superviseTick() { this.lastStatus = this.status; return "ok" as const; }
  close() {}
  ops() { return this.log.map((r) => r.op); }
}

function setup(opts: { settings?: object } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ctl-"));
  const helper = new FakeHelper();
  const warden = new FakeWarden();
  const settings = new SettingsStore(join(dir, "s.json"));
  settings.update({ rules: settings.get().rules.map((r) => (r.id === "lol" ? { ...r, enabled: true } : r)), ...opts.settings });
  const telemetry = new TelemetryStore(join(dir, "t.sqlite"));
  const notes: string[] = [];
  let now = 1_000_000;
  const agents: string[] = [];
  const ctl = new Controller({
    helper, warden, settings, telemetry, now: () => now, mono: () => now, notify: (t, b) => notes.push(`${t}: ${b}`),
    gatewayKey: new Uint8Array(32), wardenPid: async () => 1, macosMajor: 27,
    installLoginAgent: async (on) => { agents.push(on ? "install" : "remove"); },
  });
  const advance = async (ms: number) => { now += ms; await ctl.tick(); await ctl.idle(); };
  helper.emit({ type: "wifi", iface: "en0", band: "6", channel: 5, widthMHz: 160, rssi: -40, noise: -92, phyRateMbps: 2401, powerOn: true });
  helper.emit({ type: "router", iface: "en0", ipv4: "192.168.1.1", mac: "0a:1b:2c:3d:4e:5f" });
  return { ctl, helper, warden, notes, advance, agents, now: () => now, settings };
}
const lolProc = (pid = 10) => ({ type: "procs", procs: [{ pid, start: 5, path: LOL, bundleId: null }] });

test("game process appears → hold; token renewed every tick", async () => {
  const { ctl, helper, warden, advance } = setup();
  helper.emit(lolProc());
  await ctl.idle();
  expect(warden.ops()).toContain("hold");
  await advance(1000);
  expect(warden.log.at(-1)).toEqual({ op: "renew", token: 101 });
  expect(ctl.view().phase).toBe("active");
  expect(ctl.view().because).toEqual(["League of Legends (match)"]);
});

test("lease-expired rebuilds and re-holds only if the game is still running", async () => {
  const { ctl, helper, warden, advance } = setup();
  helper.emit(lolProc());
  await ctl.idle();
  warden.renewError = "lease-expired";
  await advance(1000);
  expect(warden.ops().filter((o) => o === "hold")).toHaveLength(2);
  warden.renewError = null;
  await advance(1000);
  expect(warden.ops().filter((o) => o === "hold")).toHaveLength(2);
  const w2 = setup();
  w2.helper.emit(lolProc());
  await w2.ctl.idle();
  w2.helper.emit({ type: "procs", procs: [] });
  w2.warden.renewError = "lease-expired";
  await w2.advance(1000);
  await w2.advance(1000);
  expect(w2.warden.ops().filter((o) => o === "hold")).toHaveLength(1);
});

test("helper silent for 31 s → game lease expires → release after grace", async () => {
  const { ctl, helper, warden, advance } = setup();
  helper.emit(lolProc());
  await ctl.idle();
  await advance(31_000);
  expect(ctl.view().phase).toBe("grace");
  await advance(11_000);
  expect(warden.ops()).toContain("release");
});

test("emergency with a manual lease → restore-now, no hold until reenable", async () => {
  const { ctl, warden, advance } = setup();
  ctl.manual(true);
  await ctl.idle();
  ctl.emergency();
  await ctl.idle();
  expect(warden.ops()).toContain("restore-now");
  const holds = warden.ops().filter((o) => o === "hold").length;
  await advance(5000);
  expect(warden.ops().filter((o) => o === "hold").length).toBe(holds);
  ctl.reenable();
  await ctl.idle();
  // Restoring AirDrop cancelled the manual lease, so re-enabling does not hold again.
  expect(warden.ops().filter((o) => o === "hold").length).toBe(holds);
});

test("sleep releases; wake rebuilds from the next snapshot", async () => {
  const { ctl, helper, warden } = setup();
  helper.emit(lolProc());
  await ctl.idle();
  helper.emit({ type: "power", state: "will-sleep" });
  await ctl.idle();
  expect(warden.ops()).toContain("release");
  helper.emit({ type: "power", state: "did-wake" });
  helper.emit(lolProc());
  await ctl.idle();
  expect(warden.ops().filter((o) => o === "hold")).toHaveLength(2);
});

test("quiet test refused while a game is running", async () => {
  const { ctl, helper } = setup();
  helper.emit(lolProc());
  await ctl.idle();
  ctl.startQuietTest();
  expect(ctl.view().test).toMatchObject({ phase: "invalid", reason: "busy" });
});

test("reconnect is refused during quiet mode", async () => {
  const { ctl, warden } = setup();
  ctl.manual(true);
  await ctl.idle();
  expect(await ctl.reconnectWifi()).toEqual({ ok: false, error: "quiet-active" });
  expect(warden.ops()).not.toContain("reconnect-wifi");
});

test("two interruptions in a session → one notification", async () => {
  const { ctl, helper, notes, advance } = setup();
  helper.emit(lolProc());
  await ctl.idle();
  const id = 7;
  let seq = 0;
  const probe = (ts: number, outcome: "reply" | "lost") => {
    seq++;
    helper.emit({ type: "probe-sent", target: "192.168.1.1", id, seq, ts });
    helper.emit({ type: "probe-result", target: "192.168.1.1", id, seq, ts: ts + (outcome === "reply" ? 3 : 1000), outcome, rttMs: outcome === "reply" ? 3 : undefined });
  };
  const t = 1_000_000;
  probe(t, "reply"); probe(t + 500, "lost"); probe(t + 1000, "lost"); probe(t + 1500, "reply");
  await advance(1000);
  probe(t + 3000, "lost"); probe(t + 3500, "lost"); probe(t + 4000, "reply");
  await advance(1000);
  expect(notes.filter((n) => /interrupt|cort/i.test(n))).toHaveLength(1);
  expect(ctl.view().interruptionsLastHour).toBe(2);
});

test("wifi without interface stops probes and clears wifi view", async () => {
  const { ctl, helper } = setup();
  helper.emit({ type: "wifi", iface: null, band: null, channel: null, widthMHz: null, rssi: null, noise: null, phyRateMbps: null, powerOn: null });
  await ctl.idle();
  expect(helper.sent.some((c) => c.cmd === "probe-stop")).toBe(true);
  expect(ctl.view().wifi).toBeNull();
});

test("launchAtLogin toggles the login agent once", async () => {
  const { ctl, agents } = setup();
  await ctl.updateSettings({ launchAtLogin: true });
  await ctl.updateSettings({ graceMs: 5000 });
  expect(agents).toEqual(["install"]);
});

test("probing starts at 2 s idle and switches to 0.5 s in quiet mode", async () => {
  const { ctl, helper } = setup();
  const gw = () => helper.sent.filter((c) => c.cmd === "probe-start" && c.target === "192.168.1.1").at(-1) as any;
  expect(gw().intervalMs).toBe(2000);
  ctl.manual(true);
  await ctl.idle();
  expect(gw().intervalMs).toBe(500);
});

test("helper restart re-sends probe commands", async () => {
  const { helper } = setup();
  const before = helper.sent.length;
  helper.restart();
  expect(helper.sent.slice(before).some((c) => c.cmd === "probe-start")).toBe(true);
});

test("paused automation drops game leases but manual still works", async () => {
  const { ctl, helper } = setup();
  helper.emit(lolProc());
  await ctl.idle();
  await ctl.pause();
  expect(ctl.view().because).toEqual([]);
  ctl.manual(true);
  await ctl.idle();
  expect(ctl.view().because).toEqual(["Manual"]);
});

test("quiet test runs A-B-A-B through the warden and produces a verdict", async () => {
  const { ctl, helper, warden, advance } = setup();
  ctl.startQuietTest();
  const gw = () => helper.sent.filter((c) => c.cmd === "probe-start" && c.target === "192.168.1.1").at(-1) as any;
  expect(gw().intervalMs).toBe(200);
  for (let i = 0; i < 4 * 62 + 30 && ctl.view().test.phase !== "done"; i++) await advance(1000);
  expect(ctl.view().test.phase).toBe("done");
  expect(ctl.view().test.results.map((r) => r.cond)).toEqual(["A", "B", "A", "B"]);
  expect(warden.ops().filter((o) => o === "hold")).toHaveLength(2);
  expect(warden.ops().filter((o) => o === "release")).toHaveLength(2);
  expect(gw().intervalMs).toBe(2000);
  expect(ctl.view().sessions).toHaveLength(0);
});

test("all probes to router and external lost → probes-blocked hint (e.g. firewall)", async () => {
  const { ctl, helper, advance } = setup();
  let seq = 0;
  for (let i = 0; i < 6; i++) {
    for (const target of ["192.168.1.1", "1.1.1.1"]) {
      seq++;
      helper.emit({ type: "probe-sent", target, id: 1, seq, ts: 1_000_000 + i * 2000 });
      helper.emit({ type: "probe-result", target, id: 1, seq, ts: 1_000_000 + i * 2000 + 1000, outcome: "lost" });
    }
  }
  await advance(13_000);
  expect(ctl.view().probesBlocked).toBe(true);
  expect(ctl.view().interruptionsLastHour).toBe(0);
});

test("a hold answered after stop is released immediately and does not activate", async () => {
  const { ctl, helper, warden } = setup();
  let release!: (r: any) => void;
  const orig = warden.request.bind(warden);
  warden.request = async (req: any) => (req.op === "hold" ? new Promise((r) => (release = r)) : orig(req));
  helper.emit(lolProc());
  const stopping = ctl.stop();
  release({ v: 1, id: 0, ok: true, token: 555 });
  await stopping;
  await ctl.idle();
  warden.request = orig;
  expect(ctl.view().phase).not.toBe("active");
  expect(warden.log).toContainEqual({ op: "release", token: 555 });
});

test("probe traffic does not keep a stale game lease alive", async () => {
  const { ctl, helper, advance } = setup();
  helper.emit(lolProc());
  await ctl.idle();
  for (let i = 0; i < 32; i++) {
    helper.emit({ type: "probe-sent", target: "192.168.1.1", id: 3, seq: i + 1, ts: 1_000_000 + i * 1000 });
    await advance(1000);
  }
  expect(ctl.view().because).toEqual([]);
});

test("wake does not resurrect leases from the pre-sleep process snapshot", async () => {
  const { ctl, helper, warden } = setup();
  helper.emit(lolProc());
  await ctl.idle();
  helper.emit({ type: "power", state: "will-sleep" });
  helper.emit({ type: "power", state: "did-wake" });
  await ctl.idle();
  expect(warden.ops().filter((o) => o === "hold")).toHaveLength(1);
  expect(ctl.view().because).toEqual([]);
});

test("handing a running quiet test over to a game opens a session", async () => {
  const { ctl, helper, advance } = setup();
  ctl.startQuietTest();
  for (let i = 0; i < 62; i++) await advance(1000);
  for (let i = 0; i < 5; i++) await advance(1000);
  helper.emit(lolProc());
  await ctl.idle();
  await advance(1000);
  helper.emit({ type: "procs", procs: [] });
  await advance(11_000);
  await advance(1000);
  expect(ctl.view().sessions).toHaveLength(1);
});

test("interruptions are attributed by timestamp; final one counted before close", async () => {
  const { ctl, helper, advance } = setup();
  ctl.manual(true);
  await ctl.idle();
  const t0 = 1_000_000;
  let seq = 0;
  const probe = (ts: number, outcome: "reply" | "lost") => {
    seq++;
    helper.emit({ type: "probe-sent", target: "192.168.1.1", id: 9, seq, ts });
    helper.emit({ type: "probe-result", target: "192.168.1.1", id: 9, seq, ts: ts + (outcome === "reply" ? 3 : 1000), outcome, rttMs: outcome === "reply" ? 3 : undefined });
  };
  probe(t0 + 100, "reply"); probe(t0 + 600, "lost"); probe(t0 + 1100, "lost"); probe(t0 + 1600, "reply");
  ctl.manual(false);
  await advance(10_500);
  await advance(1000);
  expect(ctl.view().sessions[0]?.interruptions).toBe(1);
});

test("traffic events become per-second rates in the view", async () => {
  const { ctl, helper } = setup();
  helper.emit({ type: "traffic", iface: "en0", rxBytes: 1_000, txBytes: 100, ts: 0 });
  helper.emit({ type: "traffic", iface: "en0", rxBytes: 2_001_000, txBytes: 50_100, ts: 1000 });
  expect(ctl.view().traffic).toEqual({ down: 2_000_000, up: 50_000 });
});

// ---- final review fixes ----

test("[final] restore pending after a failed release is visible, not 'normal'", async () => {
  const { ctl, warden, advance } = setup();
  warden.status = { ...warden.status, holding: false, tookDown: true, awdlUp: false, lastError: "awdl up failed; retrying" };
  await advance(1000);
  expect(ctl.view().restore).toEqual({ pending: true, error: "awdl up failed; retrying" });
  warden.status = { ...warden.status, tookDown: false, awdlUp: true, lastError: null };
  await advance(1000);
  expect(ctl.view().restore).toEqual({ pending: false, error: null });
});

test("[final] deadlines use the monotonic clock: wall clock rollback does not keep leases alive", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ctl-"));
  const helper = new FakeHelper();
  const warden = new FakeWarden();
  const settings = new SettingsStore(join(dir, "s.json"));
  settings.update({ rules: settings.get().rules.map((r) => (r.id === "lol" ? { ...r, enabled: true } : r)) });
  let wall = 10_000_000;
  let mono = 0;
  const ctl = new Controller({ helper, warden, settings, telemetry: new TelemetryStore(join(dir, "t.sqlite")), now: () => wall, mono: () => mono, notify: () => {}, gatewayKey: new Uint8Array(32), wardenPid: async () => 1, macosMajor: 27 });
  helper.emit(lolProc());
  await ctl.idle();
  wall -= 3_600_000;
  for (let i = 0; i < 42; i++) { mono += 1000; wall += 1000; await ctl.tick(); await ctl.idle(); }
  expect(ctl.view().because).toEqual([]);
});

test("[final] quiet test block stats include probes still awaiting their deadline at the boundary", async () => {
  const { ctl, helper, advance } = setup();
  ctl.startQuietTest();
  await advance(1000);
  const start = ctl.view().test.blockStart!;
  expect(start).not.toBeNull();
  helper.emit({ type: "probe-sent", target: "192.168.1.1", id: 5, seq: 1, ts: start + 59_900 });
  for (let i = 0; i < 60; i++) await advance(1000);
  helper.emit({ type: "probe-result", target: "192.168.1.1", id: 5, seq: 1, ts: start + 60_900, outcome: "lost" });
  await advance(1500);
  await Bun.sleep(30);
  expect(ctl.view().test.results[0]?.lost).toBe(1);
});

test("[final] a rejected hold during a quiet test invalidates it", async () => {
  const { ctl, warden, advance } = setup();
  ctl.startQuietTest();
  for (let i = 0; i < 30; i++) await advance(1000);
  expect(ctl.view().test.phase).toBe("A");
  const orig = warden.request.bind(warden);
  warden.request = async (req: any) => { if (req.op === "hold") throw new Error("timeout"); return orig(req); };
  for (let i = 0; i < 35; i++) await advance(1000);
  expect(ctl.view().test.phase).toBe("invalid");
});

test("[final] reconnect succeeds only after Wi-Fi is back and associated", async () => {
  const { ctl, helper, warden } = setup();
  warden.status = { ...warden.status, wifiPending: true };
  const p = ctl.reconnectWifi({ pollMs: 5, timeoutMs: 200 });
  await Bun.sleep(20);
  helper.emit({ type: "wifi", iface: "en0", band: null, channel: null, widthMHz: null, rssi: null, noise: null, phyRateMbps: null, powerOn: false });
  warden.status = { ...warden.status, wifiPending: false };
  warden.lastStatus = warden.status;
  await Bun.sleep(20);
  helper.emit({ type: "wifi", iface: "en0", band: "6", channel: 5, widthMHz: 160, rssi: -40, noise: -92, phyRateMbps: 2401, powerOn: true });
  expect(await p).toEqual({ ok: true, band: "6" });
  warden.status = { ...warden.status, wifiPending: true };
  warden.lastStatus = warden.status;
  expect(await ctl.reconnectWifi({ pollMs: 5, timeoutMs: 50 })).toEqual({ ok: false, error: "timeout" });
});

test("[final] live ping is unavailable when the latest probe was lost or the reply is stale", async () => {
  const { ctl, helper, advance, now } = setup();
  helper.emit({ type: "probe-sent", target: "192.168.1.1", id: 4, seq: 1, ts: now() });
  helper.emit({ type: "probe-result", target: "192.168.1.1", id: 4, seq: 1, ts: now() + 3, outcome: "reply", rttMs: 3 });
  expect(ctl.view().ping.gw).toBe(3);
  helper.emit({ type: "probe-sent", target: "192.168.1.1", id: 4, seq: 2, ts: now() + 500 });
  helper.emit({ type: "probe-result", target: "192.168.1.1", id: 4, seq: 2, ts: now() + 1500, outcome: "lost" });
  expect(ctl.view().ping.gw).toBeNull();
  helper.emit({ type: "probe-sent", target: "192.168.1.1", id: 4, seq: 3, ts: now() + 2000 });
  helper.emit({ type: "probe-result", target: "192.168.1.1", id: 4, seq: 3, ts: now() + 2003, outcome: "reply", rttMs: 4 });
  expect(ctl.view().ping.gw).toBe(4);
  await advance(12_000);
  expect(ctl.view().ping.gw).toBeNull();
});

test("restore AirDrop also cancels manual quiet, so re-enabling does not turn it back on", async () => {
  const { ctl, warden } = setup();
  ctl.manual(true);
  await ctl.idle();
  ctl.emergency();
  await ctl.idle();
  ctl.reenable();
  await ctl.idle();
  expect(ctl.view().because).toEqual([]);
  expect(ctl.view().phase).toBe("inactive");
  expect(warden.ops().filter((o) => o === "hold")).toHaveLength(1);
});

test("switch off stops quiet immediately (no grace) and ignores the running game until it ends", async () => {
  const { ctl, helper, warden, advance } = setup();
  helper.emit(lolProc(10));
  await ctl.idle();
  expect(ctl.view().phase).toBe("active");
  ctl.stopNow();
  await ctl.idle();
  expect(warden.ops()).toContain("release");
  expect(["inactive", "restoring"]).toContain(ctl.view().phase);
  helper.emit(lolProc(10));
  await advance(1000);
  expect(ctl.view().because).toEqual([]);
  helper.emit({ type: "procs", procs: [] });
  helper.emit(lolProc(11));
  await ctl.idle();
  expect(ctl.view().because).toEqual(["League of Legends (match)"]);
});

test("manual off releases without grace", async () => {
  const { ctl, warden } = setup();
  ctl.manual(true);
  await ctl.idle();
  ctl.manual(false);
  await ctl.idle();
  expect(warden.ops()).toContain("release");
  expect(ctl.view().phase).toBe("inactive");
});
