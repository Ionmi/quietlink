# Contributing

## Layout

- `src/domain/`: pure logic (no I/O, no timers): leases, mode reducer, probe ledger, metrics, triggers, band advisor, notes, quiet test, sessions, redaction. Everything here is unit-tested with plain inputs.
- `src/adapters/`: helper/warden clients, settings, SQLite telemetry, privilege install, LaunchAgents, log stream, instance lock.
- `src/app/`: the controller (wires sensors → domain → warden), diagnostics export, CLI socket.
- `src/main/`: Electrobun entry, tray, windows, RPC surface.
- `src/views/`: Svelte 5 popover and settings.
- `helper/`: Swift sensor + warden binary. `WardenCore.swift` is pure and tested by `--test-warden`.

## Checks

```sh
bun run check              # TypeScript
bun test                   # unit + controller scenarios
bun run test:helper        # warden core tests + sensor self-test (needs Wi-Fi)
bun run test:integration   # warden in dry-run mode, no sudo
```

## Rules

- Never scan Wi-Fi (`scanForNetworks`, `system_profiler SPAirPortDataType`). It causes the cuts we measure.
- Never word a note as a cause. Log events near a cut are coincidences.
- Only the warden executes `ifconfig awdl0` or `networksetup`. Never pass user input into their arguments.
- Presets ship `verified: false` until someone checks the exact executable path with the real app, and unverified presets load disabled.
- Adding a macOS version to the log parser requires fixtures from that version in `tests/fixtures/`.
- Every behavior change comes with a test that fails without it.
