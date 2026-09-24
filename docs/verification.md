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
