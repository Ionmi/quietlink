import { expect, test } from "bun:test";
import { menuBarTitle, formatRate, TrafficMeter } from "../src/domain/menubar";

test("rate formatting is compact and in bits per second", () => {
  expect(formatRate(0)).toBe("0K");
  expect(formatRate(105)).toBe("1K");
  expect(formatRate(10_500)).toBe("84K");
  expect(formatRate(154_250)).toBe("1.2M");
  expect(formatRate(7_087_500)).toBe("57M");
  expect(formatRate(125_000_000)).toBe("1.0G");
  expect(formatRate(null)).toBe("–");
});

test("title combines ping and traffic per settings", () => {
  const t = { down: 154_250, up: 10_500 };
  expect(menuBarTitle(5.4, t, { ping: true, traffic: true })).toBe("5 ms ↓1.2M ↑84K");
  expect(menuBarTitle(5.4, t, { ping: true, traffic: false })).toBe("5 ms");
  expect(menuBarTitle(null, t, { ping: true, traffic: true })).toBe("– ms ↓1.2M ↑84K");
  expect(menuBarTitle(5, null, { ping: true, traffic: true })).toBe("5 ms");
  expect(menuBarTitle(5, t, { ping: false, traffic: false })).toBe("");
});

test("traffic meter computes per-second rates and handles 32-bit wrap and iface change", () => {
  const m = new TrafficMeter();
  expect(m.update("en0", 1000, 500, 0)).toBeNull();
  expect(m.update("en0", 3000, 900, 1000)).toEqual({ down: 2000, up: 400 });
  const near = 2 ** 32 - 100;
  m.update("en0", near, 0, 2000);
  expect(m.update("en0", 900, 0, 3000)).toEqual({ down: 1000, up: 0 });
  expect(m.update("en1", 5, 5, 4000)).toBeNull();
  expect(m.update("en1", 5, 5, 4000)).toBeNull();
});
