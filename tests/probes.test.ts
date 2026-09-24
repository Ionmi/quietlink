import { expect, test } from "bun:test";
import { ProbeLedger } from "../src/domain/probes";
import type { HelperEvent } from "../src/shared/protocol";

const L = () => new ProbeLedger({ deadlineMs: 1000, windowMs: 60_000 });
const sent = (seq: number, ts: number, id = 1): HelperEvent => ({ v: 1, type: "probe-sent", ts, target: "gw", id, seq });
const res = (seq: number, ts: number, outcome: "reply" | "lost", rttMs?: number, id = 1): HelperEvent => ({ v: 1, type: "probe-result", ts, target: "gw", id, seq, outcome, rttMs });

test("late reply stays lost", () => {
  const l = L();
  l.onEvent(sent(1, 0));
  l.onEvent(res(1, 1000, "lost"));
  l.onEvent({ v: 1, type: "probe-late", ts: 1200, target: "gw", id: 1, seq: 1, rttMs: 1200 });
  expect(l.window("gw", 2000)).toMatchObject({ sent: 1, lost: 1, late: 1 });
});

test("pending probes before deadline are excluded and window is provisional", () => {
  const l = L();
  l.onEvent(sent(1, 0));
  l.onEvent(res(1, 5, "reply", 5));
  l.onEvent(sent(2, 500));
  expect(l.window("gw", 600)).toMatchObject({ sent: 1, lost: 0, provisional: true });
});

test("helper restart turns pending into unknown, excluded from loss", () => {
  const l = L();
  l.onEvent(sent(1, 0));
  l.onHelperRestart(300);
  expect(l.window("gw", 5000)).toMatchObject({ sent: 0, lost: 0 });
});

test("send-failed is not counted as sent", () => {
  const l = L();
  l.onEvent({ v: 1, type: "probe-send-failed", ts: 0, target: "gw", error: "EHOSTUNREACH" });
  expect(l.window("gw", 5000).sent).toBe(0);
});

test("interruption needs two consecutive losses and reports resolution", () => {
  const l = L();
  l.onEvent(sent(1, 0)); l.onEvent(res(1, 3, "reply", 3));
  l.onEvent(sent(2, 500)); l.onEvent(res(2, 1500, "lost"));
  l.onEvent(sent(3, 1000)); l.onEvent(res(3, 2000, "lost"));
  l.onEvent(sent(4, 1500)); l.onEvent(res(4, 1504, "reply", 4));
  expect(l.interruptions("gw")).toEqual([{ start: 3, end: 1504, lostCount: 2, resolutionMs: 500 }]);
});

test("ongoing interruption has null end", () => {
  const l = L();
  l.onEvent(sent(1, 0)); l.onEvent(res(1, 3, "reply", 3));
  l.onEvent(sent(2, 500)); l.onEvent(res(2, 1500, "lost"));
  l.onEvent(sent(3, 1000)); l.onEvent(res(3, 2000, "lost"));
  expect(l.interruptions("gw")).toEqual([{ start: 3, end: null, lostCount: 2, resolutionMs: 500 }]);
});

test("single loss is not an interruption", () => {
  const l = L();
  l.onEvent(sent(1, 0)); l.onEvent(res(1, 1000, "lost"));
  l.onEvent(sent(2, 500)); l.onEvent(res(2, 502, "reply", 2));
  expect(l.interruptions("gw")).toEqual([]);
});

test("sleep window is excluded", () => {
  const l = L();
  l.onEvent(sent(1, 0)); l.onEvent(res(1, 1000, "lost"));
  l.onPause(0, 10_000);
  expect(l.window("gw", 20_000).sent).toBe(0);
});

test("duplicate result ignored", () => {
  const l = L();
  l.onEvent(sent(1, 0)); l.onEvent(res(1, 3, "reply", 3)); l.onEvent(res(1, 4, "reply", 4));
  expect(l.window("gw", 5000)).toMatchObject({ sent: 1, replies: [3] });
});

test("new prober id after restart does not collide with old seq", () => {
  const l = L();
  l.onEvent(sent(1, 0, 1)); l.onEvent(res(1, 3, "reply", 3, 1));
  l.onEvent(sent(1, 100, 2)); l.onEvent(res(1, 104, "reply", 4, 2));
  expect(l.window("gw", 5000)).toMatchObject({ sent: 2, replies: [3, 4] });
});

test("old records fall out of the window", () => {
  const l = L();
  l.onEvent(sent(1, 0)); l.onEvent(res(1, 1000, "lost"));
  l.onEvent(sent(2, 70_000)); l.onEvent(res(2, 70_003, "reply", 3));
  expect(l.window("gw", 72_000)).toMatchObject({ sent: 1, lost: 0 });
});

test("targets are independent", () => {
  const l = L();
  l.onEvent(sent(1, 0)); l.onEvent(res(1, 1000, "lost"));
  expect(l.window("ext", 5000).sent).toBe(0);
});
