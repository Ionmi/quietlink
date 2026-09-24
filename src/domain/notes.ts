export type WifiLogEvent = {
  ts: number;
  kind: "awdl-start" | "awdl-end" | "scan-start" | "scan-end" | "channel-change";
  bands?: { g24: number; g5: number };
  durationMs?: number;
};

export type Note = { text: "scan-before" | "awdl-before" | "channel-change" | "none"; deltaMs?: number };

const TEXT: Partial<Record<WifiLogEvent["kind"], Note["text"]>> = {
  "scan-start": "scan-before",
  "scan-end": "scan-before",
  "awdl-start": "awdl-before",
  "channel-change": "channel-change",
};

/**
 * The logged Wi-Fi event nearest to the start of a cut, within windowMs before it
 * or during it. Reports coincidence only; deltaMs > 0 means the event came first.
 */
export function noteFor(cut: { start: number; end: number }, events: WifiLogEvent[], windowMs = 500): Note {
  let best: { e: WifiLogEvent; d: number } | null = null;
  for (const e of events) {
    if (!TEXT[e.kind] || e.ts < cut.start - windowMs || e.ts > cut.end) continue;
    const d = cut.start - e.ts;
    if (!best || Math.abs(d) < Math.abs(best.d)) best = { e, d };
  }
  return best ? { text: TEXT[best.e.kind]!, deltaMs: best.d } : { text: "none" };
}
