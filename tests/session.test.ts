import { expect, test } from "bun:test";
import { summarize } from "../src/domain/session";
import { Histogram } from "../src/domain/metrics";

test("summarizes percentiles from histogram and loss", () => {
  const hist = new Histogram();
  [3, 3, 3, 90].forEach((x) => hist.add(x));
  const s = summarize({ start: 0, end: 60_000, triggers: ["League of Legends (match)"], hist, max: 90, spikes: 0, interruptions: 1, sent: 4, lost: 1, awdlReenables: 3, notes: [] });
  expect(s).toMatchObject({ start: 0, end: 60_000, p50: 3, p95: 100, max: 90, lossPct: 25, interruptions: 1, awdlReenables: 3 });
  expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
});

test("no probes gives null metrics and zero loss", () => {
  const s = summarize({ start: 0, end: 1, triggers: [], hist: new Histogram(), max: null, spikes: 0, interruptions: 0, sent: 0, lost: 0, awdlReenables: 0, notes: [] });
  expect(s).toMatchObject({ p50: null, p95: null, lossPct: 0 });
});
