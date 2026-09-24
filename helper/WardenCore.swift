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
  private(set) var epoch = 0
  private(set) var token: Int?
  private(set) var leaseUntil: Double = 0
  private(set) var restoredByWarden = 0
  private(set) var reenables = 0
  private var recoveryIntent: [WardenCommand] = []

  var holding: Bool { token != nil }

  mutating func startup(state: WardenPersisted, bootId: String, now: Double) -> [WardenCommand] {
    recovering = true
    var s = state
    var cmds: [WardenCommand] = []
    if s.bootId != bootId {
      s.tookDown = false  // AWDL is up after boot; Wi-Fi power may not be.
    } else if s.tookDown {
      cmds.append(.up)
      s.tookDown = false
    }
    if let iface = s.pendingWifiOn { cmds.append(.wifiOn(iface)) }
    s.bootId = bootId
    persisted = s
    recoveryIntent = cmds
    if !cmds.isEmpty || state.bootId != bootId { cmds.append(.persist) }
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

  mutating func finishRecovery() -> [WardenCommand] {
    recovering = false
    recoveryIntent = []
    return []
  }

  mutating func handle(_ req: WardenRequest, now: Double, awdlUp: Bool?) -> (WardenReply, [WardenCommand]) {
    let ok = WardenReply(id: req.id, ok: true)
    func fail(_ e: String) -> (WardenReply, [WardenCommand]) { (WardenReply(id: req.id, ok: false, error: e), []) }
    switch req {
    case .ping, .status:
      return (ok, [])
    case .hold(_, let ttl):
      if recovering { return fail("recovering") }
      if holding { return fail("busy") }
      guard let up = awdlUp else { return fail("command-failed") }
      epoch += 1
      token = epoch
      leaseUntil = now + ttl
      var r = ok
      r.token = epoch
      if up {
        persisted.tookDown = true
        return (r, [.persist, .down])
      }
      return (r, [])
    case .renew(_, let t):
      guard let cur = token, cur == t, now <= leaseUntil else { return fail("lease-expired") }
      leaseUntil = max(leaseUntil, now + 4000)
      return (ok, [])
    case .release(_, let t):
      guard let cur = token, cur == t else { return fail("lease-expired") }
      return (ok, endLease())
    case .restoreNow:
      return (ok, endLease())
    case .reconnectWifi(_, let iface):
      if recovering { return fail("recovering") }
      if holding { return fail("busy") }
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
    if awdlUp == true, persisted.tookDown {
      reenables += 1
      return [.down]
    }
    return []
  }

  mutating func wifiObserved(on: Bool) -> [WardenCommand] {
    guard on, persisted.pendingWifiOn != nil else { return [] }
    persisted.pendingWifiOn = nil
    return [.persist]
  }

  /// SIGTERM/logout: restore everything the warden changed.
  mutating func shutdown() -> [WardenCommand] {
    var cmds = endLease().filter { $0 != .persist }
    if let iface = persisted.pendingWifiOn { cmds.append(.wifiOn(iface)) }
    cmds.append(.persist)
    return cmds
  }

  private mutating func endLease() -> [WardenCommand] {
    token = nil
    leaseUntil = 0
    if persisted.tookDown {
      persisted.tookDown = false
      return [.up, .persist]
    }
    return [.persist]
  }
}
