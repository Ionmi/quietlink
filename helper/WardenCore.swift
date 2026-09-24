import Foundation

/// Commands the warden executes, in order. `persist` writes durable state.
enum WardenCommand: Equatable {
  case down, up, wifiOff(String), wifiOn(String), persist
}

enum WardenRequest: Equatable {
  case ping(id: Int)
  case hold(id: Int, ttlMs: Double)
  case renew(id: Int, token: Int)
  case release(id: Int, token: Int)
  case restoreNow(id: Int)
  case reconnectWifi(id: Int, iface: String)
  case status(id: Int)

  var id: Int {
    switch self {
    case .ping(let id), .hold(let id, _), .renew(let id, _), .release(let id, _), .restoreNow(let id), .reconnectWifi(let id, _), .status(let id): return id
    }
  }
}

struct WardenReply: Equatable {
  var id: Int
  var ok: Bool
  var token: Int?
  var error: String?
}

struct WardenPersisted: Codable, Equatable {
  var bootId: String
  var tookDown: Bool
  var pendingWifiOn: String?
}

/// Pure warden logic: dead-man leases with warden-issued tokens and the single
/// restore rule (bring AWDL up only if the warden brought it down).
struct WardenCore {
  private(set) var persisted = WardenPersisted(bootId: "", tookDown: false, pendingWifiOn: nil)
  private(set) var recovering = true
  /// Tokens are unique across warden restarts, so an old client's token never matches a new lease.
  private(set) var epoch = Int.random(in: 1_000_000...1_000_000_000)
  private(set) var ttl: Double = 4000
  /// True while an `up` has been issued but not yet confirmed; no new lease until it resolves.
  private(set) var restorePending = false
  private(set) var token: Int?
  private(set) var leaseUntil: Double = 0
  private(set) var restoredByWarden = 0
  private(set) var reenables = 0
  private var recoveryIntent: [WardenCommand] = []

  var holding: Bool { token != nil }

  /// Loads durable intent before any handler (socket, SIGTERM) can run.
  mutating func load(_ state: WardenPersisted) {
    persisted = state
    recovering = true
  }

  func leaseValid(now: Double) -> Bool { token != nil && now <= leaseUntil }

  mutating func startup(state: WardenPersisted, bootId: String, now: Double) -> [WardenCommand] {
    recovering = true
    var s = state
    var cmds: [WardenCommand] = []
    if s.bootId != bootId {
      s.tookDown = false  // AWDL is up after boot; Wi-Fi power may not be.
    } else if s.tookDown {
      cmds.append(.up)  // tookDown stays true until the restore is confirmed
      restorePending = true
    }
    if let iface = s.pendingWifiOn { cmds.append(.wifiOn(iface)) }
    s.bootId = bootId
    persisted = s
    recoveryIntent = cmds
    if state.bootId != bootId { cmds.append(.persist) }
    return cmds
  }

  /// Convergence check during recovery: re-apply restores that a late orphaned command undid.
  func convergence(awdlUp: Bool?, wifiOn: Bool?) -> [WardenCommand] {
    var cmds: [WardenCommand] = []
    for c in recoveryIntent {
      if c == .up, awdlUp == false { cmds.append(.up) }
      if case .wifiOn = c, wifiOn == false { cmds.append(c) }
    }
    return cmds
  }

  /// Recovery ends only when every restore it intended is observed done.
  mutating func finishRecovery(awdlUp: Bool? = nil, wifiOn: Bool? = nil) -> Bool {
    for c in recoveryIntent {
      if c == .up, awdlUp != true { return false }
      if case .wifiOn = c, wifiOn != true { return false }
    }
    recovering = false
    recoveryIntent = []
    return true
  }

  /// `up` succeeded and was observed: the warden no longer owes a restore.
  mutating func restoreConfirmed() -> [WardenCommand] {
    guard restorePending || persisted.tookDown else { return [] }
    restorePending = false
    persisted.tookDown = false
    return [.persist]
  }

  mutating func handle(_ req: WardenRequest, now: Double, awdlUp: Bool?) -> (WardenReply, [WardenCommand]) {
    let ok = WardenReply(id: req.id, ok: true)
    func fail(_ e: String) -> (WardenReply, [WardenCommand]) { (WardenReply(id: req.id, ok: false, error: e), []) }
    switch req {
    case .ping, .status:
      return (ok, [])
    case .hold(_, let requested):
      if recovering { return fail("recovering") }
      if holding || restorePending || persisted.pendingWifiOn != nil { return fail("busy") }
      guard let up = awdlUp else { return fail("command-failed") }
      epoch += 1
      token = epoch
      ttl = requested
      leaseUntil = now + requested
      var r = ok
      r.token = epoch
      if up {
        persisted.tookDown = true
        return (r, [.persist, .down])
      }
      return (r, [])
    case .renew(_, let t):
      guard let cur = token, cur == t, now <= leaseUntil else { return fail("lease-expired") }
      leaseUntil = max(leaseUntil, now + ttl)
      return (ok, [])
    case .release(_, let t):
      guard let cur = token, cur == t else { return fail("lease-expired") }
      return (ok, endLease())
    case .restoreNow:
      if recovering { return fail("recovering") }
      return (ok, endLease())
    case .reconnectWifi(_, let iface):
      if recovering { return fail("recovering") }
      if holding || restorePending || persisted.pendingWifiOn != nil { return fail("busy") }
      persisted.pendingWifiOn = iface
      return (ok, [.persist, .wifiOff(iface)])
    }
  }

  /// Once per second: expire the lease or reconcile AWDL back down.
  mutating func tick(now: Double, awdlUp: Bool?) -> [WardenCommand] {
    guard holding else { return [] }
    if now > leaseUntil {
      if persisted.tookDown { restoredByWarden += 1 }
      return endLease()
    }
    if awdlUp == true, persisted.tookDown, !restorePending {
      reenables += 1
      return [.down]
    }
    return []
  }

  /// Reconnect intent could not be persisted before any change: forget it.
  mutating func cancelReconnect() {
    persisted.pendingWifiOn = nil
  }

  mutating func wifiObserved(on: Bool) -> [WardenCommand] {
    guard on, persisted.pendingWifiOn != nil else { return [] }
    persisted.pendingWifiOn = nil
    return [.persist]
  }

  /// SIGTERM/logout: restore everything the warden changed.
  mutating func shutdown() -> [WardenCommand] {
    var cmds = endLease()
    if persisted.tookDown, !cmds.contains(.up) { cmds.append(.up) }
    if let iface = persisted.pendingWifiOn { cmds.append(.wifiOn(iface)) }
    return cmds
  }

  private mutating func endLease() -> [WardenCommand] {
    token = nil
    leaseUntil = 0
    if persisted.tookDown {
      restorePending = true
      return [.up]
    }
    return []
  }
}
