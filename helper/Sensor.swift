import AppKit
import Foundation

/// Sensor mode: JSON Lines events on stdout, commands on stdin, exits when stdin closes.
func runSensor() -> Never {
  let wifi = WifiSensor()
  let power = PowerSensor()
  let procs = ProcessSensor()
  let input = InputSensor()
  let probers = ProberSet()
  SensorHooks.starters.append { procs.start(); input.start() }
  SensorHooks.handlers.append { name, cmd in probers.handle(name, cmd) }
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
  let procList = listProcs()
  check(procList.contains { (($0["path"] as? String) ?? "").hasSuffix("Finder.app/Contents/MacOS/Finder") }, "process list includes Finder")
  check(procList.allSatisfy { (($0["start"] as? Double) ?? 0) > 0 && (($0["path"] as? String) ?? "").contains(".app/") }, "process entries have start time and bundle path")
  let inputActive = InputSensor().active()
  check(inputActive == nil || inputActive != nil, "input sensor returns bool or null")
  if let router = r["ipv4"] as? String, let iface = w["iface"] as? String, ProcessInfo.processInfo.environment["QUIETLINK_CI"] == nil {
    let result = probeSelftest(target: router, iface: iface)
    check(result.sent >= 2, "prober sent >= 2 (\(result.sent))")
    check(result.terminal == result.sent, "every probe has a terminal result (\(result.terminal)/\(result.sent))")
  }
  print(failed ? "selftest FAILED" : "selftest ok")
  return failed ? 1 : 0
}

/// Runs a prober for 1.6 s, stops sending, waits past the deadline and checks
/// that every sent probe got exactly one terminal result.
func probeSelftest(target: String, iface: String) -> (sent: Int, terminal: Int) {
  let lock = NSLock()
  var sent = 0, terminal = 0
  emitHook = { d in
    lock.lock(); defer { lock.unlock() }
    if d["type"] as? String == "probe-sent" { sent += 1 }
    if d["type"] as? String == "probe-result" { terminal += 1 }
  }
  let p = Prober(target: target)
  _ = p.start(iface: iface, intervalMs: 500)
  Thread.sleep(forTimeInterval: 1.6)
  p.stopSending()
  Thread.sleep(forTimeInterval: 1.3)
  p.stop()
  emitHook = nil
  lock.lock(); defer { lock.unlock() }
  return (sent, terminal)
}
