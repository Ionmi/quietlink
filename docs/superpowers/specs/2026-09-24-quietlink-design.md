# Quietlink — v1 design

Date: 2026-09-24. Status: draft for owner review.
Design inputs: owner requirements, a live investigation on the owner's Mac (below), and an independent design review by Codex (gpt-5.6-sol).

## 1. Problem and evidence

Macs on Wi-Fi get latency spikes and short cuts that only hurt real-time traffic (games, video calls). Measured on an M-series Mac, macOS 27, Wi-Fi 7 mesh (MLO SSID on 2.4/5/6 GHz):

| Finding | Evidence | Fix that worked |
| --- | --- | --- |
| AWDL (`awdl0`, AirDrop/AirPlay/Handoff) pulls the radio off-channel every ~3.6 s | 600 pings to gateway: 77 spikes of 30–95 ms; with `awdl0` down: 0 spikes, max 17.6 ms | `sudo ifconfig awdl0 down`, re-applied every second because macOS brings it back |
| Multi-second cuts (1–4 s, all hops) while on 5 GHz | 9 cuts in 1 h, each at a firmware 2.4 GHz single-channel "Infra scan" (every ~3 min) whose radio return was delayed | Rejoining Wi-Fi landed on 6 GHz/160 MHz: 0 cuts in 16 h, same scans still running |
| Polling Wi-Fi with `system_profiler` causes cuts | It forces a live scan | Never scan from the app |

Constraints learned: the owner uses AirDrop, so AWDL must only be off while playing/calling. Everything the app needs is available unprivileged except `ifconfig awdl0 down|up`.

## 2. Goals and non-goals

Goals (v1):
1. Automatic "quiet mode" (AWDL off) while a configured game or call is running, restored afterwards.
2. Live, honest network monitoring that tells the user where a cut happened (Wi-Fi hop vs Internet).
3. Wi-Fi inspection with a band advisor that would have caught the owner's 5 GHz problem.
4. Open source, buildable from source by anyone with Bun + Xcode Command Line Tools.

Non-goals (v1), with reason:
- Fullscreen-app trigger: unreliable detection, high false-positive cost.
- Scanning for networks (any `scanForNetworks`/`system_profiler`): the scan itself causes the problem.
- Asserting causes ("caused by firmware"): timestamps show coincidence, not causation.
- Auto-update and downloadable binaries: not before Developer ID signing + notarization; the app installs a sudoers rule, so an unsigned update channel is an attack path.
- Router configuration: every router differs.

## 3. Stack

Electrobun 2 (Hutch devkit) + Bun 1.4 main process + Svelte 5 + TypeScript + Vite, mirroring the owner's `clipboardai` project layout and tray patterns. One small Swift helper built with `swiftc` (no Xcode project). SQLite via `bun:sqlite`. macOS 14+, Apple Silicon and Intel. License MIT.

## 4. Features

### 4.1 Quiet mode
- Turns `awdl0` down and keeps it down with a 1 s reconcile loop: read the interface's administrative state, re-apply `down` only when it is up. Back off and surface an error after repeated failures.
- Ownership: records whether `awdl0` was up before Quietlink took over and restores only what Quietlink changed.
- Crash safety: an ownership marker file is written before the first `down`; on next launch, if the marker exists and no quiet session is running, `awdl0` is brought up and the user is told. This is next-launch recovery, not crash-time recovery, and the UI says so.
- Emergency control: menu item "Restore AirDrop now" brings `awdl0` up and pauses all automation until re-enabled.
- Sleep/wake: on sleep, end the reconcile loop; on wake, re-evaluate triggers from scratch.

### 4.2 Triggers (leases)
Every reason to be quiet is a lease with an ID. Quiet mode is on while at least one lease is active, plus a grace period (default 10 s) after the last one ends, so relaunches and loading screens don't flap.

| Trigger | Detection | Default |
| --- | --- | --- |
| Manual | Menu toggle / CLI | — |
| Games | Swift helper: `NSWorkspace` launch/terminate for responsiveness + `libproc` snapshot every 2 s as source of truth; match by executable path or bundle ID, never by truncated `ps` names or command lines | Presets on |
| Call apps | Same matching; presets: zoom.us meeting process, FaceTime, Microsoft Teams, Discord, Webex, Slack huddles | Presets on |
| Microphone in use | Swift helper: CoreAudio `kAudioDevicePropertyDeviceIsRunningSomewhere` on input devices; covers browser calls (Meet, etc.) | Opt-in |

