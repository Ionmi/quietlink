import Darwin
import Foundation

/// Fallback prober for when macOS's Local Network privacy refuses our own ICMP
/// socket (EHOSTUNREACH). It runs the system's /sbin/ping, which is exempt, and
/// spawns it "disclaimed" so macOS doesn't attribute its traffic to Quietlink
/// (an unsigned app would lose that permission on every update).
/// Accounting is derived from ping's output: each reply or timeout line becomes
/// a probe-sent + terminal result; a reply for a seq already reported lost is late.
final class PingProber {
  let target: String
  private let id = Int.random(in: 1...65_535)
  private var pid: pid_t = 0
  private var reader: FileHandle?
  private var buffer = Data()
  private var lost = Set<Int>()
  private let deadlineMs: Double = 1000

  init(target: String) { self.target = target }

  func start(iface: String, intervalMs: Int) -> Bool {
    let interval = String(format: "%.2f", Double(max(intervalMs, 200)) / 1000)
    let argv = ["/sbin/ping", "-n", "-b", iface, "-i", interval, "-W", "1000", target]
    var fds: [Int32] = [0, 0]
    guard pipe(&fds) == 0 else { return false }
    var actions: posix_spawn_file_actions_t?
    posix_spawn_file_actions_init(&actions)
    posix_spawn_file_actions_adddup2(&actions, fds[1], STDOUT_FILENO)
    posix_spawn_file_actions_addclose(&actions, fds[0])
    posix_spawn_file_actions_addopen(&actions, STDERR_FILENO, "/dev/null", O_WRONLY, 0)
    var attr: posix_spawnattr_t?
    posix_spawnattr_init(&attr)
    disclaimResponsibility(&attr)
    let cargs: [UnsafeMutablePointer<CChar>?] = argv.map { strdup($0) } + [nil]
    let env: [UnsafeMutablePointer<CChar>?] = [strdup("LC_ALL=C"), nil]
    let rc = posix_spawn(&pid, "/sbin/ping", &actions, &attr, cargs, env)
    cargs.forEach { free($0) }; env.forEach { free($0) }
    posix_spawn_file_actions_destroy(&actions)
    posix_spawnattr_destroy(&attr)
    close(fds[1])
    guard rc == 0 else { close(fds[0]); return false }
    let fh = FileHandle(fileDescriptor: fds[0], closeOnDealloc: true)
    fh.readabilityHandler = { [weak self] h in
      let d = h.availableData
      if d.isEmpty { h.readabilityHandler = nil; return }
      self?.consume(d)
    }
    reader = fh
    return true
  }

  func stop() {
    reader?.readabilityHandler = nil
    if pid > 0 { kill(pid, SIGTERM); var s: Int32 = 0; waitpid(pid, &s, WNOHANG); pid = 0 }
  }

  private func consume(_ d: Data) {
    buffer.append(d)
    while let nl = buffer.firstIndex(of: 0x0A) {
      let line = String(decoding: buffer[buffer.startIndex..<nl], as: UTF8.self)
      buffer.removeSubrange(buffer.startIndex...nl)
      handle(line)
    }
  }

  func handle(_ line: String) {
    let now = wallMs()
    if let seq = match(line, #"Request timeout for icmp_seq (\d+)"#).flatMap({ Int($0) }) {
      lost.insert(seq)
      if lost.count > 200 { lost.removeFirst() }
      emit(["type": "probe-sent", "target": target, "id": id, "seq": seq, "ts": now - deadlineMs])
      emit(["type": "probe-result", "target": target, "id": id, "seq": seq, "outcome": "lost", "ts": now])
      return
    }
    guard let seqS = match(line, #"icmp_seq=(\d+)"#), let seq = Int(seqS),
          let rttS = match(line, #"time=([\d.]+) ms"#), let rtt = Double(rttS) else { return }
    if lost.remove(seq) != nil {
      emit(["type": "probe-late", "target": target, "id": id, "seq": seq, "rttMs": rtt, "ts": now])
      return
    }
    emit(["type": "probe-sent", "target": target, "id": id, "seq": seq, "ts": now - rtt])
    if rtt < deadlineMs {
      emit(["type": "probe-result", "target": target, "id": id, "seq": seq, "outcome": "reply", "rttMs": rtt, "ts": now])
    } else {
      emit(["type": "probe-result", "target": target, "id": id, "seq": seq, "outcome": "lost", "ts": now])
      emit(["type": "probe-late", "target": target, "id": id, "seq": seq, "rttMs": rtt, "ts": now])
    }
  }

  private func match(_ s: String, _ pattern: String) -> String? {
    guard let r = s.range(of: pattern, options: .regularExpression) else { return nil }
    let m = String(s[r])
    guard let re = try? NSRegularExpression(pattern: pattern), let res = re.firstMatch(in: m, range: NSRange(m.startIndex..., in: m)),
          res.numberOfRanges > 1, let g = Range(res.range(at: 1), in: m) else { return nil }
    return String(m[g])
  }
}

/// Private but long-standing libSystem call (used by terminals and browsers):
/// the child becomes responsible for itself for privacy checks.
func disclaimResponsibility(_ attr: UnsafeMutablePointer<posix_spawnattr_t?>) {
  typealias Fn = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32
  guard let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_spawnattrs_setdisclaim") else { return }
  _ = unsafeBitCast(sym, to: Fn.self)(attr, 1)
}
