# Quietlink v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (owner prefers Codex over Claude subagents for delegated review; see Execution). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Quietlink v1, a macOS menu-bar app that holds AWDL down while games/calls run, monitors Wi-Fi honestly, and restores AirDrop reliably, exactly as specified in the design spec.

**Architecture:** A Swift binary `quietlink-helper` runs in two modes: *sensor* (spawned by the app; emits JSON Lines for processes, input devices, Wi-Fi, router, ICMP probes, power/network events) and *warden* (user LaunchAgent; the only executor of `sudo -n ifconfig awdl0 down|up` and Wi-Fi power cycling, with dead-man leases and durable recovery). The Electrobun/Bun main process holds pure domain logic (leases, mode reducer, probe accounting, metrics, band advisor, notes, quiet test), adapters (helper/warden clients, SQLite, settings, privilege, LaunchAgents), tray/popover/settings UI in Svelte 5, and a CLI socket.

**Tech Stack:** Electrobun 2.0.1 via Hutch devkit, Bun 1.4.2, TypeScript 7, Svelte 5.57, Vite 8, `bun:sqlite`, Swift 6.4 (`swiftc`, frameworks: Foundation, AppKit, CoreWLAN, CoreAudio, SystemConfiguration, Darwin).

**Spec:** `docs/superpowers/specs/2026-09-24-quietlink-design.md` (rev 7). Executors read both.

## Global Constraints

- macOS 14+ target; verified only on macOS 27 / Apple Silicon in v1; README states this.
- License MIT. Local git only; publishing to GitHub requires explicit owner confirmation.
- Root surface: exactly `/sbin/ifconfig awdl0 down` and `/sbin/ifconfig awdl0 up` via `sudo -n`, argv arrays, no shell at runtime; sudoers file `/etc/sudoers.d/quietlink-<user>`, `root:wheel`, `0440`.
- Within Quietlink only the warden executes those commands and `networksetup -setairportpower`.
- Never scan Wi-Fi (`scanForNetworks`, `system_profiler`). Never request Location permission.
- Never store: raw command lines, raw unified-log lines, audio, packet contents, passwords, SSIDs/BSSIDs.
- Retention: per-second samples and events 24 h; sessions 30 d.
- App-support dir `~/Library/Application Support/Quietlink` mode `0700`; sockets `0600`.
- Lease ttl 4 s, renew 1 s; grace default 10 s; helper heartbeat 1 s, hung after 3 s; warden ping timeout 3 s; warden watchdog 3 s; recovery barrier timeout 10 s, convergence 5 s at 0.5 s.
- Probe deadline 1 s; interval 0.5 s in quiet mode, 2 s otherwise, 0.2 s in Quiet test; spike > 100 ms; interruption = ≥ 2 consecutive deadline losses.
- Notifications: max 1 per kind per 5 min.
- Wording: observations, never causes ("A Wi-Fi scan was logged 80 ms before this cut").
- Strings: English and Spanish.
- App identifier `dev.quietlink.app`; warden LaunchAgent label `dev.quietlink.warden`; login LaunchAgent label `dev.quietlink.login`.

## Review Focus

1. Warden restarts while `tookDown=true` and app is dead → must restore `up` (Task 11 test `restores on start when tookDown and no lease`).
2. App suspended then resumed renews an expired token → warden rejects with `lease-expired`, no `down` executed (Task 11 test `stale token rejected before execution`).
3. Probe reply after deadline → still counted lost, recorded late (Task 4 test `late reply stays lost`).
4. LoL client open without a match → no lease (Task 5 test `league client alone does not trigger`).
5. Helper silent > 30 s with active game lease → lease ends and quiet mode restores (Task 3 test `unknown sensor state expires leases`).

---

## File Structure

```text
Quietlink/
  package.json, tsconfig.json, vite.config.ts, svelte.config.js, electrobun.config.ts, bunfig.toml
  LICENSE, README.md, CONTRIBUTING.md, .gitignore, .github/workflows/ci.yml
  helper/                       Swift sources (built by scripts/build-helper.ts)
    main.swift                  mode dispatch: --sensor | --warden | --selftest | --test-warden
    Json.swift                  JSON Lines writer, protocol version
    SensorWifi.swift            CoreWLAN association snapshot
    SensorRouter.swift          SystemConfiguration router + RouterHardwareAddress
    SensorPower.swift           sleep/wake + network change notifications
    SensorProcesses.swift       NSWorkspace + libproc snapshots (pid, start time, path, bundle)
    SensorInput.swift           CoreAudio input-device running state
    Prober.swift                ICMP datagram prober
    WardenCore.swift            pure lease/token/decision logic (tested)
    WardenExecutor.swift        admission mutex, sudo/networksetup spawning, timeouts
    WardenState.swift           durable state (fsync + rename)
    WardenServer.swift          Unix socket server, watchdog, SIGTERM, recovery barrier
    Tests.swift                 --test-warden assertion runner
  src/shared/
    protocol.ts                 helper events + warden messages (types)
    strings.ts                  en/es dictionary + t()
    presets.json                trigger presets (versioned)
  src/domain/                   pure, fully unit-tested
    leases.ts, mode.ts, probes.ts, metrics.ts, triggers.ts, band.ts, notes.ts, logparse.ts,
    quiettest.ts, session.ts, notify-policy.ts, redact.ts
  src/adapters/
    helper-client.ts, warden-client.ts, privilege.ts, launch-agents.ts, settings-store.ts,
    telemetry-store.ts, log-stream.ts, instance-lock.ts, paths.ts
  src/app/
    controller.ts               wires sensors → domain → effects; single source of app state
    export.ts                   Markdown diagnostics
    cli-server.ts
  src/main/
    index.ts, tray.ts, windows.ts, rpc-api.ts
  src/views/
    popover/ (index.html, main.ts, App.svelte, Sparkline.svelte)
    settings/ (index.html, main.ts, App.svelte, sections/*.svelte)
    shared/ (bridge.ts, style.css)
  bin/quietlink                  CLI (Bun script)
  icons/ (app-icon.svg, tray-idle.svg, tray-quiet.svg, tray-warn.svg)
  scripts/ (build-helper.ts, prepare-icons.ts, start.ts, verify-mac.ts)
  tests/ (*.test.ts, fixtures/)
```

---

### Task 1: Scaffold Electrobun app with tray and positioned popover (spike included)

**Files:**
- Create: `package.json`, `tsconfig.json`, `electrobun.config.ts`, `vite.config.ts`, `svelte.config.js`, `.gitignore`, `LICENSE`, `scripts/start.ts`, `src/main/index.ts`, `src/main/tray.ts`, `src/main/windows.ts`, `src/views/popover/{index.html,main.ts,App.svelte}`, `src/views/shared/{bridge.ts,style.css}`, `tests/smoke.test.ts`

**Interfaces:**
- Produces: `openPopover()`, `closePopover()`, `showSettings()` in `src/main/windows.ts`; `TrayController` with `setState(state: "idle"|"quiet"|"warn")`, `setTitle(text: string)`, `setMenu(items)` in `src/main/tray.ts`; `bridge.call(method, ...args)` in `src/views/shared/bridge.ts`.

- [ ] **Step 1: package.json and configs** (mirror `~/Development/clipboardai`)

```json
{
  "name": "quietlink", "version": "0.1.0", "type": "module", "private": true, "license": "MIT",
  "engines": { "bun": ">=1.4.2" },
  "scripts": {
    "build:helper": "bun scripts/build-helper.ts",
    "build:views": "vite build",
    "build": "bun run build:helper && bun run build:views && bun scripts/prepare-icons.ts && electrobun build --env=dev",
    "start": "bun scripts/start.ts",
    "dev": "bun run build && bun run start",
    "check": "tsc --noEmit",
    "test": "bun test tests",
    "test:helper": "bun scripts/build-helper.ts && build/helper/quietlink-helper --test-warden && build/helper/quietlink-helper --selftest"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "7.3.0", "@types/bun": "1.4.2", "electrobun": "2.0.1",
    "svelte": "5.57.0", "typescript": "7.0.2", "vite": "8.3.0"
  }
}
```

`tsconfig.json`: copy clipboardai's (paths for `electrobun`, `electrobun/main`, `electrobun/view` → `.hutch/devkit/...`), `include: ["src/**/*", "tests/**/*", "bin/**/*", "scripts/**/*"]`.

`electrobun.config.ts`:

```ts
import type { ElectrobunConfig } from "electrobun";
export default {
  app: { name: "Quietlink", identifier: "dev.quietlink.app", version: "0.1.0" },
  runtime: { exitOnLastWindowClosed: false },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "src/main/index.ts", version: "1.4.2" },
    views: {
      popover: { entrypoint: "src/views/popover/bridge-entry.ts" },
      settings: { entrypoint: "src/views/settings/bridge-entry.ts" },
    },
    copy: {
      "dist/views/popover/index.html": "views/popover/index.html",
      "dist/views/popover/assets": "views/popover/assets",
      "dist/views/settings/index.html": "views/settings/index.html",
      "dist/views/settings/assets": "views/settings/assets",
      "build/helper/quietlink-helper": "helper/quietlink-helper",
      "build/tray": "views/tray",
      "src/shared/presets.json": "presets.json",
    },
    buildFolder: "build/electrobun",
    artifactFolder: "build/electrobun-artifacts",
    mac: { bundleCEF: false, icons: "build/icon.iconset", createDmg: false },
  },
} satisfies ElectrobunConfig;
```

`vite.config.ts`: multi-page build with roots `src/views/popover` and `src/views/settings` → `dist/views/<name>` (two `build.rollupOptions.input` entries, `base: "./"`).

- [ ] **Step 2: `bun install` and `bunx electrobun prepare`**; expect `.hutch/devkit` present. Add `.hutch/`, `build/`, `dist/`, `node_modules/` to `.gitignore`.

- [ ] **Step 3: tray + popover spike.** `src/main/tray.ts` creates `new Tray({ image: "views://tray/tray-idle.png", template: true, width: 18, height: 18 })`; on `tray-clicked` with no menu action, call `openPopover(tray.getBounds())`. `src/main/windows.ts` creates a `BrowserWindow` with `titleBarStyle: "hidden"`, `frame: {width: 340, height: 460}`, `hidden: true`; `openPopover(b)` does `setFrame(b.x + b.width/2 - 170, b.y + b.height + 4, 340, 460)`, `setAlwaysOnTop(true)`, `setVisibleOnAllWorkspaces(true)`, `show()`, `activate()`; the window's `blur` event calls `hide()`. Dock icon hidden via `Utils.setDockIconVisible(false)`.