Presets are a versioned JSON file shipped with the app. League of Legends matches the in-match game executable (`League of Legends.app/Contents/MacOS/League of Legends`) and explicitly excludes Riot Client, `LeagueClient` and `LeagueClientUx`, so AirDrop keeps working in the lobby. Exact paths are verified with the game installed before release. Users can add any running app from a picker (no typing paths).

"Pause automation" suppresses all automatic leases until resumed; manual still works.

### 4.3 Network monitor
- One long-lived `/sbin/ping -n -i <interval>` per target with `LC_ALL=C`, parsed incrementally, restarted on exit. No per-sample spawning, no raw ICMP sockets.
- Targets: auto-detected default gateway (from `route -n get default`, refreshed on network change), `1.1.1.1`, plus optional extra hops (e.g. mesh nodes).
- Interval: 0.5 s during quiet mode, 2 s otherwise (battery/CPU budget).
- Metrics: current RTT, p50/p95, jitter, loss %, spikes (>100 ms), cuts (≥2 consecutive losses). Classification: gateway failing means local/Wi-Fi trouble; Internet-only failure is labeled "Internet/ISP", never "Wi-Fi".
- Menu-bar title optionally shows live gateway ping (e.g. `4 ms`).
- Storage: SQLite (WAL), samples aggregated per second, events kept 24 h, sessions kept 30 days; batched inserts.

### 4.4 Wi-Fi inspector and band advisor
- Swift helper reads CoreWLAN current-association data only (never scans): band, channel, width, RSSI, noise, PHY rate, and BSSID/SSID when Location permission allows.
- Roam history: BSSID/channel changes with timestamps.
- Band advisor (learned, not scanned): Quietlink remembers the best band it has seen for the current network (a hash of SSID, not the name). If the Mac is now on 2.4/5 GHz but has been on 6 GHz on this network before, it shows "You were on 6 GHz on this network before; reconnecting may restore it" with a Reconnect button (`networksetup -setairportpower <if> off/on`, ~2 s). Never offered or run during a quiet session. With no history it only says "Connected on 5 GHz"; it never claims 6 GHz is available.

### 4.5 Event correlation (experimental, labeled so)
- The Bun main process runs `log stream` with narrow predicates (`airportd`, `wifip2pd`) and versioned parsers with fixtures per macOS version; unknown lines are ignored, not guessed.
- Normalized events only: AWDL started/ended, infra scan start/end (+ duration, bands), roam, link down/up. Raw log lines are never stored.
- Each spike/cut gets a confidence-worded note: "Wi-Fi scan observed within 80 ms of this cut", "Likely roam-related", or "Cause unknown".

### 4.6 Sessions and reports
A session is one quiet-mode period (or a manual "record" in monitor-only mode). Stored summary: duration, trigger, RTT p50/p95/max, spikes, cuts, loss, correlated events. Shown in the popover history and as a notification when a session ends with problems.

### 4.7 Notifications (rate-limited: max 1 per kind per 5 min)
Cut detected during a session; macOS re-enabled AWDL repeatedly (informational); connected on a worse band than before; privilege missing.

### 4.8 Other
- Launch at login: `SMAppService.mainApp` registered by the Swift helper.
- Diagnostics export: Markdown report, redacted by default (no username, home paths, SSID, BSSID, public IP); a checkbox includes them.
- CLI: `quietlink on|off|status|pause|resume` over a Unix socket in `~/Library/Application Support/Quietlink/` (dir `0700`, socket `0600`, peer UID checked). The CLI is a small Bun script installed on request.
- Languages: English and Spanish from day one via a flat string dictionary (small app; no framework).

## 5. Privilege model

Root surface: exactly two argument vectors, no shell, no daemon.

```sudoers
<user> ALL=(root) NOPASSWD: /sbin/ifconfig awdl0 down, /sbin/ifconfig awdl0 up
```

Install (one password prompt, via `osascript … with administrator privileges`, script constant except the username, which must match `^[A-Za-z_][A-Za-z0-9_-]*$`):
1. Write fixed content to a root-owned temp file.
2. `/usr/sbin/visudo -cf <temp>`.
3. Atomically move to `/etc/sudoers.d/quietlink`, `root:wheel`, `0440`.
4. `/usr/sbin/visudo -c` for the full config; on failure delete the new file.

