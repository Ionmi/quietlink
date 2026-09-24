import Foundation

/// `--test-warden`: assertion tests for the pure warden core.
func runWardenTests() -> Int32 {
  var failed = false
  func check(_ c: Bool, _ name: String) {
    print(c ? "ok \(name)" : "FAIL \(name)")
    if !c { failed = true }
  }

  var w = WardenCore()
  _ = w.finishRecovery()
  var (r, cmds) = w.handle(.hold(id: 1, ttlMs: 4000), now: 0, awdlUp: true)
  check(r.ok && r.token == 1 && cmds == [.persist, .down], "hold takes down and persists first")
  (r, cmds) = w.handle(.renew(id: 2, token: 1), now: 3000, awdlUp: false)
  check(r.ok && cmds.isEmpty, "renew extends")
  check(w.tick(now: 6999, awdlUp: false) == [], "no expiry before ttl after renew")
  check(w.tick(now: 7001, awdlUp: false) == [.up, .persist], "expiry restores when tookDown")
  check(w.restoredByWarden == 1, "expiry counts as warden restore")
  (r, cmds) = w.handle(.renew(id: 3, token: 1), now: 7002, awdlUp: true)
  check(!r.ok && r.error == "lease-expired" && cmds.isEmpty, "stale token rejected before execution")

  var w2 = WardenCore()
  _ = w2.finishRecovery()
  (r, cmds) = w2.handle(.hold(id: 1, ttlMs: 4000), now: 0, awdlUp: false)
  check(r.ok && cmds == [], "already down: no down, tookDown false")
  check(w2.tick(now: 5000, awdlUp: false) == [.persist], "already down: expiry never brings up")

  var w3 = WardenCore()
  _ = w3.finishRecovery()
  _ = w3.handle(.hold(id: 1, ttlMs: 4000), now: 0, awdlUp: true)
  check(w3.tick(now: 1000, awdlUp: true) == [.down], "reconcile re-applies down when macOS re-enables")
  check(w3.reenables == 1, "reconcile counts re-enables")
  (r, cmds) = w3.handle(.hold(id: 2, ttlMs: 4000), now: 1500, awdlUp: false)
  check(!r.ok && r.error == "busy", "second hold while holding is refused")

  var w4 = WardenCore()
  let c4 = w4.startup(state: WardenPersisted(bootId: "B", tookDown: true, pendingWifiOn: nil), bootId: "B", now: 0)
  check(c4 == [.up, .persist], "restores on start when tookDown and no lease")
  (r, _) = w4.handle(.hold(id: 9, ttlMs: 4000), now: 1, awdlUp: true)
  check(r.error == "recovering", "hold rejected while recovering")
  (r, _) = w4.handle(.reconnectWifi(id: 11, iface: "en0"), now: 1, awdlUp: true)
  check(r.error == "recovering", "reconnect rejected while recovering")
  (r, _) = w4.handle(.ping(id: 10), now: 1, awdlUp: true)
  check(r.ok, "ping answered while recovering")
  check(w4.convergence(awdlUp: true, wifiOn: true) == [], "convergence: nothing when restored")
  check(w4.convergence(awdlUp: false, wifiOn: true) == [.up], "convergence re-applies up after late orphan down")
  _ = w4.finishRecovery()
  (r, _) = w4.handle(.hold(id: 12, ttlMs: 4000), now: 2, awdlUp: true)
  check(r.ok, "hold accepted after recovery")

  var w5 = WardenCore()
  let c5 = w5.startup(state: WardenPersisted(bootId: "OLD", tookDown: true, pendingWifiOn: "en0"), bootId: "NEW", now: 0)
  check(c5 == [.wifiOn("en0"), .persist], "new boot drops AWDL record but keeps wifi restore")
  check(w5.persisted.tookDown == false, "new boot clears tookDown")

  var w6 = WardenCore()
  _ = w6.finishRecovery()
  _ = w6.handle(.hold(id: 1, ttlMs: 4000), now: 0, awdlUp: true)
  (r, cmds) = w6.handle(.release(id: 2, token: 1), now: 10, awdlUp: false)
  check(r.ok && cmds == [.up, .persist], "release restores")
  (r, cmds) = w6.handle(.release(id: 3, token: 1), now: 11, awdlUp: true)
  check(!r.ok && r.error == "lease-expired" && cmds.isEmpty, "double release rejected")
  (r, cmds) = w6.handle(.reconnectWifi(id: 4, iface: "en0"), now: 20, awdlUp: true)
  check(r.ok && cmds == [.persist, .wifiOff("en0")], "reconnect persists pending before off")
  check(w6.persisted.pendingWifiOn == "en0", "pending wifi recorded")
  check(w6.wifiObserved(on: true) == [.persist], "wifi observed on clears pending")
  check(w6.persisted.pendingWifiOn == nil, "pending cleared")

  var w7 = WardenCore()
  _ = w7.finishRecovery()
  _ = w7.handle(.hold(id: 1, ttlMs: 4000), now: 0, awdlUp: true)
  (r, cmds) = w7.handle(.restoreNow(id: 2), now: 5, awdlUp: false)
  check(r.ok && cmds == [.up, .persist], "restore-now brings AWDL up")
  (r, _) = w7.handle(.renew(id: 3, token: 1), now: 6, awdlUp: true)
  check(r.error == "lease-expired", "restore-now invalidates token")
  (r, cmds) = w7.handle(.reconnectWifi(id: 4, iface: "en0"), now: 7, awdlUp: true)
  check(r.ok, "reconnect allowed when not holding")

  var w8 = WardenCore()
  _ = w8.finishRecovery()
  _ = w8.handle(.hold(id: 1, ttlMs: 4000), now: 0, awdlUp: true)
  (r, _) = w8.handle(.reconnectWifi(id: 2, iface: "en0"), now: 1, awdlUp: false)
  check(r.error == "busy", "reconnect refused while holding")

  var w9 = WardenCore()
  _ = w9.finishRecovery()
  _ = w9.handle(.hold(id: 1, ttlMs: 4000), now: 0, awdlUp: true)
  check(w9.shutdown() == [.up, .persist], "SIGTERM restores AWDL")
  var w10 = WardenCore()
  _ = w10.finishRecovery()
  _ = w10.handle(.reconnectWifi(id: 1, iface: "en0"), now: 0, awdlUp: true)
  check(w10.shutdown() == [.wifiOn("en0"), .persist], "SIGTERM restores pending wifi")

  var w11 = WardenCore()
  _ = w11.finishRecovery()
  (r, _) = w11.handle(.hold(id: 1, ttlMs: 4000), now: 0, awdlUp: nil)
  check(!r.ok && r.error == "command-failed", "hold refused when AWDL state unknown")

  print(failed ? "warden tests FAILED" : "warden tests ok")
  return failed ? 1 : 0
}
