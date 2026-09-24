import { expect, test } from "bun:test";
import { formatRate, formatMbps, formatPing, trayImageSpec, TrafficMeter } from "../src/domain/menubar";

test("popover rate formatting is compact and in bits per second", () => {
  expect(formatRate(0)).toBe("0K");
  expect(formatRate(10_500)).toBe("84K");
  expect(formatRate(154_250)).toBe("1.2M");
  expect(formatRate(125_000_000)).toBe("1.0G");
  expect(formatRate(null)).toBe("–");
});

test("menu bar always uses Mb/s with at most 4 characters", () => {
  expect(formatMbps(0)).toBe("0.0");
  expect(formatMbps(10_500)).toBe("0.1");
  expect(formatMbps(175_000)).toBe("1.4");
  expect(formatMbps(7_087_500)).toBe("56.7");
  expect(formatMbps(15_000_000)).toBe("120");
  expect(formatMbps(300_000_000)).toBe("2400");
  expect(formatMbps(5_000_000_000)).toBe("9999");
  expect(formatMbps(null)).toBe("–");
});

test("ping formatting clamps to three digits", () => {
  expect(formatPing(4.4)).toBe("4");
  expect(formatPing(1234)).toBe("999");
  expect(formatPing(null)).toBe("–");
});

test("tray image spec follows settings", () => {
  const t = { down: 7_087_500, up: 175_000 };
  expect(trayImageSpec("quiet", 4.4, t, { ping: true, traffic: true })).toEqual({ state: "quiet", ping: "4", up: "1.4", down: "56.7" });
  expect(trayImageSpec("idle", 4.4, null, { ping: true, traffic: true })).toEqual({ state: "idle", ping: "4", up: "–", down: "–" });
  expect(trayImageSpec("idle", 4.4, t, { ping: true, traffic: false })).toEqual({ state: "idle", ping: "4" });
  expect(trayImageSpec("warn", null, t, { ping: false, traffic: false })).toEqual({ state: "warn" });
});

test("traffic meter computes per-second rates and handles 32-bit wrap and iface change", () => {
  const m = new TrafficMeter();
  expect(m.update("en0", 1000, 500, 0)).toBeNull();
  expect(m.update("en0", 3000, 900, 1000)).toEqual({ down: 2000, up: 400 });
  m.update("en0", 2 ** 32 - 100, 0, 2000);
  expect(m.update("en0", 900, 0, 3000)).toEqual({ down: 1000, up: 0 });
  expect(m.update("en1", 5, 5, 4000)).toBeNull();
});
