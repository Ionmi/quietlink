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

const err = (seq: number, ts: number): HelperEvent => ({ v: 1, type: "probe-result", ts, target: "gw", id: 1, seq, outcome: "error", error: "unreachable" });

test("errors are counted separately and never form interruptions", () => {
  const l = L();
  l.onEvent(sent(1, 0)); l.onEvent(res(1, 3, "reply", 3));
  l.onEvent(sent(2, 500)); l.onEvent(err(2, 510));
  l.onEvent(sent(3, 1000)); l.onEvent(err(3, 1010));
  l.onEvent(sent(4, 1500)); l.onEvent(res(4, 1504, "reply", 4));
  expect(l.interruptions("gw")).toEqual([]);
  expect(l.window("gw", 5000)).toMatchObject({ sent: 4, lost: 0, errors: 2 });
});

test("loss/error/loss is not two consecutive losses", () => {
  const l = L();
  l.onEvent(sent(1, 0)); l.onEvent(res(1, 1000, "lost"));
  l.onEvent(sent(2, 500)); l.onEvent(err(2, 510));
  l.onEvent(sent(3, 1000)); l.onEvent(res(3, 2000, "lost"));
  expect(l.interruptions("gw")).toEqual([]);
});

test("unknown probe breaks a run", () => {
  const l = L();
  l.onEvent(sent(1, 0)); l.onEvent(res(1, 1000, "lost"));
  l.onEvent(sent(2, 500)); l.onHelperRestart(600);
  l.onEvent(sent(3, 1000, 2)); l.onEvent(res(3, 2000, "lost", undefined, 2));
  expect(l.interruptions("gw")).toEqual([]);
});

test("losses on opposite sides of sleep do not merge", () => {
  const l = L();
  l.onEvent(sent(1, 0)); l.onEvent(res(1, 1000, "lost"));
  l.onEvent(sent(2, 500)); l.onEvent(res(2, 1500, "lost"));
  l.onPause(400, 600);
  expect(l.interruptions("gw")).toEqual([]);
  const l2 = L();
  l2.onEvent(sent(1, 0)); l2.onEvent(res(1, 1000, "lost"));
  l2.onPause(100, 5000);
  l2.onEvent(sent(2, 6000)); l2.onEvent(res(2, 7000, "lost"));
  expect(l2.interruptions("gw")).toEqual([]);
});

test("range summarizes probes sent inside a time window", () => {
  const l = L();
  l.onEvent(sent(1, 0)); l.onEvent(res(1, 3, "reply", 3));
  l.onEvent(sent(2, 500)); l.onEvent(res(2, 540, "reply", 40));
  l.onEvent(sent(3, 1000)); l.onEvent(res(3, 2000, "lost"));
  l.onEvent(sent(4, 1500)); l.onEvent(res(4, 1505, "reply", 5));
  expect(l.range("gw", 400, 1200)).toMatchObject({ sent: 2, lost: 1, replies: [40] });
});

test("series keeps losses as null in send order", () => {
  const l = L();
  l.onEvent(sent(2, 500)); l.onEvent(res(2, 1500, "lost"));
  l.onEvent(sent(1, 0)); l.onEvent(res(1, 3, "reply", 3));
  expect(l.series("gw", 0, 1000)).toEqual([{ t: 0, rtt: 3 }, { t: 500, rtt: null }]);
});
