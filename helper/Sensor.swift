import AppKit
import Foundation

/// Sensor mode: JSON Lines events on stdout, commands on stdin, exits when stdin closes.
func runSensor() -> Never {
  let wifi = WifiSensor()
  let power = PowerSensor()
  var lastIface: String? = CWWiFiClientInterfaceName()
  power.onNetChange = {
    lastIface = CWWiFiClientInterfaceName()
    emit(routerSnapshot(iface: lastIface))
  }
  DispatchQueue.main.async {
    wifi.start()
    power.start()
    emit(routerSnapshot(iface: lastIface))
    SensorHooks.start()
  }
  Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in emit(["type": "heartbeat"]) }
  Thread.detachNewThread {
    while let line = readLine() {
      guard let data = line.data(using: .utf8),
            let cmd = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            (cmd["v"] as? Int) == protocolVersion, let name = cmd["cmd"] as? String else { continue }
      DispatchQueue.main.async {
        if name == "snapshot" {
          wifi.publish()
          emit(routerSnapshot(iface: lastIface))
        }
        SensorHooks.command(name, cmd)
      }
    }
    exit(0)
  }
  RunLoop.main.run()
  exit(0)
}

/// Extension points filled in by later sensors (processes, input, prober).
enum SensorHooks {
  static var starters: [() -> Void] = []
  static var handlers: [(String, [String: Any]) -> Void] = []
  static func start() { starters.forEach { $0() } }
  static func command(_ name: String, _ cmd: [String: Any]) { handlers.forEach { $0(name, cmd) } }
}

import CoreWLAN
func CWWiFiClientInterfaceName() -> String? { CWWiFiClient.shared().interface()?.interfaceName }

/// Returns 0 when every sensor yields a well-formed sample or a declared "unavailable".
func runSelftest() -> Int32 {
  var failed = false
  func check(_ ok: Bool, _ name: String) {
    print(ok ? "ok \(name)" : "FAIL \(name)")
    if !ok { failed = true }
  }
  let w = wifiSnapshot()
  check(w["type"] as? String == "wifi", "wifi type")
  check(["2.4", "5", "6"].contains(w["band"] as? String ?? "") || w["band"] is NSNull, "wifi band value")
  check(w["channel"] is Int || w["channel"] is NSNull, "wifi channel value")
  let r = routerSnapshot(iface: w["iface"] as? String)
  check(r["type"] as? String == "router", "router type")
  check(r["ipv4"] is String || r["ipv4"] is NSNull, "router ipv4 value")
  let s = screensSnapshot()
  check(((s["screens"] as? [Any])?.count ?? 0) >= 1, "screens")
  for extra in SelftestHooks.checks { let (ok, name) = extra(); check(ok, name) }
  print(failed ? "selftest FAILED" : "selftest ok")
  return failed ? 1 : 0
}

enum SelftestHooks {
  static var checks: [() -> (Bool, String)] = []
}
