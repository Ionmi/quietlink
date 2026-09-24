import { expect, test } from "bun:test";
import { NotifyPolicy } from "../src/domain/notify-policy";

test("rate limits per kind", () => {
  const p = new NotifyPolicy();
  expect(p.allow("cut", 0)).toBe(true);
  expect(p.allow("cut", 299_999)).toBe(false);
  expect(p.allow("band", 1)).toBe(true);
  expect(p.allow("cut", 300_000)).toBe(true);
});