- [ ] **Step 4: Build and verify manually.** Run `bun run build:views && bunx electrobun build --env=dev && bun run start` (helper copy may be missing; create an empty placeholder `build/helper/quietlink-helper` for this task). Expected: menu-bar icon; click opens a small window under it; clicking elsewhere hides it; works over a fullscreen app Space. Record findings (blur reliable? positioning on second display?) in `docs/notes/popover-spike.md`. If blur/positioning fails, fall back: tray uses native menu only and "Open dashboard" opens a normal window — record the decision.

- [ ] **Step 5: smoke test** `tests/smoke.test.ts`: `expect(await Bun.file("electrobun.config.ts").exists()).toBe(true)` plus import of `src/shared/protocol.ts` once Task 2 lands (keep file trivial now). Run `bun test`. Expected PASS.

- [ ] **Step 6: Commit** `feat: scaffold Electrobun app with tray and popover`.

---

### Task 2: Shared protocol types and strings

**Files:** Create `src/shared/protocol.ts`, `src/shared/strings.ts`, `tests/strings.test.ts`

**Interfaces (Produces):**

```ts
export const PROTOCOL_VERSION = 1;
export type HelperEvent =
  | { v: 1; type: "heartbeat"; ts: number }
  | { v: 1; type: "wifi"; ts: number; iface: string | null; band: "2.4" | "5" | "6" | null; channel: number | null; widthMHz: number | null; rssi: number | null; noise: number | null; phyRateMbps: number | null; powerOn: boolean | null }
  | { v: 1; type: "router"; ts: number; iface: string | null; ipv4: string | null; mac: string | null }
  | { v: 1; type: "power"; ts: number; state: "will-sleep" | "did-wake" }
  | { v: 1; type: "net-change"; ts: number }
  | { v: 1; type: "procs"; ts: number; procs: { pid: number; start: number; path: string; bundleId: string | null }[] }
  | { v: 1; type: "proc-launch" | "proc-exit"; ts: number; pid: number; start: number; path: string; bundleId: string | null }
  | { v: 1; type: "input-active"; ts: number; active: boolean | null }
  | { v: 1; type: "probe-sent"; ts: number; target: string; id: number; seq: number }
  | { v: 1; type: "probe-result"; ts: number; target: string; id: number; seq: number; outcome: "reply" | "lost" | "error"; rttMs?: number; error?: string }
  | { v: 1; type: "probe-late"; ts: number; target: string; id: number; seq: number; rttMs: number }
  | { v: 1; type: "probe-send-failed"; ts: number; target: string; error: string };
export type HelperCommand =
  | { v: 1; cmd: "probe-start"; target: string; iface: string; intervalMs: number }
  | { v: 1; cmd: "probe-stop"; target: string }
  | { v: 1; cmd: "snapshot" };
export type WardenRequest =
  | { v: 1; id: number; op: "ping" }
  | { v: 1; id: number; op: "hold"; ttlMs: number }
  | { v: 1; id: number; op: "renew"; token: number }
  | { v: 1; id: number; op: "release"; token: number }
  | { v: 1; id: number; op: "restore-now" }
  | { v: 1; id: number; op: "reconnect-wifi"; iface: string }
  | { v: 1; id: number; op: "status" };
export type WardenResponse =
  | { v: 1; id: number; ok: true; token?: number; status?: WardenStatus }
  | { v: 1; id: number; ok: false; error: "lease-expired" | "recovering" | "no-privilege" | "busy" | "bad-request" | "command-failed"; detail?: string };
export type WardenStatus = { awdlUp: boolean | null; holding: boolean; tookDown: boolean; recovering: boolean; privilege: boolean; lastError: string | null; wifiPending: boolean };
```

`strings.ts`: `export type Lang = "en" | "es"; export const strings: Record<Lang, Record<Key, string>>; export function t(lang: Lang, key: Key, vars?: Record<string, string | number>): string` with `{name}` interpolation. Keys used by later tasks are added there as tasks need them (each task lists its keys).

- [ ] **Step 1: failing test** `tests/strings.test.ts`

```ts
import { expect, test } from "bun:test";
import { strings, t } from "../src/shared/strings";
test("every key exists in both languages", () => {
  expect(Object.keys(strings.es).sort()).toEqual(Object.keys(strings.en).sort());
});
test("interpolates variables", () => {
  expect(t("en", "quiet.because", { name: "League of Legends" })).toBe("Quiet because: League of Legends");
  expect(t("es", "quiet.because", { name: "League of Legends" })).toBe("Silencio por: League of Legends");
});
```

- [ ] **Step 2:** `bun test tests/strings.test.ts` → FAIL (module missing).
- [ ] **Step 3:** implement `protocol.ts` (types above) and `strings.ts` with initial keys `quiet.because`, `quiet.on`, `quiet.off`, `restore.airdrop`, `airdrop.break`, `pause.automation`, `resume.automation`.
- [ ] **Step 4:** `bun test` → PASS. `bun run check` → no errors.
- [ ] **Step 5: Commit** `feat: shared protocol types and en/es strings`.

---

### Task 3: Leases and mode reducer (pure)

**Files:** Create `src/domain/leases.ts`, `src/domain/mode.ts`, `tests/mode.test.ts`

**Interfaces (Produces):**

```ts
// leases.ts
export type LeaseSource = "manual" | "timed" | "game" | "call" | "input" | "test";
export type Lease = { id: string; source: LeaseSource; label: string; since: number; expiresAt?: number; sensorBound: boolean };
export class LeaseSet { add(l: Lease): void; remove(id: string): void; has(id: string): boolean; active(now: number): Lease[]; expireUnknown(now: number, lastSensorTs: number, boundMs: number): string[] }

// mode.ts
export type Phase = "inactive" | "activating" | "active" | "airdrop-break" | "grace" | "restoring" | "fault" | "suppressed";
export type ModeState = { phase: Phase; generation: number; token: number | null; graceUntil: number | null; breakUntil: number | null; paused: boolean; faultRetryAt: number | null; faultCount: number };
export type ModeInput =
  | { kind: "leases-changed"; activeCount: number; now: number }
  | { kind: "tick"; now: number }
  | { kind: "hold-ok"; generation: number; token: number }
  | { kind: "hold-failed"; generation: number; error: string; now: number }
  | { kind: "lease-expired"; generation: number }
  | { kind: "released"; generation: number }
  | { kind: "emergency" } | { kind: "reenable" }
  | { kind: "airdrop-break"; now: number; ms: number }
  | { kind: "pause" } | { kind: "resume" }
  | { kind: "sleep" } | { kind: "wake"; now: number };
export type Effect =
  | { kind: "hold"; generation: number }
  | { kind: "renew"; token: number }
  | { kind: "release"; token: number | null; generation: number }
  | { kind: "restore-now" }
  | { kind: "rebuild-leases" };
export const initialMode: ModeState;
export function reduce(s: ModeState, i: ModeInput, cfg: { graceMs: number }): { state: ModeState; effects: Effect[] };
```

Rules (from spec §4.1–4.3): entering `activating` increments `generation` and emits `hold`; `hold-ok` with current generation → `active`, store token; stale generation ignored; each `tick` in `active` emits `renew`; `leases-changed` to 0 in `active` → `grace` until now+graceMs; new lease during grace → `active` (no release); grace expiry → `restoring` + `release`; `released` → `inactive`; `lease-expired` → `inactive` + `rebuild-leases`; `hold-failed` → `fault` with backoff 1,2,5,10 s then retry via `activating`; `emergency` from any phase → `suppressed` + `restore-now`, ignores all lease inputs until `reenable`; `airdrop-break` in active → `airdrop-break` + `release`, at `breakUntil` → `activating` if leases > 0; `sleep` → `restoring` + `release`; `wake` → `inactive` + `rebuild-leases`; `paused` is consumed by the controller (only non-manual leases are dropped) and does not change phase directly.

- [ ] **Step 1: failing tests** `tests/mode.test.ts`

```ts
import { expect, test } from "bun:test";
import { reduce, initialMode, type ModeState } from "../src/domain/mode";
import { LeaseSet } from "../src/domain/leases";
const cfg = { graceMs: 10_000 };
const run = (s: ModeState, ...inputs: Parameters<typeof reduce>[1][]) => inputs.reduce((acc, i) => { const r = reduce(acc.state, i, cfg); return { state: r.state, effects: [...acc.effects, ...r.effects] }; }, { state: s, effects: [] as any[] });

test("first lease activates and holds with new generation", () => {
  const r = reduce(initialMode, { kind: "leases-changed", activeCount: 1, now: 0 }, cfg);
  expect(r.state.phase).toBe("activating");
  expect(r.effects).toEqual([{ kind: "hold", generation: 1 }]);
});
test("stale hold-ok is ignored", () => {
  const r = run(initialMode, { kind: "leases-changed", activeCount: 1, now: 0 }, { kind: "hold-ok", generation: 0, token: 9 });
  expect(r.state.phase).toBe("activating");
});
test("renews every tick while active", () => {
  const r = run(initialMode, { kind: "leases-changed", activeCount: 1, now: 0 }, { kind: "hold-ok", generation: 1, token: 7 }, { kind: "tick", now: 1000 });
  expect(r.effects.at(-1)).toEqual({ kind: "renew", token: 7 });
});
test("grace keeps quiet and a new lease cancels it without release", () => {
  const r = run(initialMode, { kind: "leases-changed", activeCount: 1, now: 0 }, { kind: "hold-ok", generation: 1, token: 7 },
    { kind: "leases-changed", activeCount: 0, now: 5000 }, { kind: "leases-changed", activeCount: 1, now: 8000 });
  expect(r.state.phase).toBe("active");
  expect(r.effects.some((e) => e.kind === "release")).toBe(false);
});
test("grace expiry releases", () => {
  const r = run(initialMode, { kind: "leases-changed", activeCount: 1, now: 0 }, { kind: "hold-ok", generation: 1, token: 7 },
    { kind: "leases-changed", activeCount: 0, now: 5000 }, { kind: "tick", now: 15_001 });
  expect(r.state.phase).toBe("restoring");
  expect(r.effects.at(-1)).toEqual({ kind: "release", token: 7, generation: 1 });
});
test("lease-expired drops to inactive and rebuilds", () => {
  const r = run(initialMode, { kind: "leases-changed", activeCount: 1, now: 0 }, { kind: "hold-ok", generation: 1, token: 7 }, { kind: "lease-expired", generation: 1 });
  expect(r.state.phase).toBe("inactive");
  expect(r.effects.at(-1)).toEqual({ kind: "rebuild-leases" });
});
test("emergency suppresses manual leases, grace and retries until reenable", () => {
  let r = run(initialMode, { kind: "leases-changed", activeCount: 1, now: 0 }, { kind: "emergency" }, { kind: "leases-changed", activeCount: 2, now: 1 }, { kind: "hold-failed", generation: 1, error: "x", now: 2 });
  expect(r.state.phase).toBe("suppressed");
  expect(r.effects.filter((e) => e.kind === "hold")).toHaveLength(1);
  r = run(r.state, { kind: "reenable" });
  expect(r.state.phase).toBe("inactive");
  expect(r.effects).toEqual([{ kind: "rebuild-leases" }]);
});
test("fault backs off 1,2,5,10 s", () => {
  let s = run(initialMode, { kind: "leases-changed", activeCount: 1, now: 0 }, { kind: "hold-failed", generation: 1, error: "no-privilege", now: 0 }).state;
  expect(s.phase).toBe("fault"); expect(s.faultRetryAt).toBe(1000);
  s = run(s, { kind: "tick", now: 1000 }, { kind: "hold-failed", generation: 2, error: "x", now: 1000 }).state;
  expect(s.faultRetryAt).toBe(3000);
});
test("airdrop break releases then re-holds", () => {
  const r = run(initialMode, { kind: "leases-changed", activeCount: 1, now: 0 }, { kind: "hold-ok", generation: 1, token: 7 }, { kind: "airdrop-break", now: 10, ms: 120_000 }, { kind: "tick", now: 120_011 });
  expect(r.effects.map((e) => e.kind)).toEqual(["hold", "release", "hold"]);
});
test("unknown sensor state expires leases", () => {
  const set = new LeaseSet();
  set.add({ id: "game:1", source: "game", label: "LoL", since: 0, sensorBound: true });
  set.add({ id: "manual", source: "manual", label: "Manual", since: 0, sensorBound: false });
  expect(set.expireUnknown(31_000, 0, 30_000)).toEqual(["game:1"]);
  expect(set.active(31_000).map((l) => l.id)).toEqual(["manual"]);
});
test("sleep releases and wake rebuilds", () => {
  const r = run(initialMode, { kind: "leases-changed", activeCount: 1, now: 0 }, { kind: "hold-ok", generation: 1, token: 7 }, { kind: "sleep" }, { kind: "wake", now: 99 });
  expect(r.effects.map((e) => e.kind)).toEqual(["hold", "release", "rebuild-leases"]);
});
```

