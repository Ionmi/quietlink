import Foundation

/// `--test-warden`: assertion tests for the pure warden core.
func runWardenTests() -> Int32 {
  var failed = false
  func check(_ c: Bool, _ name: String) {
    print(c ? "ok \(name)" : "FAIL \(name)")
    if !c { failed = true }
  }
  func ready() -> WardenCore {
    var w = WardenCore()
    w.load(WardenPersisted(bootId: "B", tookDown: false, pendingWifiOn: nil))
    _ = w.finishRecovery()
    return w
  }

  var w = ready()
  var (r, cmds) = w.handle(.hold(id: 1, ttlMs: 4000), now: 0, awdlUp: true)
  let t1 = r.token ?? -1
  check(r.ok && r.token != nil && cmds == [.persist, .down], "hold takes down and persists first")
  (r, cmds) = w.handle(.renew(id: 2, token: t1), now: 3000, awdlUp: false)
  check(r.ok && cmds.isEmpty, "renew extends")
  check(w.tick(now: 6999, awdlUp: false) == [], "no expiry before ttl after renew")
  check(w.tick(now: 7001, awdlUp: false) == [.up], "expiry issues up")
  check(w.persisted.tookDown, "tookDown kept until restore confirmed")
  (r, _) = w.handle(.hold(id: 3, ttlMs: 4000), now: 7002, awdlUp: false)
  check(r.error == "busy", "no new lease while restore pending")
  check(w.restoreConfirmed() == [.persist] && !w.persisted.tookDown, "confirmed restore clears tookDown")
  check(w.restoredByWarden == 1, "expiry counts as warden restore")
  (r, cmds) = w.handle(.renew(id: 4, token: t1), now: 7003, awdlUp: true)
  check(!r.ok && r.error == "lease-expired" && cmds.isEmpty, "stale token rejected before execution")

  check(WardenCore().epoch != WardenCore().epoch, "token space differs across warden instances")

  var w2 = ready()
  (r, cmds) = w2.handle(.hold(id: 1, ttlMs: 4000), now: 0, awdlUp: false)
  check(r.ok && cmds == [], "already down: no down, tookDown false")
  check(w2.tick(now: 5000, awdlUp: false) == [], "already down: expiry never brings up")

  var w3 = ready()
  _ = w3.handle(.hold(id: 1, ttlMs: 4000), now: 0, awdlUp: true)
  check(w3.tick(now: 1000, awdlUp: true) == [.down], "reconcile re-applies down when macOS re-enables")
  check(w3.reenables == 1, "reconcile counts re-enables")
  (r, _) = w3.handle(.hold(id: 2, ttlMs: 4000), now: 1500, awdlUp: false)
  check(!r.ok && r.error == "busy", "second hold while holding is refused")
  check(w3.leaseValid(now: 3999) && !w3.leaseValid(now: 4001), "lease validity window")

  var w4 = WardenCore()
  w4.load(WardenPersisted(bootId: "B", tookDown: true, pendingWifiOn: nil))
  (r, _) = w4.handle(.restoreNow(id: 1), now: 0, awdlUp: false)
  check(r.error == "recovering", "restore-now rejected before startup recovery")
  check(w4.shutdown() == [.up], "SIGTERM before recovery still restores loaded intent")
  var w4b = WardenCore()
  let c4 = w4b.startup(state: WardenPersisted(bootId: "B", tookDown: true, pendingWifiOn: nil), bootId: "B", now: 0)
  check(c4 == [.up] && w4b.persisted.tookDown, "restart issues up and keeps intent")
  (r, _) = w4b.handle(.hold(id: 9, ttlMs: 4000), now: 1, awdlUp: true)
  check(r.error == "recovering", "hold rejected while recovering")
  (r, _) = w4b.handle(.reconnectWifi(id: 11, iface: "en0"), now: 1, awdlUp: true)
  check(r.error == "recovering", "reconnect rejected while recovering")
  (r, _) = w4b.handle(.ping(id: 10), now: 1, awdlUp: true)
  check(r.ok, "ping answered while recovering")
  check(w4b.convergence(awdlUp: true, wifiOn: true) == [], "convergence: nothing when restored")
  check(w4b.convergence(awdlUp: false, wifiOn: true) == [.up], "convergence re-applies up after late orphan down")
  check(!w4b.finishRecovery(awdlUp: false), "recovery not finished while AWDL still down")
  check(w4b.finishRecovery(awdlUp: true), "recovery finishes once AWDL observed up")
  _ = w4b.restoreConfirmed()
  (r, _) = w4b.handle(.hold(id: 12, ttlMs: 4000), now: 2, awdlUp: true)
  check(r.ok, "hold accepted after recovery")

  var w5 = WardenCore()
  let c5 = w5.startup(state: WardenPersisted(bootId: "OLD", tookDown: true, pendingWifiOn: "en0"), bootId: "NEW", now: 0)
  check(c5 == [.wifiOn("en0"), .persist], "new boot drops AWDL record but keeps wifi restore")
  check(w5.persisted.tookDown == false && w5.persisted.pendingWifiOn == "en0", "new boot clears tookDown, keeps wifi")
  check(!w5.finishRecovery(awdlUp: true, wifiOn: false), "recovery waits for wifi on")

  var w6 = ready()
  let t6 = w6.handle(.hold(id: 1, ttlMs: 4000), now: 0, awdlUp: true).0.token!
  (r, cmds) = w6.handle(.release(id: 2, token: t6), now: 10, awdlUp: false)
  check(r.ok && cmds == [.up], "release restores")
  _ = w6.restoreConfirmed()
  (r, cmds) = w6.handle(.release(id: 3, token: t6), now: 11, awdlUp: true)
  check(!r.ok && r.error == "lease-expired" && cmds.isEmpty, "double release rejected")
  (r, cmds) = w6.handle(.reconnectWifi(id: 4, iface: "en0"), now: 20, awdlUp: true)
  check(r.ok && cmds == [.persist, .wifiOff("en0")], "reconnect persists pending before off")
  (r, _) = w6.handle(.reconnectWifi(id: 5, iface: "en1"), now: 21, awdlUp: true)
  check(r.error == "busy" && w6.persisted.pendingWifiOn == "en0", "overlapping reconnect refused, record kept")
  (r, _) = w6.handle(.hold(id: 6, ttlMs: 4000), now: 21, awdlUp: true)
  check(r.error == "busy", "no hold while wifi restore pending")
  check(w6.wifiObserved(on: false) == [], "wifi still off keeps pending")
  check(w6.wifiObserved(on: true) == [.persist] && w6.persisted.pendingWifiOn == nil, "wifi observed on clears pending")

  var w7 = ready()
  let t7 = w7.handle(.hold(id: 1, ttlMs: 4000), now: 0, awdlUp: true).0.token!
  (r, cmds) = w7.handle(.restoreNow(id: 2), now: 5, awdlUp: false)
  check(r.ok && cmds == [.up], "restore-now brings AWDL up")
  (r, _) = w7.handle(.renew(id: 3, token: t7), now: 6, awdlUp: true)
  check(r.error == "lease-expired", "restore-now invalidates token")

  var w8 = ready()
  _ = w8.handle(.hold(id: 1, ttlMs: 4000), now: 0, awdlUp: true)
  (r, _) = w8.handle(.reconnectWifi(id: 2, iface: "en0"), now: 1, awdlUp: false)
  check(r.error == "busy", "reconnect refused while holding")

  var w9 = ready()
  _ = w9.handle(.hold(id: 1, ttlMs: 4000), now: 0, awdlUp: true)
  check(w9.shutdown() == [.up], "SIGTERM restores AWDL")
  var w10 = ready()
  _ = w10.handle(.reconnectWifi(id: 1, iface: "en0"), now: 0, awdlUp: true)
  check(w10.shutdown() == [.wifiOn("en0")], "SIGTERM restores pending wifi")

  var w11 = ready()
  (r, _) = w11.handle(.hold(id: 1, ttlMs: 4000), now: 0, awdlUp: nil)
  check(!r.ok && r.error == "command-failed", "hold refused when AWDL state unknown")

  var w12 = ready()
  let t12 = w12.handle(.hold(id: 1, ttlMs: 2000), now: 0, awdlUp: true).0.token!
  _ = w12.handle(.renew(id: 2, token: t12), now: 1000, awdlUp: false)
  check(w12.tick(now: 3001, awdlUp: false) == [.up], "renew extends by the lease's own ttl")

  check(classifyReply(rttMs: 999, deadlineMs: 1000) == .reply, "reply before deadline is a reply")
  check(classifyReply(rttMs: 1000, deadlineMs: 1000) == .lateAfterLoss, "reply at deadline is loss + late")
  check(classifyReply(rttMs: 1400, deadlineMs: 1000) == .lateAfterLoss, "reply read after deadline is loss + late")

  print(failed ? "warden tests FAILED" : "warden tests ok")
  return failed ? 1 : 0
}
