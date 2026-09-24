# Quietlink — v1 design

Date: 2026-09-24. Status: draft for owner review (rev 7).
Design inputs: owner requirements, a live investigation on the owner's Mac (below), a design review by Codex (gpt-5.6-sol) and a spec review by Codex Astra (gpt-6-astra). Revs 2–7 apply every required change from six Astra review passes.

## 1. Problem and evidence

Macs on Wi-Fi get latency spikes and short cuts that only hurt real-time traffic (games, video calls). Measured on an M-series Mac, macOS 27, Wi-Fi 7 mesh (MLO SSID on 2.4/5/6 GHz):

| Finding | Evidence | What helped |
| --- | --- | --- |
| AWDL (`awdl0`, AirDrop/AirPlay/Handoff) pulls the radio off-channel every ~3.6 s | 600 pings to gateway: 77 spikes of 30–95 ms; with `awdl0` down: 0 spikes, max 17.6 ms | `sudo ifconfig awdl0 down`, re-applied every second because macOS brings it back |
| Multi-second cuts (1–4 s) while associated on 5 GHz | 9 cuts in 1 h, each coinciding with a firmware 2.4 GHz single-channel scan whose radio return was delayed | After a Wi-Fi off/on the Mac associated on 6 GHz/160 MHz: 0 cuts in 16 h, same scans still running (band change and fresh association not separated) |
| Polling Wi-Fi with `system_profiler` causes cuts | It forces a live scan | Never scan from the app |

Constraints: the owner uses AirDrop, so AWDL must only be off while playing/calling. Everything the app needs is available unprivileged except `ifconfig awdl0 down|up`.

## 2. Goals and non-goals

Goals (v1):
1. Automatic quiet mode (AWDL held down) while a configured game or call is active, reliably restored afterwards — including after crashes.
2. Honest network monitoring that says which probe failed and when, without overclaiming causes.
3. Wi-Fi inspection plus a band advisor based on what this Mac has actually seen before.
4. A built-in "Quiet test" that measures whether quiet mode helps on the user's own network.
5. Open source, buildable from source with Bun + Xcode Command Line Tools.

Non-goals (v1), with reason:
- Fullscreen-app trigger: unreliable detection, high false-positive cost.
- Any Wi-Fi scanning (`scanForNetworks`, `system_profiler`): the scan itself causes the problem.
- Asserting causes: timestamps show coincidence, not causation.
- Auto-update and downloadable binaries: not before Developer ID signing + notarization (the app installs a sudoers rule).
- Router configuration; DNS/HTTPS diagnostics (later).