- [ ] **Step 2:** `bun test tests/mode.test.ts` → FAIL.
- [ ] **Step 3:** implement `leases.ts` and `mode.ts` per rules above (single `switch` on `i.kind`, every branch returns new state object; backoff table `[1000, 2000, 5000, 10000]` indexed by `min(faultCount, 3)`).
- [ ] **Step 4:** tests PASS; `bun run check` clean.
- [ ] **Step 5: Commit** `feat(domain): lease set and mode reducer`.

---

### Task 4: Probe accounting and metrics (pure)

**Files:** Create `src/domain/probes.ts`, `src/domain/metrics.ts`, `tests/probes.test.ts`, `tests/metrics.test.ts`

**Interfaces (Produces):**

```ts
// probes.ts
export type ProbeRecord = { target: string; seq: number; sentAt: number; outcome: "pending" | "reply" | "lost" | "error" | "unknown"; rttMs?: number; late?: number };
export class ProbeLedger {
  constructor(opts: { deadlineMs: number; windowMs: number });
  onEvent(e: HelperEvent): void;              // probe-sent/result/late/send-failed
  onHelperRestart(now: number): void;         // pending → unknown
  onPause(from: number, to: number): void;    // sleep/downtime excluded
  window(target: string, now: number): { sent: number; lost: number; late: number; replies: number[]; provisional: boolean };
  interruptions(target: string): { start: number; end: number | null; lostCount: number; resolutionMs: number }[];
}
// metrics.ts
export function jitter(rtts: number[]): number | null;   // mean |r[i]-r[i-1]|
export function percentile(hist: Histogram, p: number): number | null;
export class Histogram { static buckets: number[]; add(ms: number): void; merge(h: Histogram): void; count: number; toJSON(): number[]; static from(a: number[]): Histogram }
```

Histogram buckets: log-scale upper bounds `[1,2,3,4,5,6,8,10,12,15,20,25,30,40,50,60,80,100,120,150,200,250,300,400,500,700,1000,Infinity]`; percentile returns the bucket upper bound (spec: exact to bucket resolution).

- [ ] **Step 1: failing tests** `tests/probes.test.ts`

```ts
import { expect, test } from "bun:test";
import { ProbeLedger } from "../src/domain/probes";
const L = () => new ProbeLedger({ deadlineMs: 1000, windowMs: 60_000 });
const sent = (seq: number, ts: number) => ({ v: 1, type: "probe-sent", ts, target: "gw", id: 1, seq }) as const;
const res = (seq: number, ts: number, outcome: "reply" | "lost", rttMs?: number) => ({ v: 1, type: "probe-result", ts, target: "gw", id: 1, seq, outcome, rttMs }) as const;

test("late reply stays lost", () => {
  const l = L(); l.onEvent(sent(1, 0)); l.onEvent(res(1, 1000, "lost"));
  l.onEvent({ v: 1, type: "probe-late", ts: 1200, target: "gw", id: 1, seq: 1, rttMs: 1200 });
  expect(l.window("gw", 2000)).toMatchObject({ sent: 1, lost: 1, late: 1 });
});
test("pending probes before deadline are excluded and window is provisional", () => {
  const l = L(); l.onEvent(sent(1, 0)); l.onEvent(res(1, 5, "reply", 5)); l.onEvent(sent(2, 500));
  expect(l.window("gw", 600)).toMatchObject({ sent: 1, lost: 0, provisional: true });
});
test("helper restart turns pending into unknown, excluded from loss", () => {
  const l = L(); l.onEvent(sent(1, 0)); l.onHelperRestart(300);
  expect(l.window("gw", 5000)).toMatchObject({ sent: 0, lost: 0 });
});
test("send-failed is not counted as sent", () => {
  const l = L(); l.onEvent({ v: 1, type: "probe-send-failed", ts: 0, target: "gw", error: "EHOSTUNREACH" });
  expect(l.window("gw", 5000).sent).toBe(0);
});
test("interruption needs two consecutive losses and reports resolution", () => {
  const l = L();
  l.onEvent(sent(1, 0)); l.onEvent(res(1, 3, "reply", 3));
  l.onEvent(sent(2, 500)); l.onEvent(res(2, 1500, "lost"));
  l.onEvent(sent(3, 1000)); l.onEvent(res(3, 2000, "lost"));
  l.onEvent(sent(4, 1500)); l.onEvent(res(4, 1504, "reply", 4));
  expect(l.interruptions("gw")).toEqual([{ start: 3, end: 1504, lostCount: 2, resolutionMs: 500 }]);
});
test("single loss is not an interruption", () => {
  const l = L(); l.onEvent(sent(1, 0)); l.onEvent(res(1, 1000, "lost")); l.onEvent(sent(2, 500)); l.onEvent(res(2, 502, "reply", 2));
  expect(l.interruptions("gw")).toEqual([]);
});
test("sleep window is excluded", () => {
  const l = L(); l.onEvent(sent(1, 0)); l.onEvent(res(1, 1000, "lost")); l.onPause(0, 10_000);
  expect(l.window("gw", 20_000).sent).toBe(0);
});
test("duplicate result ignored", () => {
  const l = L(); l.onEvent(sent(1, 0)); l.onEvent(res(1, 3, "reply", 3)); l.onEvent(res(1, 4, "reply", 4));
  expect(l.window("gw", 5000)).toMatchObject({ sent: 1, replies: [3] });
});
```

`tests/metrics.test.ts`:

```ts
import { expect, test } from "bun:test";
import { jitter, Histogram, percentile } from "../src/domain/metrics";
test("jitter is mean absolute successive difference", () => { expect(jitter([4, 6, 5, 9])).toBeCloseTo((2 + 1 + 4) / 3); expect(jitter([4])).toBeNull(); });
test("percentile uses bucket upper bounds and merges exactly", () => {
  const a = new Histogram(); [3, 3, 3, 90].forEach((x) => a.add(x));
  const b = Histogram.from(a.toJSON()); b.merge(a);
  expect(b.count).toBe(8); expect(percentile(b, 0.5)).toBe(3); expect(percentile(b, 0.95)).toBe(100);
});
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement. Ledger keeps per-target `Map<seq, ProbeRecord>` pruned beyond `windowMs`; seq keyed by `(id, seq)` so helper restarts (new id) don't collide; interruption scan walks records in seq order, a run of ≥2 `lost` starts at the last reply's `ts` before it and ends at the next reply's `ts`; `resolutionMs` = interval between sends (median of consecutive `sentAt` deltas).
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(domain): probe ledger, interruptions, histograms`.

---

### Task 5: Trigger matching and presets (pure)

**Files:** Create `src/domain/triggers.ts`, `src/shared/presets.json`, `tests/triggers.test.ts`

**Interfaces (Produces):**

```ts
export type TriggerRule =
  | { id: string; label: string; kind: "game" | "call"; match: { executable?: string; bundlePrefix?: string; bundleId?: string }; exclude?: string[]; requireInput?: boolean; enabled: boolean; verified: boolean };
export type ProcInfo = { pid: number; start: number; path: string; bundleId: string | null };
export function matchRules(rules: TriggerRule[], procs: ProcInfo[], inputActive: boolean | null): { ruleId: string; label: string; kind: "game" | "call"; key: string }[];
export function loadPresets(json: unknown): TriggerRule[];   // validates version === 1
```

`key` = `${ruleId}:${pid}:${start}` (identity = PID + start time). `executable` matches the full path suffix exactly (after `/`), `bundlePrefix` matches any process whose path is inside that `.app` bundle directory ("whole application"), `exclude` lists path suffixes never matched. `requireInput` rules match only if `inputActive === true`. Unverified presets are loaded but `enabled: false` and hidden unless "show unverified" is on.

