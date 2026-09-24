import Darwin
import Foundation

/// Warden mode: LaunchAgent process, sole executor of AWDL and Wi-Fi power commands.
final class WardenServer {
  private var core = WardenCore()
  private let exec = WardenExecutor()
  private let main = DispatchQueue(label: "quietlink.warden.main")
  private let watchdogQueue = DispatchQueue(label: "quietlink.warden.watchdog")
  private let progressLock = NSLock()
  private var _lastProgress = monotonicMs()
  private var lastError: String?
  private var privilege = false
  private var upRetryAt: Double?
  private var upRetryCount = 0
  private var wifiOnAt: Double?
  private var wifiRetryCount = 0
  private var listenFd: Int32 = -1
  private var sources: [DispatchSourceProtocol] = []
  private let t0 = monotonicMs()
  private let statusLock = NSLock()
  private var statusSnapshot: [String: Any] = [:]
  private let connLock = NSLock()
  private var connections = 0
  private let dryRun = ProcessInfo.processInfo.environment["QUIETLINK_DRY_RUN"] != nil

  private func now() -> Double { monotonicMs() - t0 }
  private func progress() { progressLock.lock(); _lastProgress = monotonicMs(); progressLock.unlock() }
  private func sinceProgress() -> Double { progressLock.lock(); defer { progressLock.unlock() }; return monotonicMs() - _lastProgress }

  func run() -> Never {
    do { try Paths.ensureSupportDir() } catch { logError("support dir: \(error)"); exit(1) }
    let lockFd = open(Paths.wardenLock, O_CREAT | O_RDWR, 0o600)
    guard lockFd >= 0, flock(lockFd, LOCK_EX | LOCK_NB) == 0 else {
      logError("another warden is running")
      exit(0)
    }
    signal(SIGPIPE, SIG_IGN)
    // Durable intent is loaded before any handler can run.
    core.load(WardenStateStore.load())
    publishStatus()
    startWatchdog()
    let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: main)
    signal(SIGTERM, SIG_IGN)
    term.setEventHandler { [weak self] in self?.terminate() }
    term.resume()
    sources.append(term)
    startSocket()
    main.async {
      self.privilege = self.exec.hasPrivilege()
      self.recover(started: monotonicMs())
    }
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

  // MARK: recovery (start-up barrier + convergence until confirmed)

  private func recover(started: Double) {
    progress()
    let busy = commandProcessesVisible()
    if busy != false && monotonicMs() - started < 10_000 {
      main.asyncAfter(deadline: .now() + 0.25) { self.recover(started: started) }
      return
    }
    if busy != false { lastError = "recovery barrier timed out" }
    let cmds = core.startup(state: core.persisted, bootId: bootSessionId(), now: now())
    execute(cmds)
    converge(checks: 0)
  }

  private func converge(checks: Int) {
    progress()
    let awdl = exec.awdlUp()
    let wifi = exec.wifiPowerOn(core.persisted.pendingWifiOn)
    execute(core.convergence(awdlUp: awdl, wifiOn: wifi))
    if checks >= 10, core.finishRecovery(awdlUp: exec.awdlUp(), wifiOn: exec.wifiPowerOn(core.persisted.pendingWifiOn)) {
      if exec.awdlUp() == true { execute(core.restoreConfirmed()) }
      if exec.wifiPowerOn(core.persisted.pendingWifiOn) == true { execute(core.wifiObserved(on: true)) }
      lastError = nil
      logError("warden ready")
      publishStatus()
      return
    }
    if checks >= 10 { lastError = "restore not yet confirmed; retrying" }
    publishStatus()
    main.asyncAfter(deadline: .now() + (checks >= 10 ? 1 : 0.5)) { self.converge(checks: checks + 1) }
  }

  // MARK: loop

  private func tick() {
    progress()
    defer { publishStatus() }
    if core.recovering { return }
    execute(core.tick(now: now(), awdlUp: exec.awdlUp()))
    if core.restorePending, let at = upRetryAt, monotonicMs() >= at { execute([.up]) }
    if let iface = core.persisted.pendingWifiOn, let at = wifiOnAt, monotonicMs() >= at {
      switch exec.wifiPowerOn(iface) {
      case true?: wifiOnAt = nil; wifiRetryCount = 0; execute(core.wifiObserved(on: true))
      case false?: execute([.wifiOn(iface)])
      case nil: break
      }
    }
  }

  private func backoff(_ count: inout Int) -> Double {
    let delays = [1000.0, 2000, 5000, 10_000, 30_000]
    defer { count += 1 }
    return monotonicMs() + delays[min(count, delays.count - 1)]
  }

  /// Runs commands in order. A failed persist aborts the rest: no state change
  /// without durable intent. Returns false if anything failed.
  @discardableResult
  private func execute(_ cmds: [WardenCommand]) -> Bool {
    for c in cmds {
      progress()
      switch c {
      case .persist:
        if !WardenStateStore.save(core.persisted) { lastError = "could not persist state"; return false }
      case .down:
        guard core.leaseValid(now: now()) else { return false }  // revalidated right before spawn
        if !exec.run(.down) { lastError = "awdl down failed"; return false }
      case .up:
        if exec.run(.up), exec.awdlUp() == true {
          upRetryAt = nil
          upRetryCount = 0
          if !core.recovering { _ = execute(core.restoreConfirmed()) }
        } else {
          lastError = "awdl up failed; retrying"
          upRetryAt = backoff(&upRetryCount)
          return false
        }
      case .wifiOff(let iface):
        wifiOnAt = monotonicMs() + 3000
        if !exec.run(.wifiOff(iface)), exec.wifiPowerOn(iface) == true {
          lastError = "wifi off failed"
          wifiOnAt = nil
          execute(core.wifiObserved(on: true))
          return false
        }
      case .wifiOn(let iface):
        if !exec.run(.wifiOn(iface)) || exec.wifiPowerOn(iface) != true {
          lastError = "wifi on failed; retrying"
          wifiOnAt = backoff(&wifiRetryCount)
          return false
        }
        wifiRetryCount = 0
        if !core.recovering { wifiOnAt = nil; execute(core.wifiObserved(on: true)) }
      }
    }
    return true
  }

