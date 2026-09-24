import { percentile, type Histogram } from "./metrics";

export type SessionSummary = {
  id: string; start: number; end: number; triggers: string[];
  p50: number | null; p95: number | null; max: number | null;
  spikes: number; interruptions: number; lossPct: number; awdlReenables: number; notes: string[];
};

export function summarize(i: {
  start: number; end: number; triggers: string[]; hist: Histogram; max: number | null; spikes: number;
  interruptions: number; sent: number; lost: number; awdlReenables: number; notes: string[];
}): SessionSummary {
  return {
    id: crypto.randomUUID(),
    start: i.start, end: i.end, triggers: i.triggers,
    p50: percentile(i.hist, 0.5), p95: percentile(i.hist, 0.95), max: i.max,
    spikes: i.spikes, interruptions: i.interruptions,
    lossPct: i.sent ? Math.round((i.lost / i.sent) * 1000) / 10 : 0,
    awdlReenables: i.awdlReenables, notes: i.notes,
  };
}
