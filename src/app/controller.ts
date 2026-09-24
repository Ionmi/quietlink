import { advise, gatewayId, recordBand, type Advice } from "../domain/band";
import { LeaseSet, type Lease } from "../domain/leases";
import { Histogram, jitter, percentile } from "../domain/metrics";
import { initialMode, reduce, type Effect, type ModeInput, type ModeState, type Phase } from "../domain/mode";
import { noteFor, type WifiLogEvent } from "../domain/notes";
import { NotifyPolicy } from "../domain/notify-policy";
import { ProbeLedger } from "../domain/probes";
import { initialQT, qtReduce, type QTEffect, type QTInput, type QTState } from "../domain/quiettest";
import { summarize, type SessionSummary } from "../domain/session";
import { matchRules } from "../domain/triggers";
import { TrafficMeter, type Traffic } from "../domain/menubar";
import type { Settings, SettingsStore } from "../adapters/settings-store";
import type { TelemetryStore } from "../adapters/telemetry-store";
import type { HelperCommand, HelperEvent, ProcInfo, WardenResponse, WardenStatus, WifiEvent } from "../shared/protocol";
import { t, type Key } from "../shared/strings";

export type HelperLike = {
  on(fn: (e: HelperEvent) => void): unknown;
  onRestart(fn: () => void): unknown;
  send(c: HelperCommand): void;
  start(): void;
  stop(): void;
  checkHealth(): void;
};
export type WardenLike = {
  request(req: any, timeoutMs?: number): Promise<WardenResponse>;
  superviseTick(getPid: () => Promise<number | null>, timeoutMs?: number): Promise<"ok" | "killed" | "unreachable">;
  lastStatus: WardenStatus | null;
  close(): void;
};

export type ViewEvent = { ts: number; kind: "interruption" | "restored" | "info"; text: string; durationMs?: number; resolutionMs?: number; note?: string };

export type AppView = {
  phase: Phase;
  because: string[];
  paused: boolean;
  suppressed: boolean;
  lastError: string | null;
  privilege: boolean;
  wardenHealthy: boolean;
  recovering: boolean;
  wifi: WifiEvent | null;
  router: string | null;
  ping: { gw: number | null; ext: number | null };
  lossPct: number | null;
  jitter: number | null;
  late: number;
  provisional: boolean;
  interruptionsLastHour: number;
  /** Every router and external probe lost while Wi-Fi is up: likely a firewall (LuLu, Little Snitch) blocking the helper. */
  probesBlocked: boolean;
  /** Bytes/s the Wi-Fi interface is moving right now (not link capacity). */
  traffic: Traffic | null;
  advice: Advice;
  sparkline: { t: number; rtt: number | null }[];
  test: QTState;
  testSpikeMs: number;
  lastEvents: ViewEvent[];
  sessions: SessionSummary[];
  breakUntil: number | null;
  timedUntil: number | null;
  settings: Settings;
};

type Deps = {
  helper: HelperLike;
  warden: WardenLike;
  settings: SettingsStore;
  telemetry: TelemetryStore;
  notify: (title: string, body: string) => void;
  now?: () => number;
  gatewayKey: Uint8Array;
  wardenPid: () => Promise<number | null>;
  macosMajor: number;
  installLoginAgent?: (on: boolean) => Promise<void>;
  startLogStream?: (onEvent: (e: WifiLogEvent) => void) => { stop(): void };
};

const HOUR = 3_600_000;
const GW = "gw";
const QT_SPIKE_MS = 30;
const MONITOR_SPIKE_MS = 100;

type OpenSession = { start: number; triggers: Set<string>; hist: Histogram; max: number | null; spikes: number; sent: number; lost: number; interruptions: number; reenables0: number; notes: string[] };

