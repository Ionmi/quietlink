import { expect, test } from "bun:test";
import { parseLogLine, noteFor } from "../src/domain/logparse";

const lines = (await Bun.file(new URL("fixtures/logs-macos27.txt", import.meta.url)).text()).trim().split("\n");

test("parses scan start with bands and localized durations", () => {
  expect(parseLogLine(lines[0], 27)).toMatchObject({ kind: "scan-start", bands: { g24: 1, g5: 0 } });
  expect(parseLogLine(lines[1], 27)).toMatchObject({ kind: "scan-end", durationMs: 173 });
  expect(parseLogLine(lines[4], 27)).toMatchObject({ kind: "scan-end", durationMs: 4000 });
  expect(parseLogLine(lines[5], 27)).toMatchObject({ kind: "scan-start", bands: { g24: 0, g5: 24 } });
  expect(parseLogLine(lines[7], 27)).toMatchObject({ kind: "scan-end", durationMs: 1000 });
});

test("timestamps come from the log entry (local time)", () => {
  expect(parseLogLine(lines[0], 27)!.ts).toBe(new Date(2026, 8, 23, 19, 13, 38, 592).getTime());
});

test("parses awdl start/end and ignores unknown", () => {
  expect(parseLogLine(lines[2], 27)?.kind).toBe("awdl-end");
  expect(parseLogLine(lines[3], 27)?.kind).toBe("awdl-start");
  expect(parseLogLine(lines[8], 27)).toBeNull();
  expect(parseLogLine("garbage", 27)).toBeNull();
});

test("unsupported macOS versions parse nothing", () => {
  expect(parseLogLine(lines[0], 13)).toBeNull();
});

test("note is coincidence-worded and windowed", () => {
  const ev = [{ ts: 1000, kind: "scan-start" as const }];
  expect(noteFor({ start: 1080, end: 5000 }, ev)).toEqual({ text: "scan-before", deltaMs: 80 });
  expect(noteFor({ start: 3000, end: 5000 }, ev)).toEqual({ text: "none" });
});

test("event inside the cut counts, nearest wins", () => {
  const ev = [{ ts: 900, kind: "awdl-start" as const }, { ts: 1500, kind: "scan-start" as const }];
  expect(noteFor({ start: 1000, end: 2000 }, ev)).toEqual({ text: "awdl-before", deltaMs: 100 });
  expect(noteFor({ start: 1400, end: 2000 }, [{ ts: 1500, kind: "channel-change" as const }])).toEqual({ text: "channel-change", deltaMs: -100 });
});
