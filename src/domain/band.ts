import type { Band } from "../shared/protocol";

export type BandHistory = Record<string, { bands: Band[]; lastSeen: number }>;
export type Advice = { kind: "none" } | { kind: "previously-6"; current: "2.4" | "5" } | { kind: "info"; current: Band };

/** Provisional gateway identifier: keyed hash of the router MAC, never the MAC itself. */
export function gatewayId(mac: string | null, key: Uint8Array): string | null {
  if (!mac) return null;
  const h = new Bun.CryptoHasher("sha256", key);
  h.update(mac.toLowerCase());
  return h.digest("hex");
}

export function recordBand(h: BandHistory, id: string | null, band: Band | null, now: number): BandHistory {
  if (!id || !band) return h;
  const prev = h[id]?.bands ?? [];
  return { ...h, [id]: { bands: prev.includes(band) ? prev : [...prev, band], lastSeen: now } };
}

/** Only claims what this Mac has actually seen before; never that 6 GHz is available. */
export function advise(h: BandHistory, id: string | null, band: Band | null, quiet: boolean): Advice {
  if (!band || band === "6") return { kind: "none" };
  if (!quiet && id && h[id]?.bands.includes("6")) return { kind: "previously-6", current: band };
  return { kind: "info", current: band };
}
