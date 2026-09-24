import CoreWLAN
import Foundation

/// Current association only. Never scans: scanning is what causes the cuts.
func wifiSnapshot() -> [String: Any] {
  guard let iface = CWWiFiClient.shared().interface() else {
    return ["type": "wifi", "iface": NSNull(), "band": NSNull(), "channel": NSNull(), "widthMHz": NSNull(),
            "rssi": NSNull(), "noise": NSNull(), "phyRateMbps": NSNull(), "powerOn": NSNull()]
  }
  let ch = iface.wlanChannel()
  var band: Any = NSNull()
  switch ch?.channelBand {
  case .band2GHz?: band = "2.4"
  case .band5GHz?: band = "5"
  case .band6GHz?: band = "6"
  default: break
  }
  var width: Any = NSNull()
  switch ch?.channelWidth {
  case .width20MHz?: width = 20
  case .width40MHz?: width = 40
  case .width80MHz?: width = 80
  case .width160MHz?: width = 160
  default:
    if let raw = ch?.channelWidth.rawValue, raw == 5 { width = 320 }
  }
  let associated = ch != nil
  let rssi = iface.rssiValue()
  let noise = iface.noiseMeasurement()
  let rate = iface.transmitRate()
  return [
    "type": "wifi",
    "iface": orNull(iface.interfaceName),
    "band": band,
    "channel": orNull(ch?.channelNumber),
    "widthMHz": width,
    "rssi": associated && rssi != 0 ? rssi : NSNull(),
    "noise": associated && noise != 0 ? noise : NSNull(),
    "phyRateMbps": associated && rate > 0 ? rate : NSNull(),
    "powerOn": iface.powerOn(),
  ]
}

final class WifiSensor: NSObject, CWEventDelegate {
  private var timer: Timer?
  func start() {
    let client = CWWiFiClient.shared()
    client.delegate = self
    for ev in [CWEventType.linkDidChange, .modeDidChange, .powerDidChange, .ssidDidChange, .bssidDidChange] {
      try? client.startMonitoringEvent(with: ev)
    }
    publish()
    timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.publish() }
  }

  /// Emits on every change event and every 5 s as a keep-alive of the reading.
  func publish() {
    emit(wifiSnapshot())
  }

  func linkDidChangeForWiFiInterface(withName interfaceName: String) { DispatchQueue.main.async { self.publish() } }
  func modeDidChangeForWiFiInterface(withName interfaceName: String) { DispatchQueue.main.async { self.publish() } }
  func powerStateDidChangeForWiFiInterface(withName interfaceName: String) { DispatchQueue.main.async { self.publish() } }
  func bssidDidChangeForWiFiInterface(withName interfaceName: String) { DispatchQueue.main.async { self.publish() } }
  func ssidDidChangeForWiFiInterface(withName interfaceName: String) { DispatchQueue.main.async { self.publish() } }
}