/** Wires sensors → pure domain → warden effects. Single source of app state. */
export class Controller {
  private leases = new LeaseSet();
  private mode: ModeState = initialMode;
  private qt: QTState = initialQT;
  private ledger = new ProbeLedger({ deadlineMs: 1000, windowMs: 10 * 60_000 });
  private procs: ProcInfo[] = [];
  private inputActive: boolean | null = null;
  private wifi: WifiEvent | null = null;
  private router: { iface: string | null; ipv4: string | null; mac: string | null } = { iface: null, ipv4: null, mac: null };
  private targets = new Map<string, { name: string; intervalMs: number }>();
  private lastProcsAt: number;
  private lastInputAt: number;
  private stopped = false;
  private sleepingSince: number | null = null;
  private listeners = new Set<(v: AppView) => void>();
  private ops = new Set<Promise<unknown>>();
  private policy = new NotifyPolicy();
  private events: ViewEvent[] = [];
  private seenInterruptions = new Set<number>();
  private logEvents: WifiLogEvent[] = [];
  private logStream: { stop(): void } | null = null;
  private session: OpenSession | null = null;
  private secondAcc = new Map<string, { count: number; sum: number; min: number; max: number; lost: number; late: number }>();
  private lastRestored = 0;
  private trafficMeter = new TrafficMeter();
  private traffic: Traffic | null = null;
  private lastPrune = 0;
  private lastAdviceKind = "none";
  private timer: ReturnType<typeof setInterval> | null = null;
  private wardenHealthy = true;
  private readonly now: () => number;

  constructor(private d: Deps) {
    this.now = d.now ?? (() => Date.now());
    this.lastProcsAt = this.lastInputAt = this.now();
    d.helper.on((e) => { if (!this.stopped) this.onHelperEvent(e); });
    d.helper.onRestart(() => {
      this.ledger.onHelperRestart(this.now());
      this.resendProbes(true);
    });
    this.applyExplainCuts();
  }

  private get s(): Settings {
    return this.d.settings.get();
  }

  private tr(key: Key, vars?: Record<string, string | number>) {
    return t(this.s.lang, key, vars);
  }

  async start() {
    this.d.helper.start();
    this.timer = setInterval(() => void this.tick(), 1000);
  }

