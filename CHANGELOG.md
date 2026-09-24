# Changelog

## 0.1.6 — 2026-09-24
- Updates no longer show Electrobun's installer window: the updater unpacks the self-extracting bundle itself, so Quietlink relaunches directly. The local signature is now applied to the app that actually runs.

## 0.1.5 — 2026-09-24
- Fix: during a fullscreen game macOS App Nap could delay lease renewals, so the warden briefly turned AirDrop back on (4 times in one real match), causing latency spikes. App Nap is now disabled for the app and helper.
- Stalls of the app's 1-second loop are recorded and shown, to diagnose this kind of problem.

## 0.1.4 — 2026-09-24
- Router probes work with macOS Local Network privacy: the helper is its own app bundle with a usage description, builds and installed updates are signed with a local self-signed identity so permissions survive updates, and a `/sbin/ping` fallback kicks in if access is still refused.
- The panel explains when macOS blocks access to the router and opens the right setting.

## 0.1.3 — 2026-09-24
- First update delivered by the in-app installer.

## 0.1.2 — 2026-09-24
- Updates install themselves: Install and restart downloads the release, checks its SHA-256 and bundle, swaps it in (old version to the Trash) and relaunches. Also `quietlink update`.

## 0.1.1 — 2026-09-24
- First release built and published automatically by the Release workflow.
- In-app update notice (Settings → About, and the menu-bar panel).

## 0.1.0 — 2026-09-24
- First public version: quiet mode for games and calls, warden with crash recovery, network monitor, Wi-Fi inspector, Quiet test, menu-bar ping and traffic.