  private func terminate() {
    let cmds = core.shutdown()
    for c in cmds { _ = exec.run(c) }
    if exec.awdlUp() == true { _ = core.restoreConfirmed(); WardenStateStore.save(core.persisted) }
    exit(0)
  }

  // MARK: hang watchdog

  private func startWatchdog() {
    let t = DispatchSource.makeTimerSource(queue: watchdogQueue)
    t.schedule(deadline: .now() + 1, repeating: 1)
    t.setEventHandler { [weak self] in
      guard let self else { return }
      if self.sinceProgress() > 3000 {
        logError("warden main loop stalled; fencing and exiting for launchd restart")
        self.exec.fence(wait: 3)
        exit(2)
      }
    }
    t.resume()
    sources.append(t)
  }

  // MARK: status snapshot (answered off the main queue)

  private func publishStatus() {
    let s: [String: Any] = [
      "awdlUp": orNull(exec.awdlUp()), "holding": core.holding, "tookDown": core.persisted.tookDown,
      "recovering": core.recovering, "privilege": privilege, "lastError": orNull(lastError),
      "wifiPending": core.persisted.pendingWifiOn != nil, "restoredByWarden": core.restoredByWarden,
      "reenables": core.reenables,
    ]
    statusLock.lock(); statusSnapshot = s; statusLock.unlock()
  }

  private func status() -> [String: Any] {
    statusLock.lock(); defer { statusLock.unlock() }
    return statusSnapshot
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
      guard fd >= 0 else { return }
      var on: Int32 = 1
      setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
      self.connLock.lock()
      let allowed = self.connections < 8
      if allowed { self.connections += 1 }
      self.connLock.unlock()
      guard allowed else { close(fd); return }
      Thread.detachNewThread {
        self.serve(fd)
        close(fd)
        self.connLock.lock(); self.connections -= 1; self.connLock.unlock()
      }
    }
    accept.resume()
    sources.append(accept)
  }

  private func writeAll(_ fd: Int32, _ data: Data) -> Bool {
    data.withUnsafeBytes { buf in
      var off = 0
      while off < data.count {
        let n = write(fd, buf.baseAddress! + off, data.count - off)
        if n <= 0 { return false }
        off += n
      }
      return true
    }
  }

  private func serve(_ fd: Int32) {
    var buffer = Data()
    var chunk = [UInt8](repeating: 0, count: 4096)
    while true {
      let n = read(fd, &chunk, chunk.count)
      if n <= 0 { return }
      buffer.append(chunk, count: n)
      if buffer.count > 4096, buffer.firstIndex(of: 0x0A) == nil { return }  // frame limit
      while let nl = buffer.firstIndex(of: 0x0A) {
        let line = Data(buffer[buffer.startIndex..<nl])
        buffer.removeSubrange(buffer.startIndex...nl)
        var out = (try? JSONSerialization.data(withJSONObject: respond(to: line), options: [.sortedKeys])) ?? Data()
        out.append(0x0A)
        if !writeAll(fd, out) { return }
      }
    }
  }

  private func respond(to line: Data) -> [String: Any] {
    guard let obj = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
          (obj["v"] as? Int) == protocolVersion, let id = obj["id"] as? Int, let op = obj["op"] as? String else {
      return ["v": protocolVersion, "id": -1, "ok": false, "error": "bad-request"]
    }
    // Liveness and status never wait for the command queue.
    if op == "ping" || op == "status" { return ["v": protocolVersion, "id": id, "ok": true, "status": status()] }
    if op == "test-stall", dryRun { main.async { Thread.sleep(forTimeInterval: 6) } }
    let req: WardenRequest?
    switch op {
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
    return main.sync { self.handle(req) }
  }

  private func handle(_ req: WardenRequest) -> [String: Any] {
    progress()
    defer { publishStatus() }
    if case .hold = req, !core.recovering, !privilege {
      privilege = exec.hasPrivilege()
      if !privilege { return ["v": protocolVersion, "id": req.id, "ok": false, "error": "no-privilege", "status": status()] }
    }
    let (reply, cmds) = core.handle(req, now: now(), awdlUp: exec.awdlUp())
    let ok = execute(cmds)
    var out: [String: Any] = ["v": protocolVersion, "id": reply.id, "ok": reply.ok]
    if let t = reply.token { out["token"] = t }
    if let e = reply.error { out["error"] = e }
    if case .hold = req, reply.ok, !ok || exec.awdlUp() == true && core.persisted.tookDown {
      // Persist or down failed: report it and give the lease back.
      execute(core.handle(.restoreNow(id: req.id), now: now(), awdlUp: exec.awdlUp()).1)
      out = ["v": protocolVersion, "id": req.id, "ok": false, "error": "command-failed", "detail": lastError ?? "awdl down failed"]
    }
    publishStatus()
    out["status"] = status()
    return out
  }
}
