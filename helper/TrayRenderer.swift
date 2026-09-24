import AppKit

/// Renders the whole menu-bar item as one template image, so the layout is stacked
/// (upload over download) and the width never changes with the numbers.
/// Template images are black + alpha; macOS tints them for light/dark menu bars.
enum TrayRenderer {
  static let height: CGFloat = 22
  static let pingFont = NSFont.monospacedDigitSystemFont(ofSize: 13, weight: .semibold)
  static let msFont = NSFont.systemFont(ofSize: 10, weight: .medium)
  static let rateFont = NSFont.monospacedDigitSystemFont(ofSize: 9.5, weight: .medium)
  static let unitFont = NSFont.systemFont(ofSize: 8, weight: .medium)

  static func textWidth(_ s: String, _ f: NSFont) -> CGFloat {
    ceil((s as NSString).size(withAttributes: [.font: f]).width)
  }

  /// Fixed slots: ping up to 3 digits, rates up to 4 characters ("2400", "56.7").
  static func layout(showPing: Bool, showTraffic: Bool) -> (width: CGFloat, pingX: CGFloat, pingSlot: CGFloat, ratesX: CGFloat, rateSlot: CGFloat, arrowW: CGFloat) {
    var x: CGFloat = 18  // crescent
    let pingSlot = textWidth("888", pingFont)
    let rateSlot = textWidth("8888", rateFont)
    let arrowW = textWidth("↓", rateFont)
    var pingX: CGFloat = 0, ratesX: CGFloat = 0
    if showPing { x += 3; pingX = x; x += pingSlot + 2 + textWidth("ms", msFont) }
    if showTraffic { x += 6; ratesX = x; x += arrowW + 2 + rateSlot + 2 + textWidth("Mb/s", unitFont) }
    return (ceil(x + 1), pingX, pingSlot, ratesX, rateSlot, arrowW)
  }

  static func crescent(in r: NSRect, filled: Bool, mark: Bool) {
    // Same geometry as icons/tray-*.svg (36-unit box), scaled into r.
    let s = r.width / 36
    let t = NSAffineTransform()
    t.translateX(by: r.minX, yBy: r.maxY)
    t.scaleX(by: s, yBy: -s)
    let p = NSBezierPath()
    p.move(to: NSPoint(x: 20, y: 5.5))
    p.appendArc(withCenter: NSPoint(x: 20.3, y: 18), radius: 12.5, startAngle: -91.4, endAngle: 69, clockwise: true)
    p.appendArc(withCenter: NSPoint(x: 26.2, y: 14.8), radius: 10, startAngle: 99.3, endAngle: -116.4, clockwise: false)
    p.close()
    p.transform(using: t as AffineTransform)
    NSColor.black.set()
    if filled { p.fill() } else { p.lineWidth = 2.6 * s; p.lineJoinStyle = .round; p.stroke() }
    if mark {
      let d = 9 * s
      NSBezierPath(ovalIn: NSRect(x: r.minX + 23.5 * s, y: r.maxY - 31.5 * s, width: d, height: d)).fill()
    }
  }

  static func draw(_ s: String, font: NSFont, rightAt: CGFloat, baselineY: CGFloat, alpha: CGFloat = 1) {
    let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.black.withAlphaComponent(alpha)]
    let w = (s as NSString).size(withAttributes: attrs).width
    (s as NSString).draw(at: NSPoint(x: rightAt - w, y: baselineY + font.descender), withAttributes: attrs)
  }

  /// Writes a @2x PNG and returns its size in points.
  static func render(to path: String, state: String, ping: String?, up: String?, down: String?) -> (width: CGFloat, height: CGFloat)? {
    let showPing = ping != nil, showTraffic = up != nil && down != nil
    let L = layout(showPing: showPing, showTraffic: showTraffic)
    let size = NSSize(width: L.width, height: height)
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width * 2), pixelsHigh: Int(size.height * 2), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
    rep.size = size
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    crescent(in: NSRect(x: 1, y: 3, width: 16, height: 16), filled: state == "quiet", mark: state == "warn")
    if let ping {
      draw(ping, font: pingFont, rightAt: L.pingX + L.pingSlot, baselineY: 6)
      draw("ms", font: msFont, rightAt: L.pingX + L.pingSlot + 2 + textWidth("ms", msFont), baselineY: 6, alpha: 0.75)
    }
    if let up, let down {
      let numRight = L.ratesX + L.arrowW + 2 + L.rateSlot
      draw("↑", font: rateFont, rightAt: L.ratesX + L.arrowW, baselineY: 12.5, alpha: 0.75)
      draw(up, font: rateFont, rightAt: numRight, baselineY: 12.5)
      draw("↓", font: rateFont, rightAt: L.ratesX + L.arrowW, baselineY: 2, alpha: 0.75)
      draw(down, font: rateFont, rightAt: numRight, baselineY: 2)
      draw("Mb/s", font: unitFont, rightAt: numRight + 2 + textWidth("Mb/s", unitFont), baselineY: 7.5, alpha: 0.6)
    }
    NSGraphicsContext.restoreGraphicsState()
    guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
    let tmp = path + ".tmp"
    guard (try? png.write(to: URL(fileURLWithPath: tmp))) != nil, rename(tmp, path) == 0 else { return nil }
    return (size.width, size.height)
  }

  static func handle(_ cmd: [String: Any]) {
    guard let path = cmd["path"] as? String, path.hasSuffix(".png") else { return }
    let state = cmd["state"] as? String ?? "idle"
    if let r = render(to: path, state: state, ping: cmd["ping"] as? String, up: cmd["up"] as? String, down: cmd["down"] as? String) {
      emit(["type": "tray-image", "path": path, "width": r.width, "height": r.height])
    }
  }
}