  async stop() {
    this.stopped = true; // no more sensor or timer work; late hold tokens are released
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.mode.token !== null) await this.d.warden.request({ op: "release", token: this.mode.token }).catch(() => {});
    await this.idle();
    this.logStream?.stop();
    this.d.helper.stop();
    this.d.telemetry.flush();
  }

  /** Resolves when all in-flight warden operations have settled (tests). */
  async idle() {
    while (this.ops.size) await Promise.allSettled([...this.ops]);
  }

  onChange(fn: (v: AppView) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    if (!this.listeners.size) return;
    const v = this.view();
    for (const fn of this.listeners) fn(v);
  }

  // ---------- leases ----------

  private reconcileLeases() {
    const now = this.now();
    const desired = new Map<string, Lease>();
    if (!this.s.paused) {
      for (const m of matchRules(this.s.rules, this.procs, this.inputActive))
        desired.set(m.key, { id: m.key, source: m.kind, label: m.label, since: now, sensorBound: true });
      if (this.s.inputTrigger && this.inputActive === true)
        desired.set("input", { id: "input", source: "input", label: this.tr("lease.input"), since: now, sensorBound: true });
    }
    let added = false;
    for (const l of this.leases.all()) if (l.sensorBound && !desired.has(l.id)) this.leases.remove(l.id);
    for (const [id, l] of desired) if (!this.leases.has(id)) { this.leases.add(l); added = true; }
    if (added && this.qtRunning()) this.qtInput({ kind: "trigger-started" });
    this.leasesChanged();
  }

  private leasesChanged(graceMs = this.s.graceMs) {
    const count = this.leases.active(this.now()).length;
    if (count !== this.mode.leases) this.input({ kind: "leases-changed", activeCount: count, now: this.now() }, graceMs);
  }

  // ---------- mode ----------

  private input(i: ModeInput, graceMs = this.s.graceMs) {
    const before = this.mode.phase;
    const { state, effects } = reduce(this.mode, i, { graceMs });
    this.mode = state;
    for (const e of effects) this.effect(e);
    if (before !== this.mode.phase) this.phaseChanged(before);
    this.changed();
  }

  private track<T>(p: Promise<T>) {
    this.ops.add(p);
    void p.finally(() => this.ops.delete(p));
    return p;
  }

  private effect(e: Effect) {
    const gen = this.mode.generation;
    switch (e.kind) {
      case "hold": {
        const qtRun = this.qtRunning() ? this.qt.run : null;
        this.track(
          this.d.warden.request({ op: "hold", ttlMs: 4000 }).then(
            (r) => {
              if (r.ok && r.token !== undefined) {
                if (this.stopped) {
                  this.track(this.d.warden.request({ op: "release", token: r.token }).catch(() => {}));
                  return;
                }
                this.input({ kind: "hold-ok", generation: e.generation, token: r.token });
                const accepted = this.mode.token === r.token && this.mode.generation === e.generation;
                if (accepted && qtRun !== null && this.qt.run === qtRun && this.leases.has("test")) this.qtInput({ kind: "hold-ack", run: qtRun, now: this.now() });
              } else {
                const err = r.ok ? "no-token" : r.error;
                this.input({ kind: "hold-failed", generation: e.generation, error: err, now: this.now() });
                if (err === "no-privilege" && this.policy.allow("privilege", this.now())) this.d.notify(this.tr("notify.privilege.title"), this.tr("notify.privilege.body"));
                if (this.qtRunning()) this.qtInput({ kind: "transition-failed", reason: err });
              }
            },
            (err) => this.input({ kind: "hold-failed", generation: e.generation, error: String(err?.message ?? err), now: this.now() }),
          ),
        );
        break;
      }
      case "renew":
        this.track(
          this.d.warden.request({ op: "renew", token: e.token }).then(
            (r) => { if (!r.ok && r.error === "lease-expired") this.input({ kind: "lease-expired", generation: gen }); },
            () => {},
          ),
        );
        break;
      case "release":
        if (e.token === null) break; // the late hold-ok will carry the token to release
        // The warden owns restoration: once it has dropped the lease it retries `up`
        // itself (status.lastError shows failures), and an unreachable warden lets the
        // dead-man lease expire. Either way this lease is over for the app.
        this.track(this.d.warden.request({ op: "release", token: e.token }).then(() => this.input({ kind: "released", generation: e.generation }), () => this.input({ kind: "released", generation: e.generation })));
        break;
      case "restore-now":
        this.track(this.d.warden.request({ op: "restore-now" }).catch(() => {}));
        break;
      case "rebuild-leases":
        for (const l of this.leases.all()) if (l.sensorBound) this.leases.remove(l.id);
        this.mode = { ...this.mode, leases: 0 };
        this.reconcileLeases(); // only fresh snapshots contribute (stale ones are cleared)
        break;
    }
  }

  private quietPhase(p = this.mode.phase) {
    return p === "activating" || p === "active" || p === "grace" || p === "airdrop-break";
  }

  private phaseChanged(before: Phase) {
    if (this.quietPhase() !== this.quietPhase(before)) this.resendProbes();
    this.reconcileSession();
  }

  /** A session exists exactly while quiet mode is held for a non-test reason. */
  private reconcileSession() {
    const owned = (this.mode.phase === "active" || this.mode.phase === "grace" || this.mode.phase === "airdrop-break") && this.leases.all().some((l) => l.source !== "test");
    if (owned && !this.session) {
      this.session = {
        start: this.now(), triggers: new Set(this.labels().filter((l) => l !== this.tr("lease.test"))), hist: new Histogram(), max: null, spikes: 0, sent: 0, lost: 0,
        interruptions: 0, reenables0: (this.d.warden.lastStatus as any)?.reenables ?? 0, notes: [],
      };
    } else if (owned && this.session) {
      for (const l of this.leases.all()) if (l.source !== "test") this.session.triggers.add(l.label);
    } else if (!owned && this.session) {
      this.checkInterruptions(); // finalize events before summarizing
      this.closeSession();
    }
  }

  private closeSession() {
    const s = this.session!;
    this.session = null;
    const reenables = ((this.d.warden.lastStatus as any)?.reenables ?? s.reenables0) - s.reenables0;
    const sum = summarize({ start: s.start, end: this.now(), triggers: [...s.triggers], hist: s.hist, max: s.max, spikes: s.spikes, interruptions: s.interruptions, sent: s.sent, lost: s.lost, awdlReenables: Math.max(0, reenables), notes: s.notes });
    this.d.telemetry.addSession(sum, s.hist.toJSON());
    if (s.interruptions > 0 && this.policy.allow("session", this.now()))
      this.d.notify(this.tr("notify.session.title"), this.tr("notify.session.body", { count: s.interruptions, name: sum.triggers.join(", ") }));
  }

  private labels() {
    return this.leases.active(this.now()).map((l) => l.label);
  }

  // ---------- public actions ----------

  manual(on: boolean, durationMs?: number) {
    this.leases.remove("manual");
    this.leases.remove("timed");
    if (on) {
      if (durationMs) this.leases.add({ id: "timed", source: "timed", label: this.tr("lease.timed", { min: Math.round(durationMs / 60_000) }), since: this.now(), expiresAt: this.now() + durationMs, sensorBound: false });
      else this.leases.add({ id: "manual", source: "manual", label: this.tr("lease.manual"), since: this.now(), sensorBound: false });
      if (this.qtRunning()) this.qtInput({ kind: "trigger-started" });
    }
    this.leasesChanged();
  }

  emergency() {
    this.input({ kind: "emergency" });
  }

  reenable() {
    this.input({ kind: "reenable" });
  }

  airdropBreak(ms = 120_000) {
    this.input({ kind: "airdrop-break", now: this.now(), ms });
  }

  async pause() {
    await this.updateSettings({ paused: true });
  }

  async resume() {
    await this.updateSettings({ paused: false });
  }

  async updateSettings(p: Partial<Settings>) {
    const before = this.s;
    const next = this.d.settings.update(p);
    if (p.launchAtLogin !== undefined && p.launchAtLogin !== before.launchAtLogin) await this.d.installLoginAgent?.(p.launchAtLogin);
    if (p.explainCuts !== undefined) this.applyExplainCuts();
    if (p.externalTarget !== undefined || p.extraTargets !== undefined) this.resendProbes();
    this.reconcileLeases();
    this.changed();
    return next;
  }

  async reconnectWifi(): Promise<{ ok: boolean; error?: string }> {
    if (this.quietPhase() || this.qtRunning()) return { ok: false, error: "quiet-active" };
    const iface = this.wifi?.iface;
    if (!iface) return { ok: false, error: "no-wifi" };
    const r = await this.track(this.d.warden.request({ op: "reconnect-wifi", iface }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }) as any));
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }

  /** Running app bundles, for the "add app" picker. */
  runningApps(): { name: string; path: string; bundle: string }[] {
    const seen = new Map<string, { name: string; path: string; bundle: string }>();
    for (const p of this.procs) {
      const i = p.path.indexOf(".app/");
      if (i < 0) continue;
      const bundle = p.path.slice(0, i + 4);
      if (seen.has(p.path)) continue;
      seen.set(p.path, { name: bundle.split("/").pop()!.replace(/\.app$/, ""), path: p.path, bundle });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  clearData() {
    this.d.telemetry.clearAll();
    this.events = [];
    this.seenInterruptions.clear();
    this.d.settings.update({ bandHistory: {} });
    this.changed();
  }

  startQuietTest() {
    this.qtInput({ kind: "start", now: this.now(), activeLeases: this.leases.active(this.now()).length, inGrace: this.mode.phase === "grace", wifi: this.fingerprint() });
  }

  cancelQuietTest() {
    this.qtInput({ kind: "cancel" });
  }

  // ---------- quiet test ----------

  private qtRunning() {
    return ["arming-A", "A", "arming-B", "B"].includes(this.qt.phase);
  }

  private fingerprint() {
    return { band: this.wifi?.band ?? null, channel: this.wifi?.channel ?? null, router: this.router.ipv4 };
  }

  private qtInput(i: QTInput) {
    const { state, effects } = qtReduce(this.qt, i);
    this.qt = state;
    for (const e of effects) this.qtEffect(e);
    this.changed();
  }

  private qtEffect(e: QTEffect) {
    switch (e.kind) {
      case "set-probe-interval":
        this.resendProbes();
        break;
      case "test-hold":
        this.leases.add({ id: "test", source: "test", label: this.tr("lease.test"), since: this.now(), sensorBound: false });
        this.leasesChanged();
        break;
      case "test-release":
        this.leases.remove("test");
        this.leasesChanged(0); // no grace between test blocks
        if (this.mode.phase === "grace") this.input({ kind: "tick", now: this.now() }, 0);
        break;
      case "hand-over-release":
        this.leases.remove("test");
        this.leasesChanged();
        break;
      case "collect-block": {
        const gw = this.router.ipv4;
        const r = gw ? this.ledger.range(gw, e.from, e.to) : { sent: 0, lost: 0, replies: [] };
        const h = new Histogram();
        r.replies.forEach((x) => h.add(x));
        this.qtInput({
          kind: "block-stats", run: e.run, block: e.block,
          stats: { cond: e.cond, sent: r.sent, lost: r.lost, spikes: r.replies.filter((x) => x > QT_SPIKE_MS).length, p95: percentile(h, 0.95), max: r.replies.length ? Math.max(...r.replies) : null },
        });
        break;
      }
    }
  }

  // ---------- probes ----------

  private intervalFor(name: string) {
    if (name === GW && this.qtRunning()) return 200;
    return this.quietPhase() ? 500 : 2000;
  }

  private desiredTargets() {
    const m = new Map<string, string>();
    if (!this.wifi?.iface || !this.router.ipv4) return m;
    m.set(this.router.ipv4, GW);
    if (this.s.externalTarget) m.set(this.s.externalTarget, "ext");
    for (const h of this.s.extraTargets) if (!m.has(h)) m.set(h, `hop:${h}`);
    return m;
  }

  private resendProbes(force = false) {
    const want = this.desiredTargets();
    const iface = this.wifi?.iface;
    for (const [target] of this.targets) if (!want.has(target)) {
      this.d.helper.send({ v: 1, cmd: "probe-stop", target });
      this.targets.delete(target);
    }
    for (const [target, name] of want) {
      const intervalMs = this.intervalFor(name);
      const cur = this.targets.get(target);
      if (!force && cur && cur.intervalMs === intervalMs) continue;
      this.targets.set(target, { name, intervalMs });
      this.d.helper.send({ v: 1, cmd: "probe-start", target, iface: iface!, intervalMs });
    }
  }

  // ---------- helper events ----------

  private onHelperEvent(e: HelperEvent) {
    switch (e.type) {
      case "procs":
        this.lastProcsAt = this.now();
        this.procs = e.procs;
        this.reconcileLeases();
        return;
      case "proc-exit":
        this.procs = this.procs.filter((p) => !(p.pid === e.pid && p.start === e.start));
        this.reconcileLeases();
        return;
      case "proc-launch":
        if (!this.procs.some((p) => p.pid === e.pid)) this.procs = [...this.procs, { pid: e.pid, start: e.start, path: e.path, bundleId: e.bundleId }];
        this.reconcileLeases();
        return;
      case "input-active":
        this.lastInputAt = this.now();
        this.inputActive = e.active;
        this.reconcileLeases();
        return;
      case "wifi": {
        const prev = this.wifi;
        this.wifi = e.iface ? e : null;
        if (!this.quietPhase() && this.wifi) {
          const id = gatewayId(this.router.mac, this.d.gatewayKey);
          const h = recordBand(this.s.bandHistory, id, this.wifi.band, this.now());
          if (h !== this.s.bandHistory && JSON.stringify(h[id!]?.bands) !== JSON.stringify(this.s.bandHistory[id!]?.bands)) this.d.settings.update({ bandHistory: h });
        }
        if (!this.wifi || prev?.iface !== this.wifi.iface) this.resendProbes(true);
        this.checkAdvice();
        this.changed();
        return;
      }
      case "router":
        this.router = { iface: e.iface, ipv4: e.ipv4, mac: e.mac };
        this.resendProbes();
        this.changed();
        return;
      case "power":
        if (e.state === "will-sleep") {
          this.sleepingSince = this.now();
          this.input({ kind: "sleep" });
        } else {
          if (this.sleepingSince !== null) this.ledger.onPause(this.sleepingSince, this.now());
          this.sleepingSince = null;
          // Pre-sleep snapshots are stale: leases are rebuilt only from fresh sensor data.
          this.procs = [];
          this.inputActive = null;
          this.input({ kind: "wake", now: this.now() });
        }
        return;
      case "net-change":
        return;
      case "traffic":
        this.traffic = this.trafficMeter.update(e.iface, e.rxBytes, e.txBytes, e.ts) ?? this.traffic;
        return;
      case "probe-sent":
      case "probe-result":
      case "probe-late":
      case "probe-send-failed":
        this.ledger.onEvent(e);
        if (e.type === "probe-result") this.accumulate(e);
        if (e.type === "probe-late") this.bucket(e.target).late++;
        return;
    }
  }

  private bucket(target: string) {
    let b = this.secondAcc.get(target);
    if (!b) this.secondAcc.set(target, (b = { count: 0, sum: 0, min: Infinity, max: 0, lost: 0, late: 0 }));
    return b;
  }

  private accumulate(e: Extract<HelperEvent, { type: "probe-result" }>) {
    const b = this.bucket(e.target);
    if (e.outcome === "reply" && e.rttMs !== undefined) {
      b.count++; b.sum += e.rttMs; b.min = Math.min(b.min, e.rttMs); b.max = Math.max(b.max, e.rttMs);
      if (this.session && e.target === this.router.ipv4) {
        this.session.sent++;
        this.session.hist.add(e.rttMs);
        this.session.max = Math.max(this.session.max ?? 0, e.rttMs);
        if (e.rttMs > MONITOR_SPIKE_MS) this.session.spikes++;
      }
    } else if (e.outcome === "lost") {
      b.lost++;
      if (this.session && e.target === this.router.ipv4) { this.session.sent++; this.session.lost++; }
    }
  }

  // ---------- tick ----------

  async tick() {
    if (this.stopped) return;
    const now = this.now();
    this.d.helper.checkHealth();
    // Sensor freshness is tracked per sensor: probe traffic never keeps triggers alive.
    let stale = false;
    if (now - this.lastProcsAt > 30_000 && this.procs.length) { this.procs = []; stale = true; }
    if (now - this.lastInputAt > 30_000 && this.inputActive !== null) { this.inputActive = null; stale = true; }
    if (stale) this.reconcileLeases();
    this.leasesChanged();
    this.checkInterruptions();
    this.input({ kind: "tick", now });

    if (this.qtRunning()) {
      const awdlUp = this.d.warden.lastStatus?.awdlUp;
      if (awdlUp !== null && awdlUp !== undefined) this.qtInput({ kind: "awdl-observed", up: awdlUp, now });
      this.qtInput({ kind: "tick", now, wifi: this.fingerprint() });
    }

    const sup = this.d.warden.superviseTick(this.d.wardenPid).then((r) => {
      this.wardenHealthy = r === "ok";
      const restored = this.d.warden.lastStatus?.restoredByWarden ?? 0;
      if (restored > this.lastRestored) {
        this.events.unshift({ ts: this.now(), kind: "restored", text: this.tr("notify.restored.body") });
        if (this.policy.allow("restored", this.now())) this.d.notify(this.tr("notify.restored.title"), this.tr("notify.restored.body"));
      }
      this.lastRestored = restored;
    }, () => { this.wardenHealthy = false; });
    this.track(sup);

    for (const [target, b] of this.secondAcc) {
      if (b.count || b.lost || b.late) this.d.telemetry.addSecond({ ts: now, target: this.targets.get(target)?.name ?? target, count: b.count, sum: b.sum, min: b.count ? b.min : 0, max: b.max, lost: b.lost, late: b.late });
    }
    this.secondAcc.clear();
    this.reconcileSession();
    if (now - this.lastPrune > HOUR) {
      this.d.telemetry.prune(now);
      this.lastPrune = now;
    }
    this.changed();
  }

  private checkInterruptions() {
    const gw = this.router.ipv4;
    if (!gw) return;
    for (const it of this.ledger.interruptions(gw)) {
      if (it.end === null || this.seenInterruptions.has(it.start)) continue;
      this.seenInterruptions.add(it.start);
      const durationMs = it.end - it.start;
      const note = this.s.explainCuts ? noteFor({ start: it.start, end: it.end }, this.logEvents) : null;
      const noteText = note
        ? note.text === "none" ? this.tr("note.none")
          : note.text === "channel-change" ? this.tr("note.channel-change")
          : this.tr(`note.${note.text.replace("-before", "")}-${(note.deltaMs ?? 0) >= 0 ? "before" : "during"}` as Key, { ms: Math.abs(note.deltaMs ?? 0) })
        : undefined;
      this.events.unshift({ ts: it.start, kind: "interruption", text: `≈${(durationMs / 1000).toFixed(1)} s`, durationMs, resolutionMs: it.resolutionMs, note: noteText });
      this.events = this.events.slice(0, 50);
      this.d.telemetry.addEvent({ ts: it.start, kind: "interruption", data: { durationMs, lostCount: it.lostCount, resolutionMs: it.resolutionMs, note: note?.text ?? null } });
      if (this.session && it.start >= this.session.start) {
        this.session.interruptions++;
        if (noteText) this.session.notes.push(noteText);
        if (this.policy.allow("cut", this.now()))
          this.d.notify(this.tr("notify.cut.title"), this.tr("notify.cut.body", { ms: Math.round(durationMs), name: [...this.session.triggers].join(", ") }));
      }
    }
  }

  private probesBlocked(now: number) {
    const dead = (target: string | null) => {
      if (!target) return true;
      const w = this.ledger.window(target, now);
      return w.sent >= 5 && w.replies.length === 0;
    };
    return !!this.wifi && !!this.router.ipv4 && dead(this.router.ipv4) && (!this.s.externalTarget || dead(this.s.externalTarget));
  }

  private checkAdvice() {
    const a = this.advice();
    if (a.kind === "previously-6" && this.lastAdviceKind !== a.kind && this.policy.allow("band", this.now()))
      this.d.notify(this.tr("notify.band.title", { band: a.current }), this.tr("notify.band.body"));
    this.lastAdviceKind = a.kind;
  }

  private advice(): Advice {
    return advise(this.s.bandHistory, gatewayId(this.router.mac, this.d.gatewayKey), this.wifi?.band ?? null, this.quietPhase());
  }

  private applyExplainCuts() {
    if (this.s.explainCuts && !this.logStream && this.d.startLogStream) {
      this.logStream = this.d.startLogStream((e) => {
        this.logEvents.push(e);
        const cutoff = this.now() - 10 * 60_000;
        this.logEvents = this.logEvents.filter((x) => x.ts >= cutoff);
      });
    } else if (!this.s.explainCuts && this.logStream) {
      this.logStream.stop();
      this.logStream = null;
      this.logEvents = [];
    }
  }

  // ---------- view ----------

  view(): AppView {
    const now = this.now();
    const gw = this.router.ipv4;
    const w = gw ? this.ledger.window(gw, now) : null;
    const lastRtt = (target: string | null) => {
      if (!target) return null;
      const r = this.ledger.window(target, now).replies;
      return r.length ? r[r.length - 1] : null;
    };
    const status = this.d.warden.lastStatus;
    const since = now - HOUR;
    const spark = gw ? this.ledger.series(gw, now - 5 * 60_000, now).slice(-300) : [];
    return {
      phase: this.mode.phase,
      because: this.labels(),
      paused: this.s.paused,
      suppressed: this.mode.phase === "suppressed",
      lastError: this.mode.lastError ?? status?.lastError ?? null,
      privilege: status?.privilege ?? false,
      wardenHealthy: this.wardenHealthy,
      recovering: status?.recovering ?? false,
      wifi: this.wifi,
      router: gw,
      ping: { gw: lastRtt(gw), ext: lastRtt(this.s.externalTarget) },
      lossPct: w && w.sent ? Math.round((w.lost / w.sent) * 1000) / 10 : null,
      jitter: w ? jitter(w.replies.slice(-60)) : null,
      late: w?.late ?? 0,
      provisional: w?.provisional ?? false,
      interruptionsLastHour: this.events.filter((e) => e.kind === "interruption" && e.ts >= since).length,
      probesBlocked: this.probesBlocked(now),
      traffic: this.wifi ? this.traffic : null,
      advice: this.advice(),
      sparkline: spark,
      test: this.qt,
      testSpikeMs: QT_SPIKE_MS,
      lastEvents: this.events.slice(0, 20),
      sessions: this.d.telemetry.sessions(10),
      breakUntil: this.mode.breakUntil,
      timedUntil: this.leases.all().find((l) => l.id === "timed")?.expiresAt ?? null,
      settings: this.s,
    };
  }
}
