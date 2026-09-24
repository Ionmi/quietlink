import AppKit

/// The menu-bar item, owned by the helper so it is a real template image that macOS
/// tints for light and dark menu bars. Layout: ping (in a pill while quiet mode is
/// on) followed by upload over download. The width depends only on which fields are
/// shown, never on the numbers.
enum TrayRenderer {
  static let height: CGFloat = 22
  static let pingFont = NSFont.monospacedDigitSystemFont(ofSize: 13, weight: .semibold)
  static let msFont = NSFont.systemFont(ofSize: 9.5, weight: .semibold)
  static let rateFont = NSFont.monospacedDigitSystemFont(ofSize: 10, weight: .semibold)
  static let arrowFont = NSFont.systemFont(ofSize: 8, weight: .bold)

  static func w(_ s: String, _ f: NSFont) -> CGFloat { ceil((s as NSString).size(withAttributes: [.font: f]).width) }

  static let smallPingFont = NSFont.monospacedDigitSystemFont(ofSize: 10.5, weight: .semibold)
  /// Room for two digits; three-digit pings (rare against a router) use a smaller font.
  static let pingSlot = w("88", pingFont) + 2 + w("ms", msFont) + 8   // pill padding included
  static let rateSlot = w("↑", arrowFont) + 2 + w("8888", rateFont)

  static func width(ping: Bool, traffic: Bool) -> CGFloat {
    var x: CGFloat = 0
    if ping { x += pingSlot }
    if ping && traffic { x += 3 }
    if traffic { x += rateSlot }
    return max(ceil(x), 16)
  }

  static func text(_ s: String, _ f: NSFont, at p: NSPoint, alpha: CGFloat = 1) {
    (s as NSString).draw(at: NSPoint(x: p.x, y: p.y + f.descender), withAttributes: [.font: f, .foregroundColor: NSColor.black.withAlphaComponent(alpha)])
  }

  static func image(state: String, ping: String?, up: String?, down: String?) -> NSImage {
    let showTraffic = up != nil && down != nil
    let size = NSSize(width: width(ping: ping != nil, traffic: showTraffic), height: height)
    let img = NSImage(size: size, flipped: false) { _ in
      var x: CGFloat = 0
      if let ping {
        // Right-aligned in its slot: spare room becomes leading space, not a gap in the middle.
        let pf = ping.count > 2 ? smallPingFont : pingFont
        let textW = w(ping, pf) + 2 + w("ms", msFont)
        let px = x + pingSlot - (textW + 8)
        let pill = NSRect(x: px, y: 3, width: textW + 8, height: 16)
        let quiet = state == "quiet"
        if quiet {
          NSColor.black.setFill()
          NSBezierPath(roundedRect: pill, xRadius: 5, yRadius: 5).fill()
          NSGraphicsContext.current?.compositingOperation = .destinationOut
        }
        text(ping, pf, at: NSPoint(x: px + 4, y: pf === pingFont ? 6.5 : 7))
        text("ms", msFont, at: NSPoint(x: px + 4 + w(ping, pf) + 2, y: 6.5), alpha: quiet ? 1 : 0.7)
        NSGraphicsContext.current?.compositingOperation = .sourceOver
        if state == "warn" {
          NSColor.black.setFill()
          NSBezierPath(ovalIn: NSRect(x: pill.maxX - 5, y: 14, width: 5, height: 5)).fill()
        }
        x += pingSlot + (showTraffic ? 3 : 0)
      } else if state != "idle" {
        NSColor.black.setFill()
        NSBezierPath(ovalIn: NSRect(x: 5, y: 8, width: 6, height: 6)).fill()
      }
      if let up, let down {
        // Arrows sit right next to each number; both lines right-aligned.
        let right = x + rateSlot
        let aw = w("↑", arrowFont) + 1.5
        text(up, rateFont, at: NSPoint(x: right - w(up, rateFont), y: 12))
        text("↑", arrowFont, at: NSPoint(x: right - w(up, rateFont) - aw, y: 12.5), alpha: 0.6)
        text(down, rateFont, at: NSPoint(x: right - w(down, rateFont), y: 1.5))
        text("↓", arrowFont, at: NSPoint(x: right - w(down, rateFont) - aw, y: 2), alpha: 0.6)
      }
      return true
    }
    img.isTemplate = true
    return img
  }

  /// Offline rendering for previews and tests.
  static func render(to path: String, state: String, ping: String?, up: String?, down: String?) -> (width: CGFloat, height: CGFloat)? {
    let img = image(state: state, ping: ping, up: up, down: down)
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(img.size.width * 2), pixelsHigh: Int(img.size.height * 2), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
    rep.size = img.size
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    img.draw(in: NSRect(origin: .zero, size: img.size))
    NSGraphicsContext.restoreGraphicsState()
    guard let png = rep.representation(using: .png, properties: [:]), (try? png.write(to: URL(fileURLWithPath: path))) != nil else { return nil }
    return (img.size.width, img.size.height)
  }

  static func handle(_ cmd: [String: Any]) {
    let state = cmd["state"] as? String ?? "idle"
    let ping = cmd["ping"] as? String, up = cmd["up"] as? String, down = cmd["down"] as? String
    if let path = cmd["path"] as? String, path.hasSuffix(".png") {
      if let r = render(to: path, state: state, ping: ping, up: up, down: down) {
        emit(["type": "tray-image", "path": path, "width": r.width, "height": r.height])
      }
      return
    }
    StatusItem.shared.show(image(state: state, ping: ping, up: up, down: down))
  }
}

/// NSStatusItem owned by the helper; clicks are reported to the app with the item's
/// frame (Cocoa coordinates) and the screen layout, so the app can place its popover.
final class StatusItem: NSObject {
  static let shared = StatusItem()
  private var item: NSStatusItem?

  func show(_ img: NSImage) {
    if item == nil {
      let it = NSStatusBar.system.statusItem(withLength: img.size.width + 4)
      it.button?.target = self
      it.button?.action = #selector(clicked)
      it.button?.imagePosition = .imageOnly
      it.button?.setAccessibilityLabel("Quietlink")
      item = it
    }
    if abs((item!.length) - (img.size.width + 4)) > 0.5 { item!.length = img.size.width + 4 }
    item!.button?.image = img
  }

  @objc private func clicked() {
    guard let b = item?.button, let win = b.window else { return }
    let f = win.convertToScreen(b.convert(b.bounds, to: nil))
    emit(["type": "tray-clicked", "x": f.origin.x, "y": f.origin.y, "width": f.width, "height": f.height,
          "screens": screensSnapshot()["screens"] ?? []])
  }
}
