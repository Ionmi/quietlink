import CoreWLAN
import Darwin
import Foundation

/// Runs the only commands Quietlink ever executes with elevated rights, one at a
/// time. Admission (fence check + spawn + child registration) is one critical
/// section so the hang watchdog can fence without racing a spawn.
final class WardenExecutor {
  private let admission = NSLock()
  private var fenced = false
  private var running: Process?
  /// QUIETLINK_DRY_RUN: commands are logged and AWDL state is simulated in memory.
  private let dryRun = ProcessInfo.processInfo.environment["QUIETLINK_DRY_RUN"] != nil
  private var simAwdlUp = true

  static let sudo = "/usr/bin/sudo"
  static let ifconfig = "/sbin/ifconfig"
  static let networksetup = "/usr/sbin/networksetup"

  func argv(_ c: WardenCommand) -> [String]? {
    switch c {
    case .down: return [Self.sudo, "-n", Self.ifconfig, "awdl0", "down"]
    case .up: return [Self.sudo, "-n", Self.ifconfig, "awdl0", "up"]
    case .wifiOff(let i): return [Self.networksetup, "-setairportpower", i, "off"]
    case .wifiOn(let i): return [Self.networksetup, "-setairportpower", i, "on"]
    case .persist: return nil
    }
  }

  /// Returns true on exit status 0 within the timeout.
  func run(_ c: WardenCommand, timeout: TimeInterval = 2) -> Bool {
    guard let args = argv(c) else { return true }
    if dryRun {
      logError("dry-run: \(args.joined(separator: " "))")
      if c == .down { simAwdlUp = false }
      if c == .up { simAwdlUp = true }
      return true
    }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: args[0])
    p.arguments = Array(args.dropFirst())
    p.standardOutput = FileHandle.nullDevice
    p.standardError = FileHandle.nullDevice
    let done = DispatchSemaphore(value: 0)
    p.terminationHandler = { _ in done.signal() }
    admission.lock()
    if fenced { admission.unlock(); return false }
    do { try p.run() } catch { admission.unlock(); return false }
    running = p
    admission.unlock()
    let finished = done.wait(timeout: .now() + timeout) == .success
    if !finished {
      p.terminate()  // SIGTERM to sudo, which relays to its child
      _ = done.wait(timeout: .now() + 1)
    }
    admission.lock(); running = nil; admission.unlock()
    return finished && p.terminationStatus == 0
  }

  /// Hang watchdog: stop admitting commands and wait for the in-flight one.
  func fence(wait: TimeInterval) {
    if admission.lock(before: Date().addingTimeInterval(1)) {
      fenced = true
      let p = running
      admission.unlock()
      let deadline = Date().addingTimeInterval(wait)
      while let p, p.isRunning, Date() < deadline { usleep(50_000) }
    }
  }

  func awdlUp() -> Bool? {
    if dryRun { return simAwdlUp }
    var ifap: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&ifap) == 0, let first = ifap else { return nil }
    defer { freeifaddrs(ifap) }
    var cur: UnsafeMutablePointer<ifaddrs>? = first
    while let c = cur {
      if String(cString: c.pointee.ifa_name) == "awdl0" { return (c.pointee.ifa_flags & UInt32(IFF_UP)) != 0 }
      cur = c.pointee.ifa_next
    }
    return nil
  }

  func wifiPowerOn() -> Bool? {
    CWWiFiClient.shared().interface()?.powerOn()
  }

  func hasPrivilege() -> Bool {
    if dryRun { return true }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: Self.sudo)
    p.arguments = ["-n", "-l"]
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = FileHandle.nullDevice
    guard (try? p.run()) != nil else { return false }
    p.waitUntilExit()
    let out = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    return out.contains("/sbin/ifconfig awdl0 down") && out.contains("/sbin/ifconfig awdl0 up")
  }
}

/// True while any process named ifconfig or networksetup is visible. Names only:
/// an unprivileged process cannot read a root process's full argv.
func commandProcessesVisible() -> Bool? {
  let n = proc_listallpids(nil, 0)
  guard n > 0 else { return nil }
  var pids = [pid_t](repeating: 0, count: Int(n) * 2)
  let got = pids.withUnsafeMutableBufferPointer { proc_listallpids($0.baseAddress, Int32($0.count * MemoryLayout<pid_t>.size)) }
  guard got > 0 else { return nil }
  var name = [CChar](repeating: 0, count: 64)
  for pid in pids.prefix(Int(got)) where pid > 0 {
    if proc_name(pid, &name, UInt32(name.count)) > 0 {
      let s = String(cString: name)
      if s == "ifconfig" || s == "networksetup" { return true }
    }
  }
  return false
}
