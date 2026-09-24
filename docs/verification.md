# Verification on the owner's Mac (macOS 27, Apple Silicon) — 2026-09-24 14:02

```
PASS sudo rule allows exactly the two commands
PASS sudoers file is root-owned 0440 — /etc/sudoers.d/quietlink-alex
PASS warden LaunchAgent is running
PASS app is running
PASS AWDL up before test
PASS manual quiet brings AWDL down — 4 ms
PASS warden re-applies down after macOS re-enables AWDL — 110 ms
PASS quiet off restores AWDL after grace — 7774 ms
PASS kill -9 app → warden restores AWDL — 4189 ms
PASS SIGSTOP app → warden restores AWDL — 4784 ms
PASS SIGSTOP warden → app SIGKILLs it and launchd restarts it — 2941 ms
PASS AWDL up after warden restart and quiet off
PASS kill -9 app and warden → AWDL restored — 109 ms
PASS second launch exits; one instance — 81094
all checks passed
```

## Quiet test (A = baseline, B = quiet mode), 2026-09-24, 6 GHz ch 5, 0.2 s router probes

| Block | Condition | Probes | Lost | Spikes > 30 ms | p95 | Max |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | A | 301 | 0 | 0 | 6 ms | 8.9 ms |
| 2 | B | 300 | 0 | 0 | 6 ms | 6.8 ms |
| 3 | A | 300 | 0 | 0 | 6 ms | 6.8 ms |
| 4 | B | 300 | 0 | 0 | 6 ms | 8.8 ms |

No measurable difference on this run: with the Mac on 6 GHz, AWDL caused no spikes during the test
(the earlier 77-spike baseline was measured on 5 GHz channel 40). Repeat when spikes are observed.

## League of Legends detection (2026-09-24)

- Installed layout: match = `LoL/Game/LeagueofLegends.app/Contents/MacOS/LeagueofLegends`, client = `LoL/League of Legends.app/Contents/MacOS/LeagueClientUx`, launcher = `LoL/LeagueClient.app/…/LeagueClient`.
- A stand-in binary at the match path: quiet mode on in < 7 s (process snapshot every 2 s), AWDL down; after it exits, grace 10 s, then AWDL up.
- A stand-in at the client path: no trigger.
- Pending: confirm with a real match.
