import AppKit

/// Screen frames in Cocoa coordinates (origin bottom-left of the main screen).
/// Electrobun's tray bounds use Cocoa coordinates while window frames use
/// top-left coordinates, so the app needs the main screen height to convert.
func screensSnapshot() -> [String: Any] {
  let screens = NSScreen.screens.map { s -> [String: Any] in
    ["x": s.frame.origin.x, "y": s.frame.origin.y, "width": s.frame.width, "height": s.frame.height,
     "visibleX": s.visibleFrame.origin.x, "visibleY": s.visibleFrame.origin.y,
     "visibleWidth": s.visibleFrame.width, "visibleHeight": s.visibleFrame.height]
  }
  return ["type": "screens", "screens": screens]
}
