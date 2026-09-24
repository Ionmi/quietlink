export type Rect = { x: number; y: number; width: number; height: number };
export type Screen = { x: number; y: number; width: number; height: number };

/** True if a Cocoa-coordinate point lies inside a top-left-coordinate rect. */
export function containsCocoaPoint(rect: Rect, p: { x: number; y: number }, screens: Screen[]): boolean {
  const main = screens[0];
  const top = main.y + main.height - p.y;
  return p.x >= rect.x && p.x <= rect.x + rect.width && top >= rect.y && top <= rect.y + rect.height;
}

/**
 * Electrobun returns tray bounds in Cocoa coordinates (origin bottom-left of the
 * main screen, y up) but positions windows in top-left coordinates (y down).
 * Places the popover centred under the tray icon, clamped to that icon's screen.
 */
export function popoverFrame(tray: Rect, screens: Screen[], size: { width: number; height: number }): Rect {
  const main = screens[0];
  const midX = tray.x + tray.width / 2;
  const screen = screens.find((s) => midX >= s.x && midX < s.x + s.width && tray.y >= s.y && tray.y < s.y + s.height) ?? main;
  const flip = (cocoaY: number) => main.y + main.height - cocoaY;
  const top = flip(tray.y) + 4;
  const minX = screen.x + 8;
  const maxX = screen.x + screen.width - size.width - 8;
  const x = Math.round(Math.min(Math.max(midX - size.width / 2, minX), maxX));
  return { x, y: Math.round(top), width: size.width, height: size.height };
}