`presets.json` (v1; `verified` flipped to true only after Task 21 checks on the owner's Mac):

```json
{ "version": 1, "rules": [
  { "id": "lol", "label": "League of Legends (match)", "kind": "game",
    "match": { "executable": "League of Legends.app/Contents/MacOS/League of Legends" },
    "exclude": ["LeagueClient", "LeagueClientUx", "Riot Client"], "enabled": true, "verified": false },
  { "id": "zoom-meeting", "label": "Zoom meeting", "kind": "call", "match": { "executable": "CptHost.app/Contents/MacOS/CptHost" }, "enabled": true, "verified": false },
  { "id": "facetime", "label": "FaceTime (with microphone)", "kind": "call", "match": { "bundleId": "com.apple.FaceTime" }, "requireInput": true, "enabled": false, "verified": false },
  { "id": "teams", "label": "Microsoft Teams (with microphone)", "kind": "call", "match": { "bundleId": "com.microsoft.teams2" }, "requireInput": true, "enabled": false, "verified": false },
  { "id": "discord", "label": "Discord (with microphone)", "kind": "call", "match": { "bundleId": "com.hnc.Discord" }, "requireInput": true, "enabled": false, "verified": false },
  { "id": "slack", "label": "Slack (with microphone)", "kind": "call", "match": { "bundleId": "com.tinyspeck.slackmacgap" }, "requireInput": true, "enabled": false, "verified": false },
  { "id": "webex", "label": "Webex (with microphone)", "kind": "call", "match": { "bundleId": "Cisco-Systems.Spark" }, "requireInput": true, "enabled": false, "verified": false }
] }
```

- [ ] **Step 1: failing tests**

```ts
import { expect, test } from "bun:test";
import { matchRules, loadPresets } from "../src/domain/triggers";
import presets from "../src/shared/presets.json";
const rules = loadPresets(presets).map((r) => ({ ...r, enabled: true }));
const P = (pid: number, path: string, bundleId: string | null = null) => ({ pid, start: 100, path, bundleId });
const game = "/Applications/League of Legends.app/Contents/LoL/Game/League of Legends.app/Contents/MacOS/League of Legends";
test("league match triggers", () => { expect(matchRules(rules, [P(1, game)], null).map((m) => m.ruleId)).toEqual(["lol"]); });
test("league client alone does not trigger", () => {
  expect(matchRules(rules, [P(2, "/Applications/League of Legends.app/Contents/LoL/LeagueClient.app/Contents/MacOS/LeagueClient"), P(3, "/Users/x/Applications/Riot Client.app/Contents/MacOS/Riot Client")], null)).toEqual([]);
});
test("call app needs active input", () => {
  const d = P(4, "/Applications/Discord.app/Contents/MacOS/Discord", "com.hnc.Discord");
  expect(matchRules(rules, [d], false)).toEqual([]);
  expect(matchRules(rules, [d], null)).toEqual([]);
  expect(matchRules(rules, [d], true).map((m) => m.ruleId)).toEqual(["discord"]);
});
test("key uses pid and start time", () => { expect(matchRules(rules, [P(1, game)], null)[0].key).toBe("lol:1:100"); });
test("bad preset version throws", () => { expect(() => loadPresets({ version: 2, rules: [] })).toThrow(); });
test("whole-application rule matches helper processes inside bundle", () => {
  const r = [{ id: "x", label: "X", kind: "game" as const, match: { bundlePrefix: "/Applications/Foo.app" }, enabled: true, verified: true }];
  expect(matchRules(r, [P(9, "/Applications/Foo.app/Contents/Helpers/Foo Helper.app/Contents/MacOS/Foo Helper")], null)).toHaveLength(1);
});
```

- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(domain): trigger matching with presets`.

---

### Task 6: Band advisor, notification policy, redaction (pure)

**Files:** Create `src/domain/band.ts`, `src/domain/notify-policy.ts`, `src/domain/redact.ts`, tests `tests/band.test.ts`, `tests/notify.test.ts`, `tests/redact.test.ts`

**Interfaces (Produces):**

```ts
// band.ts
export type BandHistory = Record<string /*gatewayId*/, { bands: ("2.4" | "5" | "6")[]; lastSeen: number }>;
export function gatewayId(mac: string | null, key: Uint8Array): string | null;  // HMAC-SHA256 hex, null if no mac
export function recordBand(h: BandHistory, id: string | null, band: "2.4" | "5" | "6" | null, now: number): BandHistory;
export function advise(h: BandHistory, id: string | null, band: "2.4" | "5" | "6" | null, quiet: boolean): { kind: "none" } | { kind: "previously-6"; current: "2.4" | "5" } | { kind: "info"; current: string };
// notify-policy.ts
export class NotifyPolicy { constructor(windowMs = 300_000); allow(kind: string, now: number): boolean }
// redact.ts
export function redact(text: string, ctx: { username: string; home: string; targets: string[]; gatewayIds: string[] }): string;
```

- [ ] **Step 1: failing tests**

```ts
// band.test.ts
import { expect, test } from "bun:test";
import { advise, recordBand, gatewayId } from "../src/domain/band";
const key = new Uint8Array(32).fill(7);
test("advises only when 6 GHz was previously observed on this gateway", () => {
  const id = gatewayId("0a:1b:2c:3d:4e:5f", key)!;
  let h = recordBand({}, id, "6", 1);
  expect(advise(h, id, "5", false)).toEqual({ kind: "previously-6", current: "5" });
  expect(advise(h, id, "5", true)).toEqual({ kind: "info", current: "5" });
  expect(advise({}, id, "5", false)).toEqual({ kind: "info", current: "5" });
  expect(advise(h, null, "5", false)).toEqual({ kind: "info", current: "5" });
});
test("gateway id is stable and does not contain the mac", () => {
  const a = gatewayId("0a:1b:2c:3d:4e:5f", key)!; expect(a).toBe(gatewayId("0A:1B:2C:3D:4E:5F", key)); expect(a).not.toContain("0a1b");
  expect(gatewayId(null, key)).toBeNull();
});
// notify.test.ts
import { NotifyPolicy } from "../src/domain/notify-policy";
test("rate limits per kind", () => { const p = new NotifyPolicy(); expect(p.allow("cut", 0)).toBe(true); expect(p.allow("cut", 299_999)).toBe(false); expect(p.allow("band", 1)).toBe(true); expect(p.allow("cut", 300_000)).toBe(true); });
// redact.test.ts
import { redact } from "../src/domain/redact";
test("redacts user, home, ipv4, ipv6, targets, gateway ids", () => {
  const out = redact("alex /Users/alex/x 192.168.1.1 fe80::1c2b:3aff:fe4d:5e6f 1.1.1.1 abcd1234", { username: "alex", home: "/Users/alex", targets: ["1.1.1.1"], gatewayIds: ["abcd1234"] });
  expect(out).toBe("<user> <home>/x <ipv4> <ipv6> <target> <gateway>");
});
```

- [ ] **Step 2:** FAIL. **Step 3:** implement (`gatewayId` uses `new Bun.CryptoHasher("sha256", key)` on lowercased MAC). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(domain): band advisor, notify policy, redaction`.

---

### Task 7: Log parsing and note correlation (pure, experimental)

**Files:** Create `src/domain/logparse.ts`, `src/domain/notes.ts`, `tests/fixtures/logs-macos27.txt`, `tests/notes.test.ts`

**Interfaces (Produces):**

```ts
export type WifiLogEvent = { ts: number; kind: "awdl-start" | "awdl-end" | "scan-start" | "scan-end" | "channel-change"; bands?: { g24: number; g5: number }; durationMs?: number };
export function parseLogLine(line: string, macosMajor: number): WifiLogEvent | null;   // compact style; unknown → null
export function noteFor(cut: { start: number; end: number }, events: WifiLogEvent[], windowMs = 500): { text: "scan-before" | "awdl-before" | "channel-change" | "none"; deltaMs?: number };
```

Fixture lines copied verbatim from the investigation (compact `log stream` format), e.g.:

```text
2026-09-23 19:13:38.592 Df wifip2pd[766:902f15] [com.apple.wifip2pd:interface] Infra scan started (2.4GHz: 1 5GHz: 0)
2026-09-23 19:13:38.765 Df wifip2pd[766:902266] [com.apple.wifip2pd:interface] Infra scan complete (duration: 173 milisegundos), status: 0)
2026-09-23 18:15:06.492 Df airportd[499:12c5] [com.apple.WiFiManager:] Info: <airport[499]> AWDL ended
2026-09-24 12:09:53.353 Df airportd[499:bf2bf3] [com.apple.WiFiManager:] Info: <airport[499]> AWDL started
2026-09-23 18:34:22.170 Df wifip2pd[766:1] [com.apple.wifip2pd:interface] Infra scan complete (duration: 4 segundos), status: 0)
```

Note the localized units ("milisegundos", "segundos"); parser accepts `ms|milliseconds|milisegundos` and `s|seconds|segundos|segundo`.

- [ ] **Step 1: failing tests**

```ts
import { expect, test } from "bun:test";
import { parseLogLine, noteFor } from "../src/domain/logparse";
const lines = (await Bun.file("tests/fixtures/logs-macos27.txt").text()).trim().split("\n");
test("parses scan start with bands and localized durations", () => {
  expect(parseLogLine(lines[0], 27)).toMatchObject({ kind: "scan-start", bands: { g24: 1, g5: 0 } });
  expect(parseLogLine(lines[1], 27)).toMatchObject({ kind: "scan-end", durationMs: 173 });
  expect(parseLogLine(lines[4], 27)).toMatchObject({ kind: "scan-end", durationMs: 4000 });
});
test("parses awdl start/end and ignores unknown", () => {
  expect(parseLogLine(lines[2], 27)?.kind).toBe("awdl-end");
  expect(parseLogLine(lines[3], 27)?.kind).toBe("awdl-start");
  expect(parseLogLine("garbage", 27)).toBeNull();
});
test("note is coincidence-worded and windowed", () => {
  const ev = [{ ts: 1000, kind: "scan-start" as const }];
  expect(noteFor({ start: 1080, end: 5000 }, ev)).toEqual({ text: "scan-before", deltaMs: 80 });
  expect(noteFor({ start: 3000, end: 5000 }, ev)).toEqual({ text: "none" });
});
```

(`noteFor` lives in `notes.ts` re-exported from `logparse.ts` for the test import.)
- [ ] **Step 2–4:** FAIL → implement → PASS. Add strings `note.scan-before` ("A Wi-Fi scan was logged {ms} ms before this cut" / "Se registró un escaneo Wi-Fi {ms} ms antes de este corte"), `note.awdl-before`, `note.channel-change`, `note.none`.
- [ ] **Step 5: Commit** `feat(domain): experimental unified-log parsing and notes`.

---

### Task 8: Quiet test and sessions (pure)

**Files:** Create `src/domain/quiettest.ts`, `src/domain/session.ts`, `tests/quiettest.test.ts`, `tests/session.test.ts`

**Interfaces (Produces):**

```ts
// quiettest.ts
export type QTPhase = "idle" | "arming-A" | "A" | "arming-B" | "B" | "done" | "invalid" | "cancelled";
export type QTState = { phase: QTPhase; block: 0 | 1 | 2 | 3; blockStart: number | null; results: { cond: "A" | "B"; sent: number; lost: number; spikes: number; p95: number | null; max: number | null }[]; reason?: string; baseline: { band: string | null; channel: number | null; router: string | null } | null };
export type QTInput =
  | { kind: "start"; now: number; activeLeases: number; inGrace: boolean; wifi: { band: string | null; channel: number | null; router: string | null } }
  | { kind: "awdl-observed"; up: boolean; now: number } | { kind: "hold-ack"; now: number } | { kind: "transition-failed"; reason: string }
  | { kind: "tick"; now: number; wifi: { band: string | null; channel: number | null; router: string | null } }
  | { kind: "block-stats"; stats: QTState["results"][number] } | { kind: "trigger-started" } | { kind: "cancel" };
export type QTEffect = { kind: "test-hold" } | { kind: "test-release" } | { kind: "hand-over-release" } | { kind: "collect-block"; cond: "A" | "B"; from: number; to: number } | { kind: "set-probe-interval"; ms: number };
export function qtReduce(s: QTState, i: QTInput, blockMs = 60_000): { state: QTState; effects: QTEffect[] };
export function verdict(s: QTState): { a: { sent: number; spikes: number }; b: { sent: number; spikes: number } } | null;
// session.ts
export type SessionSummary = { id: string; start: number; end: number; triggers: string[]; p50: number | null; p95: number | null; max: number | null; spikes: number; interruptions: number; lossPct: number; awdlReenables: number; notes: string[] };
export function summarize(input: { start: number; end: number; triggers: string[]; hist: import("./metrics").Histogram; max: number | null; spikes: number; interruptions: number; sent: number; lost: number; awdlReenables: number; notes: string[] }): SessionSummary;
```

Order: A (needs `awdl-observed up`), B (needs `hold-ack` and `awdl-observed down`), A, B. Refuse start if `activeLeases > 0 || inGrace` (`invalid`, reason `busy`). Wi-Fi change mid-test → `invalid` + `test-release`. `trigger-started` → `cancelled` + `hand-over-release` (controller adds trigger lease before releasing).

- [ ] **Step 1: failing tests** (`tests/quiettest.test.ts`)

```ts
import { expect, test } from "bun:test";
import { qtReduce, type QTState } from "../src/domain/quiettest";
const W = { band: "6", channel: 5, router: "r" };
const s0: QTState = { phase: "idle", block: 0, blockStart: null, results: [], baseline: null };
const step = (s: QTState, ...ins: any[]) => ins.reduce((a, i) => { const r = qtReduce(a.s, i, 1000); return { s: r.state, e: [...a.e, ...r.effects] }; }, { s, e: [] as any[] });
test("refuses when leases active or in grace", () => {
  expect(step(s0, { kind: "start", now: 0, activeLeases: 1, inGrace: false, wifi: W }).s).toMatchObject({ phase: "invalid", reason: "busy" });
  expect(step(s0, { kind: "start", now: 0, activeLeases: 0, inGrace: true, wifi: W }).s.phase).toBe("invalid");
});
test("A timing starts only after awdl observed up; B after hold ack and down", () => {
  const r = step(s0, { kind: "start", now: 0, activeLeases: 0, inGrace: false, wifi: W }, { kind: "tick", now: 500, wifi: W });
  expect(r.s.phase).toBe("arming-A");
  const r2 = step(r.s, { kind: "awdl-observed", up: true, now: 600 }, { kind: "tick", now: 1600, wifi: W });
  expect(r2.e).toContainEqual({ kind: "collect-block", cond: "A", from: 600, to: 1600 });
  expect(r2.e).toContainEqual({ kind: "test-hold" });
  const r3 = step(r2.s, { kind: "hold-ack", now: 1700 }, { kind: "awdl-observed", up: false, now: 1800 }, { kind: "tick", now: 2800, wifi: W });
  expect(r3.e).toContainEqual({ kind: "collect-block", cond: "B", from: 1800, to: 2800 });
});
test("wifi change invalidates and releases", () => {
  const r = step(s0, { kind: "start", now: 0, activeLeases: 0, inGrace: false, wifi: W }, { kind: "awdl-observed", up: true, now: 1 }, { kind: "tick", now: 2, wifi: { ...W, band: "5" } });
  expect(r.s.phase).toBe("invalid"); expect(r.e).toContainEqual({ kind: "test-release" });
});
test("trigger hands over without restore", () => {
  const r = step(s0, { kind: "start", now: 0, activeLeases: 0, inGrace: false, wifi: W }, { kind: "trigger-started" });
  expect(r.s.phase).toBe("cancelled"); expect(r.e).toContainEqual({ kind: "hand-over-release" }); expect(r.e).not.toContainEqual({ kind: "test-release" });
});
test("transition failure invalidates", () => {
  const r = step(s0, { kind: "start", now: 0, activeLeases: 0, inGrace: false, wifi: W }, { kind: "transition-failed", reason: "no-privilege" });
  expect(r.s).toMatchObject({ phase: "invalid", reason: "no-privilege" });
});
```

`tests/session.test.ts`: `summarize` with hist of `[3,3,3,90]`, sent 4, lost 1 → `p50: 3, p95: 100, lossPct: 25`.

- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(domain): quiet test state machine and session summaries`.

---

### Task 9: Swift helper — build script, JSON, Wi-Fi/router/power sensors

**Files:** Create `scripts/build-helper.ts`, `helper/main.swift`, `helper/Json.swift`, `helper/SensorWifi.swift`, `helper/SensorRouter.swift`, `helper/SensorPower.swift`

**Interfaces:**
- Consumes: `HelperEvent` JSON shapes from Task 2 (field names must match exactly).
- Produces: binary `build/helper/quietlink-helper` with modes `--sensor`, `--selftest` (later tasks add `--warden`, `--test-warden`).

- [ ] **Step 1: build script** `scripts/build-helper.ts`

```ts
import { mkdirSync } from "node:fs";
import { Glob } from "bun";
mkdirSync("build/helper", { recursive: true });
const files = [...new Glob("helper/*.swift").scanSync()].sort();
const args = ["swiftc", "-O", "-swift-version", "5", "-target", `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macos14.0`,
  "-framework", "AppKit", "-framework", "CoreWLAN", "-framework", "CoreAudio", "-framework", "SystemConfiguration",
  "-o", "build/helper/quietlink-helper", ...files];
const p = Bun.spawnSync(args, { stdout: "inherit", stderr: "inherit" });
if (p.exitCode !== 0) process.exit(p.exitCode ?? 1);
```

- [ ] **Step 2: `Json.swift`**: `func emit(_ dict: [String: Any])` adds `"v": 1`, `"ts": monotonicMs()` (from `clock_gettime_nsec_np(CLOCK_UPTIME_RAW)/1e6`), serializes with `JSONSerialization`, writes line to stdout under a lock and flushes. `func monotonicMs() -> Double`.

- [ ] **Step 3: `SensorWifi.swift`**: `func wifiSnapshot() -> [String: Any]` using `CWWiFiClient.shared().interface()`: `interfaceName`, `wlanChannel()?.channelNumber`, `channelBand` (`.band2GHz`→"2.4", `.band5GHz`→"5", `.band6GHz`→"6"), `channelWidth` (20/40/80/160; `.width320MHz` if available), `rssiValue()`, `noiseMeasurement()`, `transmitRate()`, `powerOn()`. Missing → `NSNull()`. Never call `scanForNetworks`. `startWifiSensor()` emits `wifi` every 5 s and on `CWEventDelegate` link/channel changes (`CWWiFiClient.shared().delegate`, `startMonitoringEvent(with: .linkDidChange / .modeDidChange / .powerDidChange)`; wrap in `try?`).

- [ ] **Step 4: `SensorRouter.swift`**: `func routerSnapshot(iface: String) -> (ipv4: String?, mac: String?)` via `SCDynamicStoreCreate`: find service whose `State:/Network/Service/<id>/IPv4` has `InterfaceName == iface`, read `Router`; parse `NetworkSignature` for `IPv4.RouterHardwareAddress=`; fallback MAC from `arp -n <router>` output (`/usr/sbin/arp`). Emit `router` on start and on `net-change`.

- [ ] **Step 5: `SensorPower.swift`**: `NSWorkspace.shared.notificationCenter` observers for `willSleepNotification` → `power will-sleep`, `didWakeNotification` → `power did-wake`; `SCDynamicStoreSetNotificationKeys` on `State:/Network/Global/IPv4` → `net-change`.

- [ ] **Step 6: `main.swift`**: parse `CommandLine.arguments`; `--sensor`: start sensors, heartbeat timer 1 s, read stdin lines on a background thread (commands `probe-start|probe-stop|snapshot`, dispatched to `Prober` from Task 10 — stub now: ignore unknown), exit when stdin closes; run `RunLoop.main.run()`. `--selftest`: take one wifi and router snapshot, assert types (fields present, band in allowed set or null), print `selftest ok` and exit 0, else print failure and exit 1.

- [ ] **Step 7:** `bun run build:helper && build/helper/quietlink-helper --selftest` → `selftest ok`. Run `build/helper/quietlink-helper --sensor` for 6 s (`(sleep 6; kill %1) & build/helper/quietlink-helper --sensor`) → heartbeat, wifi (band "6", channel 5), router (`192.168.1.1`, mac present) lines. Confirm no Wi-Fi scan in `log show --last 1m --predicate 'process == "wifip2pd" AND eventMessage CONTAINS "Infra scan"'` caused by the helper (there should be none at the helper's timestamps).
- [ ] **Step 8: Commit** `feat(helper): build script, JSON lines, Wi-Fi/router/power sensors`.

---

### Task 10: Swift helper — process, input-device sensors and ICMP prober

**Files:** Create `helper/SensorProcesses.swift`, `helper/SensorInput.swift`, `helper/Prober.swift`; Modify `helper/main.swift` (wire commands), `helper/main.swift --selftest` (assert prober)

- [ ] **Step 1: processes.** `listProcs() -> [[String: Any]]`: `proc_listallpids`, for each pid `proc_pidinfo(PROC_PIDTBSDINFO)` → `pbi_start_tvsec*1000 + pbi_start_tvusec/1000` as `start`, `proc_pidpath` → `path` (skip on failure), `NSRunningApplication(processIdentifier:)?.bundleIdentifier` for `bundleId`. Emit `procs` every 2 s. `NSWorkspace.didLaunchApplicationNotification` / `didTerminateApplicationNotification` → `proc-launch`/`proc-exit` with the same fields.
- [ ] **Step 2: input devices.** Enumerate `kAudioHardwarePropertyDevices`; input-capable = `kAudioDevicePropertyStreams` scope input count > 0; `active` = any device with `kAudioDevicePropertyDeviceIsRunningSomewhere == 1`. Add property listeners on each device and on `kAudioHardwarePropertyDevices`/`kAudioHardwarePropertyDefaultInputDevice` (re-enumerate and re-register, removing old listeners). Emit `input-active` on change and every 5 s; errors → `active: null`.
- [ ] **Step 3: prober.** `final class Prober` per target: `socket(AF_INET, SOCK_DGRAM, IPPROTO_ICMP)`, `setsockopt(IPPROTO_IP, IP_BOUND_IF, if_nametoindex(iface))`; identifier = random `UInt16` per prober instance; timer at `intervalMs` sends echo (type 8, checksum), emits `probe-sent` after `sendto` succeeds, else `probe-send-failed`. Receive loop (`DispatchSource.makeReadSource`) parses IP header length `(buf[0] & 0x0f) * 4`, requires source address == target, type 0, identifier and seq known; within deadline → `probe-result reply rttMs`; deadline timer per probe → `probe-result lost`; reply after `lost` → `probe-late`; ICMP type 3 → `probe-result error`. Other processes' replies are ignored (verified cross-delivery).
- [ ] **Step 4: selftest** extends: start a prober to the router for 1.5 s at 0.5 s, assert ≥ 2 `probe-sent` and each has a terminal result; assert process list contains the helper's own pid with non-empty path; assert input sensor returns Bool or null.
- [ ] **Step 5:** `bun run build:helper && build/helper/quietlink-helper --selftest` → `selftest ok`. Manual: `printf '{"v":1,"cmd":"probe-start","target":"192.168.1.1","iface":"en0","intervalMs":500}\n' | (cat; sleep 3) | build/helper/quietlink-helper --sensor | grep probe` shows sent/result pairs with RTTs of a few ms.
- [ ] **Step 6: Commit** `feat(helper): process, input-device sensors and ICMP prober`.

---

### Task 11: Swift warden (single executor, leases, durable state, recovery)

**Files:** Create `helper/WardenCore.swift`, `helper/WardenExecutor.swift`, `helper/WardenState.swift`, `helper/WardenServer.swift`, `helper/Tests.swift`; Modify `helper/main.swift` (`--warden`, `--test-warden`)

**Interfaces:**
- Consumes: `WardenRequest`/`WardenResponse` JSON (Task 2), socket path `~/Library/Application Support/Quietlink/warden.sock`, state path `.../warden-state.json`.
- Produces: `WardenCore` (pure struct) with `mutating func handle(_ req: Request, now: Double, awdlUp: Bool?) -> (Response, [Command])`, `mutating func tick(now: Double, awdlUp: Bool?) -> [Command]`, `mutating func startup(state: Persisted, bootId: String, now: Double) -> [Command]`; `enum Command { case down, up, wifiOff(String), wifiOn(String), persist }`.

Core rules (spec §4.2): `hold` → new token = ++epoch, `leaseUntil = now + ttl`; if `awdlUp == true` → `tookDown = true`, `persist`, `down`; if already down → `tookDown` unchanged false. `renew(token)` with current token and `now <= leaseUntil` → extend; otherwise `lease-expired` (no commands). `tick`: if holding and `now > leaseUntil` → invalidate token, `up` if `tookDown`, clear, `persist`; if holding and `awdlUp == true` → `down` (reconcile). `release(token)` current → `up` if `tookDown`. `restore-now` → invalidate token, `up` if `tookDown`. During `recovering` `hold`/`reconnect-wifi` → `recovering` error; `ping`/`status` answered. `startup`: different boot → clear AWDL record, keep `pendingWifiOn`; same boot and `tookDown` → `up`; `pendingWifiOn` → `wifiOn`; then `recovering = true` until convergence ends (driven by server).

- [ ] **Step 1: failing tests in `Tests.swift`** (`--test-warden` runs them; each `check(cond, name)` prints `FAIL name` and sets exit 1)

```swift
func runWardenTests() -> Int32 {
  var failed = false
  func check(_ c: Bool, _ name: String) { if !c { print("FAIL \(name)"); failed = true } else { print("ok \(name)") } }
  var w = WardenCore(); _ = w.finishRecovery()
  var (r, cmds) = w.handle(.hold(id: 1, ttlMs: 4000), now: 0, awdlUp: true)
  check(r.ok && r.token == 1 && cmds == [.persist, .down], "hold takes down and persists first")
  (r, cmds) = w.handle(.renew(id: 2, token: 1), now: 3000, awdlUp: false); check(r.ok && cmds.isEmpty, "renew extends")
  check(w.tick(now: 7001, awdlUp: false) == [.up, .persist], "expiry restores when tookDown")
  (r, cmds) = w.handle(.renew(id: 3, token: 1), now: 7002, awdlUp: true)
  check(!r.ok && r.error == "lease-expired" && cmds.isEmpty, "stale token rejected before execution")
  var w2 = WardenCore(); _ = w2.finishRecovery()
  (r, cmds) = w2.handle(.hold(id: 1, ttlMs: 4000), now: 0, awdlUp: false)
  check(cmds == [], "already down: no down, tookDown false")
  check(w2.tick(now: 5000, awdlUp: false) == [.persist], "already down: expiry never brings up")
  var w3 = WardenCore(); _ = w3.finishRecovery(); _ = w3.handle(.hold(id: 1, ttlMs: 4000), now: 0, awdlUp: true)
  check(w3.tick(now: 1000, awdlUp: true) == [.down], "reconcile re-applies down when macOS re-enables")
  var w4 = WardenCore()
  let c4 = w4.startup(state: .init(bootId: "B", tookDown: true, pendingWifiOn: nil), bootId: "B", now: 0)
  check(c4 == [.up, .persist], "restores on start when tookDown and no lease")
  (r, _) = w4.handle(.hold(id: 9, ttlMs: 4000), now: 1, awdlUp: true); check(r.error == "recovering", "hold rejected while recovering")
  (r, _) = w4.handle(.ping(id: 10), now: 1, awdlUp: true); check(r.ok, "ping answered while recovering")
  var w5 = WardenCore()
  let c5 = w5.startup(state: .init(bootId: "OLD", tookDown: true, pendingWifiOn: "en0"), bootId: "NEW", now: 0)
  check(c5 == [.wifiOn("en0"), .persist], "new boot drops AWDL record but keeps wifi restore")
  var w6 = WardenCore(); _ = w6.finishRecovery(); _ = w6.handle(.hold(id: 1, ttlMs: 4000), now: 0, awdlUp: true)
  (r, cmds) = w6.handle(.release(id: 2, token: 1), now: 10, awdlUp: false); check(cmds == [.up, .persist], "release restores")
  (r, cmds) = w6.handle(.reconnectWifi(id: 3, iface: "en0"), now: 20, awdlUp: true)
  check(cmds == [.persist, .wifiOff("en0")], "reconnect persists pending before off")
  return failed ? 1 : 0
}
```

- [ ] **Step 2:** `bun run build:helper && build/helper/quietlink-helper --test-warden` → compile error / FAIL.
- [ ] **Step 3: implement `WardenCore.swift`** (pure; `Equatable` commands; `Persisted { bootId, tookDown, pendingWifiOn: String? }`; after `wifiOff` the server schedules `wifiOn` after 3 s and a `persist` clearing `pendingWifiOn` once power is observed on).
- [ ] **Step 4: implement `WardenState.swift`**: write JSON to `warden-state.json.tmp`, `fsync`, `rename`; read with defaults; boot id from `sysctlbyname("kern.bootsessionuuid")`.
- [ ] **Step 5: implement `WardenExecutor.swift`**: `admission = NSLock()`; `run(_ argv: [String]) -> Bool`: lock → if `fenced` unlock+return false → `posix_spawn` → register pid → unlock → `waitpid` with 2 s timeout (poll `WNOHANG` every 20 ms; on timeout `kill(pid, SIGTERM)` on the `sudo` process, reap) → unregister. Commands: `["/usr/bin/sudo","-n","/sbin/ifconfig","awdl0","down"|"up"]`, `["/usr/sbin/networksetup","-setairportpower",iface,"off"|"on"]`. `awdlUp()` via `getifaddrs` + `IFF_UP` flag for `awdl0` (no spawn). `fence(timeout:)` for the watchdog.
- [ ] **Step 6: implement `WardenServer.swift`**: acquire `flock` on `warden.lock` (exit 0 if held); create socket dir `0700`, socket `0600`; accept loop on a dispatch queue; each request → `core.handle` → execute commands serially on the main serial queue (persist first when listed); 1 s tick timer → `core.tick`; `up` failure → retry with backoff 1,2,5,10 then 30 s; watchdog queue checks `lastProgress` every 1 s, >3 s → `executor.fence(timeout: 1)`, wait ≤3 s for registered child, `exit(2)`; `SIGTERM` via `DispatchSource.makeSignalSource` → execute `up` if `tookDown`, `wifiOn` if pending, persist, exit 0; startup barrier: loop until `proc_listallpids` + `proc_name` shows no `ifconfig`/`networksetup` (unknown on error), max 10 s, then run `core.startup` commands, then convergence 5 s at 0.5 s re-applying `up`/`wifiOn` if state regressed, then `core.finishRecovery()`.
- [ ] **Step 7:** `--test-warden` → all `ok`, exit 0.
- [ ] **Step 8: Commit** `feat(helper): warden single executor with leases and recovery`.

---

### Task 12: Privilege and LaunchAgents adapters

**Files:** Create `src/adapters/paths.ts`, `src/adapters/privilege.ts`, `src/adapters/launch-agents.ts`, `tests/privilege.test.ts`, `tests/launch-agents.test.ts`

**Interfaces (Produces):**

```ts
// paths.ts
export const appSupport: string;             // ~/Library/Application Support/Quietlink (created 0700; throws if owner/mode wrong)
export const wardenSock: string; export const cliSock: string; export const dbPath: string; export const settingsPath: string; export const keyPath: string;
export function helperBinary(): string;      // bundle Resources path, or build/helper/quietlink-helper in dev
// privilege.ts
export function validUsername(u: string): boolean;
export function sudoersContent(user: string): string;
export function installScript(user: string): string;   // bash script run as root via osascript
export function uninstallScript(user: string): string;
export async function install(): Promise<{ ok: boolean; error?: string }>;
export async function uninstall(): Promise<{ ok: boolean; error?: string }>;
export async function hasPrivilege(): Promise<boolean>;  // sudo -n -l contains both commands
// launch-agents.ts
export function wardenPlist(helperPath: string): string;
export function loginPlist(appPath: string): string;
export async function installAgent(label: string, plist: string): Promise<void>;   // write ~/Library/LaunchAgents/<label>.plist, launchctl bootstrap gui/<uid>
export async function removeAgent(label: string): Promise<void>;                   // launchctl bootout, rm
```

- [ ] **Step 1: failing tests**

```ts
import { expect, test } from "bun:test";
import { validUsername, sudoersContent, installScript } from "../src/adapters/privilege";
import { wardenPlist } from "../src/adapters/launch-agents";
test("sudoers content is exactly two literal commands", () => {
  expect(sudoersContent("alex")).toBe("alex ALL=(root) NOPASSWD: /sbin/ifconfig awdl0 down, /sbin/ifconfig awdl0 up\n");
});
test("username validation", () => {
  expect(validUsername("alex")).toBe(true);
  for (const bad of ["", "a b", "x;rm", "-x", "ALL", "a\n", "$(id)"]) expect(validUsername(bad)).toBe(false);
});
test("install script is constant except username and validates before and after", () => {
  const s = installScript("alex");
  expect(s).toContain("/usr/sbin/visudo -cf");
  expect(s).toContain("/usr/sbin/visudo -c ");
  expect(s).toContain("/etc/sudoers.d/quietlink-alex");
  expect(s).toContain("chmod 0440");
  expect(s).toContain("[ -L");                 // symlink refusal
  expect(installScript("bob").replaceAll("bob", "alex")).toBe(s);
  expect(() => installScript("x;y")).toThrow();
});
test("warden plist keeps alive and runs --warden", () => {
  const p = wardenPlist("/Applications/Quietlink.app/Contents/Resources/app/helper/quietlink-helper");
  expect(p).toContain("<string>dev.quietlink.warden</string>");
  expect(p).toContain("<string>--warden</string>");
  expect(p).toContain("<key>KeepAlive</key><true/>");
});
```

- [ ] **Step 2:** FAIL.
- [ ] **Step 3: implement.** `installScript(user)`:

```bash
set -eu
umask 077
USER_NAME='<user>'
TARGET="/etc/sudoers.d/quietlink-${USER_NAME}"
grep -Eq '^[#@]includedir /private/etc/sudoers.d' /etc/sudoers || { echo "sudoers.d not included" >&2; exit 3; }
[ -L "$TARGET" ] && { echo "refusing symlink" >&2; exit 4; }
if [ -e "$TARGET" ] && ! grep -q '/sbin/ifconfig awdl0 down, /sbin/ifconfig awdl0 up' "$TARGET"; then echo "foreign file" >&2; exit 5; fi
DIR=$(/usr/bin/mktemp -d /private/var/root/quietlink.XXXXXX)
TMP="$DIR/rule"
printf '%s ALL=(root) NOPASSWD: /sbin/ifconfig awdl0 down, /sbin/ifconfig awdl0 up\n' "$USER_NAME" > "$TMP"
/usr/sbin/visudo -cf "$TMP"
[ -e "$TARGET" ] && cp -p "$TARGET" "$DIR/backup"
chown root:wheel "$TMP"; chmod 0440 "$TMP"
mv -f "$TMP" "$TARGET"
if ! /usr/sbin/visudo -c >/dev/null; then
  if [ -e "$DIR/backup" ]; then mv -f "$DIR/backup" "$TARGET"; else rm -f "$TARGET"; fi
  rm -rf "$DIR"; exit 6
fi
rm -rf "$DIR"
```

`install()` runs `osascript -e 'do shell script "<escaped script>" with administrator privileges'` via `Bun.spawn` argv (script escaped for AppleScript string: backslashes and quotes), user from `os.userInfo({}).username` checked against `process.getuid()` via `id -un`. `uninstall()` = `rm -f` of only that target then `visudo -c`. `hasPrivilege()` = `sudo -n -l` stdout contains both command strings.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(adapters): privilege install/uninstall and LaunchAgents`.

---

### Task 13: Helper and warden clients

**Files:** Create `src/adapters/helper-client.ts`, `src/adapters/warden-client.ts`, `tests/helper-client.test.ts`, `tests/warden-client.test.ts`

**Interfaces (Produces):**

```ts
export class HelperClient {
  constructor(opts: { spawn?: (argv: string[]) => ChildLike; now?: () => number; hungMs?: number });
  start(): void; stop(): void;
  on(fn: (e: HelperEvent) => void): () => void;
  onRestart(fn: () => void): () => void;
  send(cmd: HelperCommand): void;
  lastEventAt(): number;
}
export type ChildLike = { stdout: AsyncIterable<Uint8Array>; stdin: { write(s: string): void }; kill(sig?: number): void; exited: Promise<number>; pid: number };
export class WardenClient {
  constructor(opts: { connect?: (path: string) => Promise<Duplex>; now?: () => number });
  request(req: Omit<WardenRequest, "id" | "v">, timeoutMs?: number): Promise<WardenResponse>;
  superviseTick(now: number, wardenPid: () => Promise<number | null>): Promise<"ok" | "killed" | "unreachable">;  // ping; if no answer 3 s → SIGKILL pid
}
```

- [ ] **Step 1: failing tests** with fake child: split JSON lines across chunks → events parsed in order; malformed line ignored; `v !== 1` ignored; no heartbeat 3 s → child killed and restarted with backoff (fake clock), `onRestart` called; `WardenClient.superviseTick` with a connection that never answers → after 3 s calls `process.kill(pid, 9)` (inject `kill` fn) and returns `"killed"`.
- [ ] **Step 2–4:** FAIL → implement (line buffer on `\n`; `Bun.connect({ unix })` for warden; restart backoff `[500, 1000, 2000, 5000]`) → PASS.
- [ ] **Step 5: Commit** `feat(adapters): helper and warden clients with supervision`.

---

### Task 14: Stores, instance lock, log stream

**Files:** Create `src/adapters/settings-store.ts`, `src/adapters/telemetry-store.ts`, `src/adapters/instance-lock.ts`, `src/adapters/log-stream.ts`, `tests/stores.test.ts`

**Interfaces (Produces):**

```ts
export type Settings = { lang: "en" | "es"; graceMs: number; externalTarget: string | null; extraTargets: string[]; showPingInMenuBar: boolean; rules: TriggerRule[]; inputTrigger: boolean; explainCuts: boolean; launchAtLogin: boolean; paused: boolean; bandHistory: BandHistory };
export class SettingsStore { constructor(path: string); get(): Settings; update(p: Partial<Settings>): Settings }  // atomic write, defaults merged, presets merged by id
export class TelemetryStore {
  constructor(path: string);
  addSecond(row: { ts: number; target: string; count: number; sum: number; min: number; max: number; lost: number; late: number }): void;  // batched, flush every 5 s
  addEvent(e: { ts: number; kind: string; data: object }): void;
  addSession(s: SessionSummary, hist: number[]): void;
  seconds(target: string, since: number): Row[]; events(since: number): Row[]; sessions(limit: number): SessionSummary[];
  prune(now: number): void;   // seconds/events 24 h, sessions 30 d
  clearAll(): void;           // delete all + PRAGMA wal_checkpoint(TRUNCATE) + VACUUM
}
export function acquireInstanceLock(path: string): { release(): void } | null;   // Bun FFI flock(fd, LOCK_EX|LOCK_NB) from libc.dylib
export class LogStream { start(onEvent: (e: WifiLogEvent) => void): void; stop(): void }  // spawns `/usr/bin/log stream --style compact --predicate '(process == "airportd" OR process == "wifip2pd") AND (eventMessage CONTAINS "AWDL" OR eventMessage CONTAINS "Infra scan")'`
```

- [ ] **Step 1: failing tests**: settings defaults merge and atomic rewrite; telemetry prune removes rows older than 24 h but keeps 29-day sessions and removes 31-day sessions; `clearAll` leaves tables empty and `-wal` file size 0 after checkpoint; instance lock: second acquire in same process on a new fd returns null (FFI `flock` from `libc.dylib`), release allows re-acquire.
- [ ] **Step 2–4:** FAIL → implement (`bun:sqlite` with `PRAGMA journal_mode=WAL`) → PASS.
- [ ] **Step 5: Commit** `feat(adapters): settings, telemetry, instance lock, log stream`.

---

### Task 15: App controller (wiring) with fault-injection tests

**Files:** Create `src/app/controller.ts`, `tests/controller.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–14.
- Produces:

```ts
export type AppView = { phase: Phase; because: string[]; paused: boolean; privilege: boolean; wardenHealthy: boolean; wifi: HelperEvent & { type: "wifi" } | null; router: string | null; ping: { gw: number | null; ext: number | null }; lossPct: number | null; jitter: number | null; interruptionsLastHour: number; advice: ReturnType<typeof advise>; test: QTState; lastEvents: { ts: number; text: string }[]; sessions: SessionSummary[] };
export class Controller {
  constructor(deps: { helper: HelperClient; warden: WardenClient; settings: SettingsStore; telemetry: TelemetryStore; notify: (title: string, body: string) => void; now: () => number; logStream?: LogStream });
  start(): Promise<void>; stop(): Promise<void>;                 // stop: release lease, stop helper
  view(): AppView; onChange(fn: (v: AppView) => void): () => void;
  manual(on: boolean, durationMs?: number): void; emergency(): void; reenable(): void; airdropBreak(ms?: number): void;
  pause(): void; resume(): void; startQuietTest(): void; cancelQuietTest(): void; reconnectWifi(): Promise<{ ok: boolean; error?: string }>;
}
```

Behavior: helper `procs`/`input-active` → `matchRules` → reconcile `LeaseSet` (add/remove by key) → `reduce(leases-changed)`; 1 s tick → `reduce(tick)`, `LeaseSet.expireUnknown(now, helper.lastEventAt(), 30_000)`, warden `superviseTick`; effects → warden requests (`hold` → `hold-ok`/`hold-failed`; `renew` error `lease-expired` → input `lease-expired`; `release` → `released`); probes: on `router` event `probe-start` gw (interval by phase), ext if configured; interval switches when phase changes; `power will-sleep` → `ledger.onPause` start + `reduce(sleep)`; `did-wake` → `reduce(wake)`; interruptions during active phase → notification via `NotifyPolicy`; session start/end on phase transitions into `active` and into `inactive` → `summarize` → `telemetry.addSession`; band history updated on each `wifi` event (only when not quiet); `explainCuts` toggles `LogStream`; `launchAtLogin` changes install/remove the `dev.quietlink.login` agent; warden status changes notify on `privilege` lost and on `restored-by-warden` (warden reports it in `status.lastError`); when the `wifi` event has `iface: null` or the router is unavailable (Ethernet, VPN-only, IPv6-only), probes stop and the view shows the state instead of Wi-Fi metrics.

- [ ] **Step 1: failing tests** (fakes for helper, warden, stores, clock):
  1. game process appears → `hold` sent; warden answers token → `renew` each tick.
  2. warden `renew` → `lease-expired` → controller rebuilds leases from last `procs` and sends a new `hold` only if the game is still present.
  3. helper silent 31 s → game lease expires → `release` sent.
  4. `emergency()` while a manual lease is active → `restore-now` sent, no further `hold` until `reenable()`.
  5. `will-sleep` → `release`; `did-wake` → leases rebuilt from next `procs` snapshot.
  6. quiet test started while game running → refused with reason busy in `view().test`.
  7. `reconnectWifi()` during active phase → `{ ok: false, error: "quiet-active" }`, no warden request.
  8. interruption during session → exactly one notification within 5 min for two interruptions.
  9. `wifi` event with `iface: null` → probes stopped (`probe-stop` sent) and `view().wifi` null.
  10. settings `launchAtLogin: true` → `installAgent("dev.quietlink.login", …)` called once.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(app): controller wiring with fault-injection tests`.

---

### Task 16: Main process, tray, windows, RPC

**Files:** Modify `src/main/index.ts`, `src/main/tray.ts`, `src/main/windows.ts`; Create `src/main/rpc-api.ts`, `src/views/popover/bridge-entry.ts`, `src/views/settings/bridge-entry.ts`

- [ ] **Step 1:** `index.ts`: `acquireInstanceLock(appSupport + "/instance.lock")` or exit after activating nothing (second instance just exits; the running one keeps its tray); build deps; if warden agent missing but privilege present → `installAgent(warden)`; `controller.start()`; tray; RPC; `before-quit` → `controller.stop()` then `Utils.quit()`.
- [ ] **Step 2:** `tray.ts`: icon by phase (`quiet` when active/grace/activating, `warn` when fault/suppressed/!privilege/!wardenHealthy, else `idle`); title = gw ping when `showPingInMenuBar`; native menu (right side): status line (disabled item "Quiet because: X" / "Quiet mode off"), Quiet now ▸ (Until turned off, 30 min, 1 h, 2 h), Allow AirDrop for 2 min (only when active), Restore AirDrop now, Pause/Resume automation, Open dashboard, Settings…, Quit. Left-click on icon opens popover (from Task 1 spike decision).
- [ ] **Step 3:** `rpc-api.ts`: `invoke({method,args})` dispatch table limited to: `view`, `manual`, `emergency`, `reenable`, `airdropBreak`, `pause`, `resume`, `startQuietTest`, `cancelQuietTest`, `reconnectWifi`, `getSettings`, `updateSettings`, `installPrivilege`, `uninstallPrivilege`, `listRunningApps`, `exportDiagnostics`, `clearData`, `installCli`; view pushes via RPC message `view-changed` on `controller.onChange` (throttled to 4/s).
- [ ] **Step 4:** `bun run build && bun run start`; verify tray icon states by toggling "Quiet now" (warden not installed yet → warn icon + "privilege missing").
- [ ] **Step 5: Commit** `feat(main): tray, windows and RPC wiring`.

---

### Task 17: Svelte views — popover and settings

**Files:** Create `src/views/popover/{index.html,main.ts,App.svelte,Sparkline.svelte}`, `src/views/settings/{index.html,main.ts,App.svelte,sections/Triggers.svelte,sections/Monitor.svelte,sections/Privileges.svelte,sections/Data.svelte,sections/About.svelte}`, `src/views/shared/{bridge.ts,style.css}`

- [ ] **Step 1: popover** (340×460): header (state pill "Quiet · League of Legends" / "Off"; toggle; "Restore AirDrop"), live row (router ms, external ms, jitter, loss %), sparkline of last 5 min router RTT (SVG path; losses as red ticks), Wi-Fi row (band · channel · width · RSSI · PHY rate, "—" for missing), band advice card with Reconnect (confirm dialog text from strings; disabled with reason while quiet), last events list (interruptions with optional notes), Quiet test button + result card ("A: 77 spikes in 600 probes · B: 0 in 600"), footer (Settings, Quit). Uses `$state`/`$derived` runes; subscribes to `view-changed`.
- [ ] **Step 2: settings**: Triggers (preset list with verified badge, enable toggles, "Add app…" picker from `listRunningApps` with "this executable" vs "whole application", input-device heuristic toggle with warning text, grace slider 0–60 s), Monitor (external target field with third-party note, extra hops, menu-bar ping toggle, Explain cuts (experimental) toggle), Privileges (status, install/uninstall buttons, plain explanation incl. "any process running as you can run these two commands"), Data (retention text, Clear data, Export diagnostics with "include identifiers" checkbox, Install CLI), About (version, support statement, license, language selector).
- [ ] **Step 3:** CSP as clipboardai (`default-src 'self'`), follow macOS appearance (`prefers-color-scheme`), keyboard focus visible, all controls labeled.
- [ ] **Step 4:** Build, open both windows, click every control once; every button must perform its function or be disabled with a visible reason (no placeholders).
- [ ] **Step 5: Commit** `feat(views): popover dashboard and settings`.

---

### Task 18: Diagnostics export and CLI

**Files:** Create `src/app/export.ts`, `src/app/cli-server.ts`, `bin/quietlink`, `tests/export.test.ts`, `tests/cli.test.ts`

- [ ] **Step 1: failing tests**: export Markdown contains sections Status, Wi-Fi, Last 24 h, Sessions, Events and is redacted by default (uses Task 6 `redact`); with `includeIdentifiers` the router IP appears. CLI server: request `{"cmd":"status"}` over a temp socket → JSON with `phase`; `on`/`off`/`pause`/`resume`/`test` call controller methods; unknown → error; socket file mode `0600`; server refuses to start if dir mode ≠ `0700`.
- [ ] **Step 2–4:** FAIL → implement → PASS. `bin/quietlink`: `#!/usr/bin/env bun`, connects to `cliSock`, prints human-readable status; exit 1 if app not running.
- [ ] **Step 5: Commit** `feat: diagnostics export and CLI`.

---

### Task 19: Icon design

**Files:** Create `icons/app-icon.svg`, `icons/tray-idle.svg`, `icons/tray-quiet.svg`, `icons/tray-warn.svg`, `scripts/prepare-icons.ts`

- [ ] **Step 1:** App icon SVG 1024×1024: macOS squircle (continuous corner radius ~22.5%), vertical gradient `#0B1E3A → #0E6E78`, subtle top highlight; centered white Wi-Fi glyph (3 arcs + dot, stroke 64 px, round caps); a crescent ("hush") in `#9FF3E6` overlapping the outer arc's right end, masking it so the outer arc fades into the crescent.
- [ ] **Step 2:** Tray templates 18×18 pt, black on transparent: idle = outlined arcs; quiet = filled arcs + small crescent; warn = arcs with a gap in the middle arc + dot.
- [ ] **Step 3:** `prepare-icons.ts`: render SVG → PNG with `qlmanage -t -s 1024 -o build/ icons/app-icon.svg` (fallback `sips` from a PNG exported by `rsvg-convert` if installed), then `sips -z` to the iconset sizes (16…512 @1x/@2x) into `build/icon.iconset`; tray PNGs at 18 and 36 px into `build/tray/*.png` and `*@2x.png`.
- [ ] **Step 4:** Build; view icons in Finder/menu bar (light and dark menu bar) and a 16 px rendering; adjust stroke if the glyph blurs at 16 px.
- [ ] **Step 5: Commit** `feat: app and tray icons`.

---

### Task 20: Docs and CI

**Files:** Create `README.md`, `CONTRIBUTING.md`, `.github/workflows/ci.yml`

- [ ] **Step 1: README**: problem + evidence table (from spec §1), what Quietlink does, screenshots (added after Task 21), how it works (warden, leases, probes), privileges (exact sudoers line, per-user caveat, uninstall), privacy (what is stored, retention, no telemetry, external probe target), build from source (`bun install`, `bunx electrobun prepare`, `bun run build`, `bun run start`; requires Xcode CLT), support statement (verified macOS 27/Apple Silicon only), limitations (AWDL reduction not elimination; notes are coincidences), uninstall steps (quit, Settings → Uninstall privileges, remove app-support dir, LaunchAgents).
- [ ] **Step 2: CONTRIBUTING**: layout, `bun test`, `bun run test:helper`, rules (domain pure; no scans; no causal wording; update fixtures per macOS version; verify presets before `verified: true`).
- [ ] **Step 3: CI** (`macos-latest`): checkout, setup Bun 1.4.2, `bun install`, `bun run check`, `bun test`, `bun run test:helper` (warden tests run; `--selftest` skipped on CI via `QUIETLINK_CI=1` because runners lack Wi-Fi).
- [ ] **Step 4: Commit** `docs: README, CONTRIBUTING, CI`.

---

### Task 21: Integration verification on the owner's Mac

**Files:** Create `scripts/verify-mac.ts`, `docs/verification.md`

- [ ] **Step 1:** Install privilege from Settings (owner types password once). Check `sudo -n -l` shows both commands and `ls -l /etc/sudoers.d/quietlink-alex` is `-r--r----- root wheel`.
- [ ] **Step 2: scripted checks** (`bun scripts/verify-mac.ts`, each prints PASS/FAIL with evidence, non-zero exit on failure):
  1. Manual quiet on → `ifconfig awdl0` down within 2 s; open AirDrop in Finder → comes back down within ~1 s; manual off after grace → up.
  2. `kill -9` app → `awdl0` up within 6 s.
  3. `kill -STOP` app 8 s then `-CONT` → awdl0 restored during stop; after resume no `down` until the app requests a new hold.
  4. `kill -STOP` warden → app SIGKILLs it within ~4 s, launchd restarts it, awdl0 up.
  5. `kill -9` warden and app together → up within 15 s.
  6. Reconnect Wi-Fi, `kill -9` warden right after `off` → Wi-Fi power back on within 15 s.
  7. Second app launch exits immediately; one tray icon.
  8. Quiet test end-to-end → results for A and B recorded; repeat 3× and save numbers.
- [ ] **Step 3: manual checks** recorded in `docs/verification.md`: LoL match start/end (verify exact executable path, flip `verified: true`), LoL client only (no quiet), Zoom meeting (`CptHost` path verified), Discord with mic, muted mic, music playback only, AirPods/USB headset, browser Meet call, sleep/wake mid-session, Ethernet/VPN transitions, AirDrop transfer after restore, reconnect timeout path (turn Wi-Fi hardware off), light/dark mode, second display.
- [ ] **Step 4: budget**: `top -l 5 -stats pid,command,cpu,mem,idlew` for app, helper, warden idle and active; record in README.
- [ ] **Step 5: Commit** `test: integration verification on macOS 27` (+ presets verified flags, README numbers, screenshots).

---

## Execution

Owner instruction: delegate reviews to Codex, not Claude subagents. Execute natively (inline) task by task; after Tasks 8, 11, 15 and 21 run a Codex review (`gpt-6-astra`, diff embedded, read-only, sentinel `OK TO MERGE` / `NO GO`) and fix findings before continuing.
