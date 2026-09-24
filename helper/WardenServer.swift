import Darwin
import Foundation

/// Warden mode: LaunchAgent process, sole executor of AWDL and Wi-Fi power commands.
final class WardenServer {
  private var core = WardenCore()
  private let exec = WardenExecutor()
  private let main = DispatchQueue(label: "quietlink.warden.main")
  private let watchdogQueue = DispatchQueue(label: "quietlink.warden.watchdog")
  private var lastProgress = monotonicMs()
  private var lastError: String?
  private var privilege = false
  private var upRetryAt: Double?
  private var upRetryCount = 0
  private var listenFd: Int32 = -1
  private var sources: [DispatchSourceProtocol] = []
  private let t0 = monotonicMs()

  private func now() -> Double { monotonicMs() - t0 }

  func run() -> Never {
    do { try Paths.ensureSupportDir() } catch { logError("support dir: \(error)"); exit(1) }
    let lockFd = open(Paths.wardenLock, O_CREAT | O_RDWR, 0o600)
    guard lockFd >= 0, flock(lockFd, LOCK_EX | LOCK_NB) == 0 else {
      logError("another warden is running")
      exit(0)
    }
    privilege = exec.hasPrivilege()
    startSocket()
    startWatchdog()
    let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: main)
    signal(SIGTERM, SIG_IGN)
    term.setEventHandler { [weak self] in self?.terminate() }
    term.resume()
    sources.append(term)
    main.async { self.recover(started: monotonicMs()) }
    let tick = DispatchSource.makeTimerSource(queue: main)
    tick.schedule(deadline: .now() + 1, repeating: 1)
    tick.setEventHandler { [weak self] in self?.tick() }
    tick.resume()
    sources.append(tick)
    let priv = DispatchSource.makeTimerSource(queue: main)
    priv.schedule(deadline: .now() + 60, repeating: 60)
    priv.setEventHandler { [weak self] in self?.privilege = self?.exec.hasPrivilege() ?? false }
    priv.resume()
    sources.append(priv)
    dispatchMain()
  }

  // MARK: recovery (start-up barrier + convergence)

  private func recover(started: Double) {
    lastProgress = monotonicMs()
    let busy = commandProcessesVisible()
    if busy != false && monotonicMs() - started < 10_000 {
      main.asyncAfter(deadline: .now() + 0.25) { self.recover(started: started) }
      return
    }
    if busy != false { lastError = "recovery barrier timed out" }
    execute(core.startup(state: WardenStateStore.load(), bootId: bootSessionId(), now: now()))
    converge(remaining: 10)
  }

  private func converge(remaining: Int) {
    lastProgress = monotonicMs()
    execute(core.convergence(awdlUp: exec.awdlUp(), wifiOn: exec.wifiPowerOn()))
    if remaining > 0 {
      main.asyncAfter(deadline: .now() + 0.5) { self.converge(remaining: remaining - 1) }
    } else {
      _ = core.finishRecovery()
      logError("warden ready")
    }
  }

  // MARK: loop

  private func tick() {
    lastProgress = monotonicMs()
    if core.recovering { return }
    execute(core.tick(now: now(), awdlUp: exec.awdlUp()))
    if let on = exec.wifiPowerOn() { execute(core.wifiObserved(on: on)) }
    if let at = upRetryAt, monotonicMs() >= at, exec.awdlUp() == false {
      if exec.run(.up) { upRetryAt = nil; upRetryCount = 0; lastError = nil } else { scheduleUpRetry() }
    }
  }

  private func scheduleUpRetry() {
    let delays = [1000.0, 2000, 5000, 10_000, 30_000]
    upRetryAt = monotonicMs() + delays[min(upRetryCount, delays.count - 1)]
    upRetryCount += 1
  }

  private func execute(_ cmds: [WardenCommand]) {
    for c in cmds {
      switch c {
      case .persist:
        WardenStateStore.save(core.persisted)
      case .up:
        if !exec.run(.up) { lastError = "awdl up failed"; scheduleUpRetry() }
      case .down:
        if !exec.run(.down) { lastError = "awdl down failed" }
      case .wifiOff(let iface):
        if exec.run(.wifiOff(iface)) {
          main.asyncAfter(deadline: .now() + 3) { [weak self] in
            guard let self else { return }
            if !self.exec.run(.wifiOn(iface)) { self.lastError = "wifi on failed" }
          }
        } else {
          lastError = "wifi off failed"
          execute(core.wifiObserved(on: true))
        }
      case .wifiOn(let iface):
        if !exec.run(.wifiOn(iface)) { lastError = "wifi on failed" }
      }
      lastProgress = monotonicMs()
    }
  }

  private func terminate() {
    execute(core.shutdown())
    exit(0)
  }

  // MARK: hang watchdog

  private func startWatchdog() {
    let t = DispatchSource.makeTimerSource(queue: watchdogQueue)
    t.schedule(deadline: .now() + 1, repeating: 1)
    t.setEventHandler { [weak self] in
      guard let self else { return }
      if monotonicMs() - self.lastProgress > 3000 {
        logError("warden main loop stalled; fencing and exiting for launchd restart")
        self.exec.fence(wait: 3)
        exit(2)
      }
    }
    t.resume()
    sources.append(t)
  }

  // MARK: socket

  private func startSocket() {
    let path = Paths.wardenSocket
    unlink(path)
    listenFd = socket(AF_UNIX, SOCK_STREAM, 0)
    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    withUnsafeMutableBytes(of: &addr.sun_path) { buf in
      _ = path.withCString { strncpy(buf.baseAddress!.assumingMemoryBound(to: CChar.self), $0, buf.count - 1) }
    }
    let size = socklen_t(MemoryLayout<sockaddr_un>.size)
    let old = umask(0o177)
    let bound = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(listenFd, $0, size) } }
    umask(old)
    guard bound == 0, listen(listenFd, 8) == 0 else { logError("socket bind failed: \(errno)"); exit(1) }
    chmod(path, 0o600)
    let accept = DispatchSource.makeReadSource(fileDescriptor: listenFd, queue: DispatchQueue.global())
    accept.setEventHandler { [weak self] in
      guard let self else { return }
      let fd = Darwin.accept(self.listenFd, nil, nil)
      if fd >= 0 { Thread.detachNewThread { self.serve(fd) } }
    }
    accept.resume()
    sources.append(accept)
  }

  private func serve(_ fd: Int32) {
    let input = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    var buffer = Data()
    while true {
      let chunk = input.availableData
      if chunk.isEmpty { return }
      buffer.append(chunk)
      while let nl = buffer.firstIndex(of: 0x0A) {
        let line = buffer[buffer.startIndex..<nl]
        buffer.removeSubrange(buffer.startIndex...nl)
        let reply = main.sync { self.respond(to: Data(line)) }
        var out = (try? JSONSerialization.data(withJSONObject: reply, options: [.sortedKeys])) ?? Data()
        out.append(0x0A)
        out.withUnsafeBytes { _ = write(fd, $0.baseAddress, out.count) }
      }
    }
  }

  private func respond(to line: Data) -> [String: Any] {
    guard let obj = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
          (obj["v"] as? Int) == protocolVersion, let id = obj["id"] as? Int, let op = obj["op"] as? String else {
      return ["v": protocolVersion, "id": -1, "ok": false, "error": "bad-request"]
    }
    if op == "test-stall", ProcessInfo.processInfo.environment["QUIETLINK_DRY_RUN"] != nil {
      Thread.sleep(forTimeInterval: 6)  // dry-run only: exercises the hang watchdog
    }
    let req: WardenRequest?
    switch op {
    case "ping": req = .ping(id: id)
    case "status": req = .status(id: id)
    case "hold": req = .hold(id: id, ttlMs: min(max((obj["ttlMs"] as? Double) ?? 4000, 1000), 10_000))
    case "renew": req = (obj["token"] as? Int).map { .renew(id: id, token: $0) }
    case "release": req = (obj["token"] as? Int).map { .release(id: id, token: $0) }
    case "restore-now": req = .restoreNow(id: id)
    case "reconnect-wifi":
      // Interface names are validated: no arbitrary arguments reach networksetup.
      if let i = obj["iface"] as? String, i.range(of: "^en[0-9]{1,2}$", options: .regularExpression) != nil { req = .reconnectWifi(id: id, iface: i) } else { req = nil }
    default: req = nil
    }
    guard let req else { return ["v": protocolVersion, "id": id, "ok": false, "error": "bad-request"] }
    if case .hold = req, !privilege {
      privilege = exec.hasPrivilege()
      if !privilege { return ["v": protocolVersion, "id": id, "ok": false, "error": "no-privilege"] }
    }
    let awdl = exec.awdlUp()
    let (reply, cmds) = core.handle(req, now: now(), awdlUp: awdl)
    execute(cmds)
    var out: [String: Any] = ["v": protocolVersion, "id": reply.id, "ok": reply.ok]
    if let t = reply.token { out["token"] = t }
    if let e = reply.error { out["error"] = e }
    if case .hold = req, reply.ok, core.persisted.tookDown, exec.awdlUp() == true {
      // down command failed: surface it and give the lease back
      out = ["v": protocolVersion, "id": id, "ok": false, "error": "command-failed", "detail": lastError ?? "awdl down failed"]
      execute(core.handle(.restoreNow(id: id), now: now(), awdlUp: true).1)
    }
    out["status"] = [
      "awdlUp": orNull(exec.awdlUp()), "holding": core.holding, "tookDown": core.persisted.tookDown,
      "recovering": core.recovering, "privilege": privilege, "lastError": orNull(lastError),
      "wifiPending": core.persisted.pendingWifiOn != nil, "restoredByWarden": core.restoredByWarden,
      "reenables": core.reenables,
    ] as [String: Any]
    return out
  }
}
