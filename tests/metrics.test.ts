import { expect, test } from "bun:test";
import { jitter, Histogram, percentile } from "../src/domain/metrics";

test("jitter is mean absolute successive difference", () => {
  expect(jitter([4, 6, 5, 9])!).toBeCloseTo((2 + 1 + 4) / 3);
  expect(jitter([4])).toBeNull();
});

test("percentile uses bucket upper bounds and merges exactly", () => {
  const a = new Histogram();
  [3, 3, 3, 90].forEach((x) => a.add(x));
  const b = Histogram.from(a.toJSON());
  b.merge(a);
  expect(b.count).toBe(8);
  expect(percentile(b, 0.5)).toBe(3);
  expect(percentile(b, 0.95)).toBe(100);
  expect(percentile(new Histogram(), 0.5)).toBeNull();
});

test("values above the last finite bucket land in the overflow bucket", () => {
  const h = new Histogram();
  h.add(5000);
  expect(percentile(h, 1)).toBe(Infinity);
});
