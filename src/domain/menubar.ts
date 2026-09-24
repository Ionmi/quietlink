export type Traffic = { down: number; up: number };

const WRAP = 2 ** 32;

/** Bytes/s from cumulative 32-bit interface counters sampled about once a second. */
export class TrafficMeter {
  private last: { iface: string; rx: number; tx: number; at: number } | null = null;

  update(iface: string, rx: number, tx: number, at: number): Traffic | null {
    const prev = this.last;
    this.last = { iface, rx, tx, at };
    if (!prev || prev.iface !== iface || at <= prev.at) return null;
    const secs = (at - prev.at) / 1000;
    const delta = (a: number, b: number) => ((a - b) % WRAP + WRAP) % WRAP;
    return { down: Math.round(delta(rx, prev.rx) / secs), up: Math.round(delta(tx, prev.tx) / secs) };
  }
}

/** Bits per second, like ISP plans and speed tests: 840 Kb/s → "840K", 14.2 Mb/s → "14M". */
export function formatRate(bytesPerSec: number | null): string {
  if (bytesPerSec === null) return "–";
  const bits = bytesPerSec * 8;
  if (bits < 1_000_000) return `${Math.round(bits / 1000)}K`;
  if (bits < 1_000_000_000) {
    const m = bits / 1_000_000;
    return m < 10 ? `${m.toFixed(1)}M` : `${Math.round(m)}M`;
  }
  return `${(bits / 1_000_000_000).toFixed(1)}G`;
}

export function menuBarTitle(pingMs: number | null, traffic: Traffic | null, show: { ping: boolean; traffic: boolean }): string {
  const parts: string[] = [];
  if (show.ping) parts.push(`${pingMs === null ? "–" : Math.round(pingMs)} ms`);
  if (show.traffic && traffic) parts.push(`↓${formatRate(traffic.down)} ↑${formatRate(traffic.up)}`);
  return parts.join(" ");
}
