import { expect, test } from "bun:test";
import { popoverFrame } from "../src/main/geometry";

const screens = [
  { x: 0, y: 0, width: 1496, height: 967 },
  { x: -877, y: 967, width: 3440, height: 1440 },
];
const size = { width: 340, height: 460 };

test("tray on external screen above main maps to top-left coordinates", () => {
  // Measured on the owner's Mac: tray bounds {2015,2377,34,22}; AX position of the item y=-1437.
  const f = popoverFrame({ x: 2015, y: 2377, width: 34, height: 22 }, screens, size);
  expect(f).toEqual({ x: 1862, y: 967 - 2377 + 4, width: 340, height: 460 });
});

test("clamps to the right edge of the tray's screen", () => {
  const f = popoverFrame({ x: 1470, y: 945, width: 22, height: 22 }, screens, size);
  expect(f.x).toBe(1496 - 340 - 8);
  expect(f.y).toBe(967 - 945 + 4);
});

test("cocoa click inside/outside the popover frame", async () => {
  const { containsCocoaPoint } = await import("../src/main/geometry");
  const f = popoverFrame({ x: 2015, y: 2377, width: 34, height: 22 }, screens, size);
  expect(containsCocoaPoint(f, { x: f.x + 10, y: 967 - (f.y + 10) }, screens)).toBe(true);
  expect(containsCocoaPoint(f, { x: f.x - 50, y: 967 - (f.y + 10) }, screens)).toBe(false);
  expect(containsCocoaPoint(f, { x: f.x + 10, y: 967 - (f.y + size.height + 30) }, screens)).toBe(false);
});