Support statement: targets macOS 14+ on Apple Silicon and Intel; v1 is verified only on macOS 27 / Apple Silicon (owner's Mac). The README says so until other configurations are tested.

## 3. Stack

Electrobun 2 (Hutch devkit) + Bun 1.4 main process + Svelte 5 + TypeScript + Vite, mirroring the owner's `clipboardai` project layout and tray patterns. One Swift helper binary built with `swiftc` (no Xcode project). SQLite via `bun:sqlite`. License MIT.

## 4. Features

### 4.1 Quiet mode
- Holds `awdl0` down with a 1 s reconcile loop run by the **warden** (§4.2): read the administrative state (`ifconfig awdl0` flags), re-apply `down` only when it is up. The UI states honestly that this reduces AWDL time; macOS can still use it for up to ~1 s between checks.
- Repeated failures back off (1, 2, 5, 10 s) and surface a fault; never spin.
- Emergency "Restore AirDrop now": brings `awdl0` up and suppresses all leases (manual, grace, retries) until the user explicitly re-enables quiet mode.
- AirDrop break: "Allow AirDrop for 2 min" during a session, then quiet resumes automatically.
- Timed quiet: manual quiet for 30 min / 1 h / 2 h / until turned off.
- Restoration is defined for: last lease + grace ends, quit, emergency, uninstall of privileges (restore first, then remove the rule), helper loss for longer than its unknown-state bound, app crash or hang (lease expiry, §4.2), warden fault, logout, and sleep. After wake the state is re-read and triggers re-evaluated from scratch.

### 4.2 Warden: single executor and crash recovery
The app never runs `ifconfig` itself. One process owns every AWDL and Wi-Fi power command: the **warden**, the Swift helper binary run as a user LaunchAgent (`KeepAlive`, `ProcessType=Interactive`), installed together with the privilege rule. A single executor removes cross-process races by construction.

- Dead-man lease with warden-issued tokens: the app requests `hold(ttl=4 s)`; the warden answers with a fresh lease token (monotonic epoch it generates). Renewals every 1 s must present the current token. Expiry, release or restore invalidates the token; any later renewal carrying it is rejected with `lease-expired`, so a resumed stale app cannot silently continue. On `lease-expired` the app drops to `inactive`, rebuilds its leases from a fresh sensor snapshot, and only then may request a new hold. All commands execute serially and the token is checked before each command.
- Guarantee (narrowed): while the warden is running, an app crash, hang or suspension restores `awdl0` within ≈5 s (ttl + one tick + command latency). - Command lifecycle contract:
  - Admission: one mutex covers {check fence → spawn → register child PID}. Nothing else holds it, so it is never held across a wait.
  - Every command runs with a 2 s timeout; the warden waits for (reaps) the `sudo` child. It cannot signal the root-owned `ifconfig` grandchild, and does not need to: `ifconfig`/`networksetup` are bounded by the barrier below.
  - Hang watchdog (separate dispatch queue, 3 s without main-loop progress): acquire the admission mutex (1 s timeout), set the fence (no new spawns can be admitted after this point), release, wait up to 3 s for any registered child to exit, then exit with an error. It never runs `up` itself.
  - Start-up barrier for every new warden (after a crash, watchdog exit, `SIGKILL` or login): before restoring anything it waits until no process named `ifconfig` or `networksetup` is visible. Matching is conservative by process name (libproc `proc_name`), because an unprivileged process generally cannot read a root process's full argv; any inspection failure counts as "unknown" and keeps waiting. Timeout 10 s, then it proceeds and reports. It then restores per the durable state and runs a convergence check: re-reads `awdl0` and Wi-Fi power every 0.5 s for 5 s and re-applies the restore if a late orphaned command changed it. The recovery intent stays in memory for the whole convergence window, even after the first successful restore clears the durable record.
  - During recovery (barrier + convergence, ≤15 s) the warden answers liveness pings normally but rejects `hold` and reconnect requests with `recovering`; the app shows "restoring…" and retries after recovery. So app supervision never kills a recovering warden and convergence never undoes a newly accepted session.
  - A suspended warden (e.g. `SIGSTOP`) cannot run its own watchdog, so the app supervises it from outside: if the warden stops answering pings for 3 s, the app sends it `SIGKILL` (same user); launchd restarts it and the start-up barrier applies.
  - All restart paths are best-effort, typically ≤15 s, and succeed only if `up` succeeds; failures are retried and reported.
- Commands: each has a 2 s timeout; a failed `up` is retried with backoff (1, 2, 5, 10 s, then every 30 s) and reported until it succeeds.
- Durable state: before any change the warden persists `warden-state.json` (fsync + atomic rename) with two independent records:
  - AWDL: boot session UUID (`sysctl kern.bootsessionuuid`), `tookDown` (true only if `awdl0` was up and the warden brought it down). **Single rule:** the warden restores `up` if and only if `tookDown` is true; if `awdl0` was already down when a hold began, `tookDown` stays false and the warden never brings it up. On start: same boot and `tookDown` with no live lease → restore `up`; different boot → clear the AWDL record (it is up after boot).
  - Wi-Fi power: `pendingWifiOn` (set before `networksetup … off`, cleared after `on` is confirmed). Kept across reboots; on start, if set and Wi-Fi power is off, the warden turns it on.
- Logout/termination: on SIGTERM the warden restores AWDL (and Wi-Fi power if it turned it off) before exiting.
- Activation requires a healthy warden (answering pings on its socket and holding a valid sudo rule). If the warden is unhealthy the app shows a fault and does not pretend quiet mode is on.
- Single app instance: an OS-held `flock` on `~/Library/Application Support/Quietlink/instance.lock`, acquired before anything else; a second launch focuses the running instance and exits. The warden also holds its own lock.
- Interface state cannot prove exclusive ownership (another tool may also want AWDL down); per the single rule above the warden restores only what it changed and tells the user when `awdl0` was already down before a hold.
- Warden ↔ app transport: Unix socket in the app-support dir (`0700` dir owned by the user, `0600` socket), newline-delimited JSON with protocol version.

### 4.3 Triggers (leases)
Every reason to be quiet is a lease. Quiet mode is on while ≥1 lease is active, plus a grace period (default 10 s) after the last ends, so relaunches and loading screens don't flap. All deadlines use a monotonic clock.

| Trigger | Detection | Default |
| --- | --- | --- |
| Manual / timed | Menu, CLI | — |
| Games | Helper: `NSWorkspace` launch/terminate for responsiveness + `libproc` snapshot every 2 s as source of truth. Processes identified by PID **and start time**; matched by executable path or bundle ID; exited/inaccessible processes handled | Presets on |
| Zoom meeting | Zoom's in-meeting process (`CptHost`), verified before release | On |
| Other call apps (FaceTime, Teams, Discord, Slack, Webex) | App running **and** any input device active. Labeled as a heuristic: the microphone may be in use by a different app, and duplex devices can report activity during playback, so false triggers are possible | Off; one-click enable |
| Microphone active (any app, e.g. browser calls) | Helper: CoreAudio `kAudioDevicePropertyDeviceIsRunningSomewhere` on input-capable devices; listeners re-registered on device add/remove/default change; aggregate and duplex devices handled | Opt-in, labeled as a heuristic ("an input device is running") |

- Presets are a versioned JSON file shipped with the app. League of Legends matches the in-match executable (`League of Legends.app/Contents/MacOS/League of Legends`) and excludes Riot Client, `LeagueClient`, `LeagueClientUx`, so AirDrop works in the lobby. Every preset path is verified with the real app before release; unverified presets are not shipped.
- App picker offers two choices: "this executable only" or "the whole application (any process inside its bundle)".
- Unknown state: if the helper stops reporting, leases from it stay valid for at most 30 s, then end (quiet mode restores). Unknown never means "still running" indefinitely.
- "Pause automation" suppresses automatic leases until resumed; manual still works.

### 4.4 Network monitor
- Probes are sent by the Swift helper itself using an unprivileged ICMP datagram socket (`SOCK_DGRAM`, `IPPROTO_ICMP`, allowed for normal users on macOS) bound to the Wi-Fi interface with `IP_BOUND_IF`. Verified on macOS 27: the socket works unprivileged, replies include the IP header, and the socket also receives other processes' echo replies (a reply from `1.1.1.1` arrived for a probe sent to the router), so the helper matches replies strictly by source address, identifier and sequence. For every probe the helper emits `probe-sent {target, id, seq, t}` immediately after a successful send, then exactly one terminal `probe-result {reply(rtt) | lost | error(kind)}`, where `lost` is emitted when the 1 s deadline passes and is immutable. A reply arriving after its deadline produces a separate non-terminal `probe-late {seq, rtt}` observation: the probe stays counted as lost for loss %, and late replies are counted and shown separately ("3 late replies"); sends that fail locally emit `probe-send-failed` and are not counted as sent. If the helper dies or restarts, all outstanding probes become `unknown` and are excluded from loss. Accounting never depends on parsing `ping` output. If the socket cannot be opened, the monitor falls back to `/sbin/ping -n -b <if>` with `Request timeout` lines and marks its data "approximate".
- Targets: the Wi-Fi interface's configured IPv4 router read from SystemConfiguration (`State:/Network/Service/<id>/IPv4` → `Router`, which covers DHCP and static setups; not the global default route, which may be a VPN tunnel); shown as unavailable when unresolved, an external host (`1.1.1.1`, configurable or disable-able; the UI explains that continuous probes contact that third party), plus optional extra hops (e.g. mesh nodes).
- Accounting per sent probe: identifier + sequence, send time, deadline (1 s). A probe is finalized as lost only once its deadline has expired; replies after the deadline stay losses and are recorded as late observations; duplicates ignored; sequence wrap and helper restarts handled; ICMP errors (unreachable) recorded as failures. Sleep and monitor downtime are excluded.
- Metrics: RTT per reply; jitter = mean absolute difference of consecutive RTTs; loss = lost / (sent probes whose deadline has passed) within window, shown as provisional for the most recent second; spike = RTT > 100 ms; **interruption = ≥2 consecutive probes lost after their deadlines**. Its reported duration is the observed gap between the last reply before and the first reply after, shown with the sampling resolution ("≈1.5 s, ±0.5 s"); at the 2 s idle interval short interruptions can be missed, and the UI says so.
- Labels: "Router probe failed" and "External probe failed", with interface/route context. Routers may rate-limit ICMP; if the router probe fails while the external probe keeps answering, it is shown as "router didn't answer ICMP", not a cut.
- Interval: 0.5 s during quiet mode, 2 s otherwise. Wi-Fi only: on Ethernet, VPN-only or no Wi-Fi the monitor shows the state and pauses Wi-Fi-specific features. IPv6-only networks: shown as unsupported in v1.
- Menu-bar title optionally shows live router ping (e.g. `4 ms`).
- Storage (SQLite, WAL): per-second aggregates (count, sum, min, max, loss) 24 h; events 24 h; session histograms (fixed log-scale buckets) so session percentiles are exact to bucket resolution; sessions 30 d. "Clear data" deletes everything and checkpoints/vacuums the WAL.

### 4.5 Wi-Fi inspector and band advisor
- The helper reads CoreWLAN current-association data only (never scans): band, channel, width, RSSI, noise, reported PHY transmit rate (labeled as such, not throughput). Verified today without Location permission. Each field may be unavailable and is shown as "—", never 0.
- Location permission is **not** requested in v1; SSID/BSSID are not needed.
- Gateway identifier (provisional): HMAC-SHA256 (random local key) of the router's MAC from SystemConfiguration's `NetworkSignature` (`IPv4.RouterHardwareAddress`, verified present), falling back to the ARP table. It is not a guaranteed network identity (MACs can be missing, change, or be shared across SSIDs); when unavailable, history matching is skipped. Documented as such.
- Channel/band changes with timestamps (BSSID, and therefore true roams, are not visible without Location).
- Band advisor: remembers bands this Mac has actually associated on per network. If now on 2.4/5 GHz but previously associated on 6 GHz here: "You've connected on 6 GHz on this network before. Reconnecting may bring it back." Never says 6 GHz is available or better. MLO/Wi-Fi 7 links are shown as the single channel CoreWLAN reports.
- Reconnect: explicit confirmation ("drops Wi-Fi for a few seconds"), never during quiet mode. Executed by the warden, which first persists "Wi-Fi turned off by Quietlink" so it turns Wi-Fi back on after its own crash or at next start, then runs `networksetup -setairportpower <if> off`, waits, `on`. The feature is enabled only after a startup check confirms `networksetup` works unprivileged for this account (verified on the owner's Mac; gated otherwise). The app shows progress states (turning off → turning on → associated on X GHz / timed out after 20 s with a "turn Wi-Fi on" recovery action). No promise about the resulting band.

### 4.6 Quiet test
Built-in A/B measurement: equal 60 s blocks of router probes at 0.2 s, baseline (A) and quiet mode (B), alternating A-B-A-B. Reports per condition: probes, spikes, p95, max, loss — worded as observations ("A: 77 spikes in 600 probes; B: 0 spikes in 600 probes"), never as proof of cause.

Condition boundaries:
- Entry requires no active quiet leases and no grace period; otherwise the test is refused with the reason.
- The test uses its own lease directly with the warden (no grace between blocks). A block's timing starts only after the warden confirms the target state: `awdl0` observed up for A, `hold` acknowledged and `awdl0` observed down for B. A failed or timed-out transition invalidates the test.
- The test is invalidated if the band, channel or router changes mid-test.
- If a trigger starts during the test: the trigger's lease is added first, then the test lease is released, so quiet mode continues without an intermediate restore; the test is marked cancelled.
- On user cancel or failure the test lease is released and AWDL is restored by the usual warden path.
- The user is asked not to use AirDrop during the test.

### 4.7 Event notes (experimental, off by default)
- Toggle "Explain cuts (experimental)". When on, the main process runs `log stream` with narrow predicates (`airportd`, `wifip2pd`) and versioned parsers with fixtures per macOS version. Missing or unknown lines are ignored; the feature degrades to nothing, silently.
- Normalized events only (AWDL start/end, scan start/end with bands, channel change); raw lines never stored. Durations only from matched start/end pairs. Event times come from the log entry timestamps.
- Wording: "A Wi-Fi scan was logged 80 ms before this cut" or "No logged Wi-Fi event near this cut". Never "caused by".

### 4.8 Sessions and reports
A session is one quiet-mode period (or a manual "record" in monitor-only mode). Summary: duration, triggers, RTT p50/p95/max from histograms, spikes, cuts, loss, AWDL re-enable count, notes (if enabled). Shown in the popover history; a notification at session end only if there were cuts.

### 4.9 Notifications (max 1 per kind per 5 min)
Interruption during a session; privilege missing or revoked; warden restored AirDrop after the app stopped renewing; now on a different band than previously observed on this gateway (informational).

### 4.10 Other
- Launch at login: a user LaunchAgent plist for the app (same mechanism as the warden), toggled in Settings. No `SMAppService` in v1.
- Diagnostics export: Markdown, redacted by default (username, home paths, IPv4/IPv6 addresses, configured targets, network identifiers, process paths outside presets); a checkbox includes them.
- CLI `quietlink on|off|status|pause|resume|test`: Unix socket in the app-support dir (dir `0700` owned by the user, socket `0600`; only the same user and root can connect, so no peer check is needed; the app refuses to start the server if the directory's owner or mode is wrong). Installed on request as a symlink in `~/.local/bin`.
- Languages: English and Spanish via a flat string dictionary.

## 5. Privilege model

Root surface: exactly two argument vectors, no shell at runtime, no daemon. **Every process running as this user can run these two commands**; the Settings screen and README say so plainly.

```sudoers
<user> ALL=(root) NOPASSWD: /sbin/ifconfig awdl0 down, /sbin/ifconfig awdl0 up
```

Install (one macOS password prompt via `osascript … with administrator privileges`):
- The username is derived from the current UID (`getpwuid(getuid())`), validated against `^[A-Za-z_][A-Za-z0-9_-]*$`. It is the only variable in a constant script; all paths absolute; quoting fixed.
- The privileged script: verifies `/etc/sudoers` includes `/private/etc/sudoers.d`; creates the temp file with `mktemp` inside a root-owned `0700` directory; writes fixed content; `visudo -cf temp`; refuses if the target exists as a symlink or is not a previous Quietlink file; backs up any previous Quietlink file; installs atomically as `/etc/sudoers.d/quietlink-<user>` (per-user name, never overwriting another user's), `root:wheel`, `0440`; runs `visudo -c`; on any failure restores the backup or removes the new file.
- Runtime: `sudo -n /sbin/ifconfig awdl0 down|up` with an argv array; a revoked or missing rule is detected (`sudo -n -l`) and surfaced.
- Uninstall: the warden restores AWDL and exits, its LaunchAgent is removed, then remove only `/etc/sudoers.d/quietlink-<user>` and validate.
- Upgrade path (post-signing): signed `SMAppService` daemon + authenticated XPC exposing one boolean.

## 6. Architecture

```text
Swift binary `quietlink-helper`, two modes
  sensor mode (spawned by the app; JSON Lines on stdout, commands on stdin, heartbeat 1 s)
    process launch/exit + libproc snapshots, input-device activity, Wi-Fi association,
    SystemConfiguration router lookup, ICMP probes, sleep/wake, network change, router MAC
  warden mode (LaunchAgent, KeepAlive; Unix socket)
    sole executor of `sudo -n ifconfig awdl0 down|up` and `networksetup` power cycling,
    dead-man leases, reconcile loop, durable state, restore on expiry/SIGTERM/restart

Bun main process
  sensors/   HelperClient, PingRunner, LogStreamReader, AwdlProbe
  domain/    TriggerMatcher, LeaseSet, ModeReducer, PingAccounting, Metrics, BandAdvisor, NoteCorrelator   (pure)
  effects/   WardenClient (lease renewals, commands), Privilege (install/uninstall), LaunchAgents
  store/     Settings (JSON), Telemetry (SQLite)
  ui/        Tray (icon/title/native menu), Popover window, Settings window, Notifications
  cli/       Unix socket server
Svelte views popover (status, sparkline, last events, session history), settings (triggers, monitor, privileges, data, about)
```

Mode reducer (pure; fake monotonic clock in tests):

```text
inactive → activating → active ⇄ airdrop-break → grace → restoring → inactive
      any → fault (backoff) → restoring
      any → emergency-suppressed (until explicit re-enable)
```

- Inputs: lease start/end, timers, pause/resume, emergency, AirDrop break, sleep/wake, AWDL probe results, effect completions. Outputs: effect requests.
- The app side only decides; the warden executes. Requests carry the reducer's generation; the warden refuses stale generations before executing, so a resumed stale app cannot re-apply an old decision. Entering `restoring` stops lease renewal and sends an explicit `release(generation)`; if that message is lost, lease expiry gives the same result.
- Helper protocol: every JSON line has `v`, `type`, monotonic `ts`. The app restarts the sensor helper with backoff; a hung helper (no heartbeat 3 s) is killed and restarted. launchd restarts the warden.

## 7. Security and privacy
- Root surface as in §5. Within Quietlink the warden is the sole executor of the two commands; outside Quietlink, any process running as this user can also run them (see §5). No writable privileged scripts; no interface name from input.
- Local only; no telemetry; the only network traffic is ICMP to configured targets.
- Never stored: raw command lines, raw unified-log lines, audio, packet contents, passwords, SSIDs/BSSIDs.
- Retention: per-second samples and events 24 h, sessions 30 d, settings until deleted; "Clear data" removes all and compacts SQLite + WAL; uninstall instructions remove the app-support directory, LaunchAgents and sudoers file.
- Exports redacted by default (§4.10).

## 8. Icon

Concept: a Wi-Fi arc glyph with a small "hush" crescent softening the outer arc — "the link, quieted". App icon: rounded-square macOS style, deep navy → teal gradient, white glyph. Tray: monochrome template icons for three states — idle (outline arcs), quiet (filled arcs + crescent), warning (arcs with a gap). SVG sources + generated `.icns` and @1x/@2x PNGs.

## 9. Testing
- Unit (`bun test`, fakes for clock/helper/ping/sudo/filesystem): reducer transitions and overlapping leases; grace, AirDrop break, timed quiet; emergency suppression of manual/grace/retries; stale-generation completions; **fault injection** — delayed and reordered effects, helper hang/restart, sleep during activating/restoring, revoked sudo, external AWDL up/down, crash points before/after each ownership write; warden decisions (lease tokens, expiry, stale token refused before execution, late renewal after expiry, `tookDown` rule including AWDL already down, boot mismatch, `pendingWifiOn` across reboot, admission mutex vs fence race, liveness during recovery with `recovering` rejections, hang watchdog (fence, wait for child, exit without `up`), start-up barrier and convergence re-apply after a late orphaned `down`, app-side SIGKILL of an unresponsive warden, SIGTERM, command timeout and `up` retry); probe accounting (sent/result pairing, immutable deadline loss plus late observations, unknown after helper restart, provisional window); Quiet test boundaries (entry refusal, confirmed transitions, invalidation, trigger hand-over without restore); ping accounting (late, duplicate, wrap, restart, unreachable, sleep gaps); cut/jitter/histogram math; LoL game vs client matching; band advisor; log parsers against fixtures; sudoers content + username validation; export redaction.
- Helper: `--selftest` asserts each sensor returns a well-formed sample or a declared "unavailable" and exits non-zero otherwise.
- Integration on the owner's Mac (packaged app, scripted where possible): concurrent launches; kill -9 of the app, SIGSTOP/SIGCONT of the app, SIGSTOP of the warden (app kills it, launchd restarts it), kill -9 of the warden, of both → AWDL restored (≈5 s while the warden runs; best-effort ≤15 s via launchd restart) and no re-down from the resumed stale app; kill of the warden between Wi-Fi off and on → Wi-Fi back on; sudoers install/uninstall/revoke; sleep/wake mid-session; Ethernet and VPN transitions; mic trigger with muted mic, output-only playback, USB and Bluetooth headsets, browser call; LoL match start/end; Zoom meeting; real AirDrop transfer after restore; reconnect flow including timeout.
- Effectiveness: Quiet test run ≥3 times with results in the README.
- Budget: idle and active CPU, wakeups and energy (`top -stats`, `powermetrics` if available) for app, helper and ping children; numbers in the README.

## 10. Repository
`~/Development/Quietlink`, git from the start, README (problem, evidence, how it works, build from source, privilege explanation including the per-user caveat, uninstall), CONTRIBUTING, MIT LICENSE, GitHub Actions (typecheck + unit tests + helper build on a macOS runner). Publishing to GitHub requires explicit owner confirmation.

## 11. Risks
1. macOS changes AWDL, CoreWLAN or unified-log behavior → versioned parsers, fixtures, "unavailable" states, graceful degradation.
2. Users lose Continuity features and blame the network → visible status, AirDrop break, emergency restore, trigger-only default, warden dead-man lease.
3. Notes overclaim → off by default, coincidence wording.
4. sudoers rule as attack surface → exact argv, per-user file, validation, uninstall, no binaries until signed.
5. Wrong trigger matches → verified presets only, mic heuristic opt-in, app+mic combination for call apps, visible "quiet because: X".
6. Electrobun has no native popover → positioned borderless window; prototyped first (dismissal on outside click, Spaces/fullscreen games, multiple displays); fallback to native menu only.
