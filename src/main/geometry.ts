export type Rect = { x: number; y: number; width: number; height: number };
export type Screen = { x: number; y: number; width: number; height: number };

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
