import { expect, test } from "bun:test";
import { buildReport } from "../src/app/export";

const view: any = {
  phase: "active", because: ["League of Legends (match)"], paused: false, privilege: true, wardenHealthy: true, recovering: false,
  wifi: { iface: "en0", band: "6", channel: 5, widthMHz: 160, rssi: -41, noise: -92, phyRateMbps: 2401 },
  router: "192.168.1.1", ping: { gw: 3.2, ext: 8.1 }, lossPct: 0, jitter: 0.4, late: 0, interruptionsLastHour: 1,
  advice: { kind: "none" }, lastEvents: [{ ts: 0, kind: "interruption", text: "≈1.5 s", note: "No logged Wi-Fi event near this cut" }],
  sessions: [{ id: "x", start: 0, end: 60_000, triggers: ["League of Legends (match)"], p50: 3, p95: 5, max: 40, spikes: 0, interruptions: 1, lossPct: 0.5, awdlReenables: 12, notes: [] }],
  settings: { externalTarget: "1.1.1.1", extraTargets: ["192.168.1.148"] },
};
const ctx = { username: "alex", home: "/Users/alex", macos: "27.0", version: "0.1.0", gatewayIds: [] };

test("report has sections and is redacted by default", () => {
  const md = buildReport(view, [], ctx, false);
  for (const h of ["## Status", "## Wi-Fi", "## Last 24 h", "## Sessions", "## Events"]) expect(md).toContain(h);
  expect(md).not.toContain("192.168.1.1");
  expect(md).not.toContain("192.168.1.148");
  expect(md).not.toContain("1.1.1.1");
  expect(md).toContain("<ipv4>");
  expect(md).toContain("6 GHz");
});

test("identifiers included on request", () => {
  expect(buildReport(view, [], ctx, true)).toContain("192.168.1.1");
});
