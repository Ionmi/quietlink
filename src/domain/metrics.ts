/** Mean absolute difference of consecutive RTTs. */
export function jitter(rtts: number[]): number | null {
  if (rtts.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < rtts.length; i++) sum += Math.abs(rtts[i] - rtts[i - 1]);
  return sum / (rtts.length - 1);
}

/** Fixed log-scale histogram so session percentiles merge exactly (to bucket resolution). */
export class Histogram {
  static buckets = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200, 250, 300, 400, 500, 700, 1000, Infinity];
  counts: number[] = Histogram.buckets.map(() => 0);
  count = 0;

  add(ms: number) {
    const i = Histogram.buckets.findIndex((b) => ms <= b);
    this.counts[i]++;
    this.count++;
  }

  merge(h: Histogram) {
    h.counts.forEach((c, i) => (this.counts[i] += c));
    this.count += h.count;
  }

  toJSON(): number[] {
    return [...this.counts];
  }

  static from(a: number[]): Histogram {
    const h = new Histogram();
    a.forEach((c, i) => (h.counts[i] = c));
    h.count = a.reduce((x, y) => x + y, 0);
    return h;
  }
}

/** Upper bound of the bucket containing the p-quantile. */
export function percentile(h: Histogram, p: number): number | null {
  if (h.count === 0) return null;
  const rank = Math.max(1, Math.ceil(p * h.count));
  let seen = 0;
  for (let i = 0; i < h.counts.length; i++) {
    seen += h.counts[i];
    if (seen >= rank) return Histogram.buckets[i];
  }
  return Infinity;
}