Uninstall removes only `/etc/sudoers.d/quietlink`, then validates. Runtime calls `sudo -n /sbin/ifconfig awdl0 down|up` with an argv array. Upgrade path: replace with a signed `SMAppService` daemon + authenticated XPC exposing one boolean, when the project gets Developer ID signing.

## 6. Architecture

```text
Swift helper (unprivileged, long-lived, JSON Lines over stdout; commands on stdin)
  ├─ process launch/exit + libproc snapshots
  ├─ microphone in use
  ├─ Wi-Fi association (CoreWLAN, no scans)
  ├─ sleep/wake, network change
  └─ login item

Bun main process
  sensors/        HelperClient, PingRunner, LogStreamReader, AwdlProbe
  domain/         TriggerMatcher, ModeReducer (pure), Correlator (pure), BandAdvisor (pure), Metrics (pure)
  effects/        AwdlController (sudo -n), WifiReconnect, Privilege (install/uninstall)
  store/          Settings (JSON), Telemetry (SQLite)
  ui/             Tray (icon/title/native menu), Popover window, Settings window, Notifications
  cli/            Unix socket server
Svelte views      popover (status, sparkline, last events), settings (triggers, monitor, privileges, about)
```

Mode reducer (pure, fake clock in tests):

```text
inactive → activating → active → grace → restoring → inactive
                 ↘──────── fault (surface, retry with backoff) ─┘
```

Inputs: lease start/end, pause/resume, emergency restore, sleep/wake, AWDL probe results, controller success/failure. Outputs: effects to run. All side effects live in `effects/`; everything in `domain/` is pure and unit-tested.

Helper protocol: every JSON line has `v` (protocol version), `type`, `ts`. The main process restarts the helper with backoff if it exits and treats missing data as "unknown", never as "not running".

## 7. Security and privacy

- Root surface as in §5; no writable privileged scripts; no interface name from input.
- Stored locally only. Never stored: raw command lines, raw unified-log lines, audio, packet contents, passwords. SSID is stored only as a salted hash for the band advisor; process names only for configured triggers.
- Exports redacted by default. No telemetry, no network calls other than pings to the configured targets.

## 8. Icon

Concept: a Wi-Fi arc glyph with a small "hush" crescent that fades the outer arc — "the link, quieted". App icon: rounded-square macOS style, deep navy to teal gradient, white glyph. Tray: monochrome template icons for three states — idle (outline arcs), quiet mode on (filled arcs + crescent), warning (arcs with a small gap/dot). Delivered as SVG sources + generated `.icns` and @1x/@2x PNGs.

## 9. Testing

- Unit (`bun test`, fakes for clock/helper/ping/sudo): mode reducer transitions, overlapping leases, grace timers, pause/emergency, crash-marker recovery decisions, trigger matching (LoL game vs client), ping parser, log parsers against fixtures, correlator windows, band advisor, metrics, sudoers content/username validation, export redaction.
- Swift helper: small self-check mode (`--selftest`) that prints one sample of each sensor.
- Manual on the owner's Mac: sudoers install/uninstall, AWDL down/up + re-enable by AirDrop, LoL match start/end, Zoom call, sleep/wake, reconnect button, crash (kill -9) recovery.
- Budget check: idle CPU < 1% and RSS recorded in the README.

## 10. Repository

`~/Development/Quietlink`, git from the start, README (problem, evidence, how it works, build from source, privilege explanation, uninstall), CONTRIBUTING, MIT LICENSE, GitHub Actions (typecheck + unit tests + helper build on macos runner). Publishing to GitHub requires explicit owner confirmation.

## 11. Risks

1. macOS changes AWDL, CoreWLAN or unified-log behavior → versioned parsers, fixtures, "unknown" states, graceful degradation.
2. Users lose Continuity features and blame the network → clear status, emergency restore, only-while-triggered default.
3. Correlation overclaims → confidence wording, "experimental" label.
4. sudoers rule as attack surface → exact argv, validation, uninstall, no binaries until signed.
5. Wrong trigger matches (mic heuristic, presets) → opt-in mic, path/bundle matching, visible "active because: X".
