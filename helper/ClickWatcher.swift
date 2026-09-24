import AppKit

/// While the app's popover is open, reports mouse-downs in other apps (Cocoa screen
/// coordinates) so the app can close the popover on an outside click. Needed because
/// the popover belongs to another process and may never become key, so it gets no blur.
enum ClickWatcher {
  private static var monitor: Any?

  static func set(_ on: Bool) {
    if on, monitor == nil {
      monitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { _ in
        let p = NSEvent.mouseLocation
        emit(["type": "mouse-down", "x": p.x, "y": p.y])
      }
    } else if !on, let m = monitor {
      NSEvent.removeMonitor(m)
      monitor = nil
    }
  }
}
