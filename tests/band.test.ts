import { expect, test } from "bun:test";
import { advise, recordBand, gatewayId } from "../src/domain/band";

const key = new Uint8Array(32).fill(7);

test("advises only when 6 GHz was previously observed on this gateway", () => {
  const id = gatewayId("0a:1b:2c:3d:4e:5f", key)!;
  const h = recordBand({}, id, "6", 1);
  expect(advise(h, id, "5", false)).toEqual({ kind: "previously-6", current: "5" });
  expect(advise(h, id, "2.4", false)).toEqual({ kind: "previously-6", current: "2.4" });
  expect(advise(h, id, "6", false)).toEqual({ kind: "none" });
  expect(advise(h, id, "5", true)).toEqual({ kind: "info", current: "5" });
  expect(advise({}, id, "5", false)).toEqual({ kind: "info", current: "5" });
  expect(advise(h, null, "5", false)).toEqual({ kind: "info", current: "5" });
  expect(advise(h, id, null, false)).toEqual({ kind: "none" });
});

test("recordBand dedupes, ignores unknowns and does not mutate", () => {
  const id = "g";
  const a = recordBand({}, id, "5", 1);
  const b = recordBand(a, id, "5", 2);
  expect(b[id].bands).toEqual(["5"]);
  expect(b[id].lastSeen).toBe(2);
  expect(a[id].lastSeen).toBe(1);
  expect(recordBand(a, null, "6", 3)).toBe(a);
  expect(recordBand(a, id, null, 3)).toBe(a);
});

test("gateway id is stable, case-insensitive and does not contain the mac", () => {
  const a = gatewayId("0a:1b:2c:3d:4e:5f", key)!;
  expect(a).toBe(gatewayId("0A:1B:2C:3D:4E:5F", key));
  expect(a).not.toContain("0a1b");
  expect(a).toHaveLength(64);
  expect(gatewayId(null, key)).toBeNull();
  expect(gatewayId("", key)).toBeNull();
});
