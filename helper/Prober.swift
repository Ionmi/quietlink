import Darwin
import Foundation

/// ICMP echo prober on an unprivileged datagram socket bound to one interface.
/// The kernel may deliver other processes' echo replies to this socket, so replies
/// are matched strictly by source address, identifier and sequence.
final class Prober {
  let target: String
  private let id = UInt16.random(in: 1...UInt16.max)
  private var seq: UInt16 = 0
  private var fd: Int32 = -1
  private var sendTimer: DispatchSourceTimer?
  private var deadlineTimer: DispatchSourceTimer?
  private var reader: DispatchSourceRead?
  private var pending: [UInt16: Double] = [:]   // seq -> monotonic send time
  private var lost: [UInt16: Double] = [:]      // seq -> send time, for late replies
  private let deadlineMs: Double
  private let queue = DispatchQueue(label: "quietlink.prober")
  private var addr = sockaddr_in()
  /// Called once if macOS's Local Network privacy refuses this socket.
  var onLocalNetworkDenied: (() -> Void)?
  private var deniedReported = false

  init(target: String, deadlineMs: Double = 1000) {
    self.target = target
    self.deadlineMs = deadlineMs
  }

  func start(iface: String, intervalMs: Int) -> Bool {
    guard inet_pton(AF_INET, target, &addr.sin_addr) == 1 else {
      emit(["type": "probe-send-failed", "target": target, "error": "bad-address"])
      return false
    }
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_ICMP)
    guard fd >= 0 else {
      emit(["type": "probe-send-failed", "target": target, "error": "socket-\(errno)"])
      return false
    }
    var index = if_nametoindex(iface)
    if index != 0 { setsockopt(fd, IPPROTO_IP, IP_BOUND_IF, &index, socklen_t(MemoryLayout<UInt32>.size)) }
    let flags = fcntl(fd, F_GETFL)
    _ = fcntl(fd, F_SETFL, flags | O_NONBLOCK)

    reader = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
    reader?.setEventHandler { [weak self] in self?.drain() }
    reader?.resume()

    sendTimer = DispatchSource.makeTimerSource(queue: queue)
    sendTimer?.schedule(deadline: .now(), repeating: .milliseconds(intervalMs), leeway: .milliseconds(5))
    sendTimer?.setEventHandler { [weak self] in self?.send() }
    sendTimer?.resume()

    deadlineTimer = DispatchSource.makeTimerSource(queue: queue)
    deadlineTimer?.schedule(deadline: .now() + .milliseconds(50), repeating: .milliseconds(50))
    deadlineTimer?.setEventHandler { [weak self] in self?.expire() }
    deadlineTimer?.resume()
    return true
  }

  /// Changes the send interval without closing the socket, so probes in flight still settle.
  func setInterval(_ intervalMs: Int) {
    queue.async { self.sendTimer?.schedule(deadline: .now() + .milliseconds(intervalMs), repeating: .milliseconds(intervalMs), leeway: .milliseconds(5)) }
  }

  func stopSending() {
    queue.sync { sendTimer?.cancel() }
  }

  func stop() {
    queue.sync {
      sendTimer?.cancel(); deadlineTimer?.cancel(); reader?.cancel()
      if fd >= 0 { close(fd); fd = -1 }
    }
  }

  private func send() {
    seq &+= 1
    var packet = [UInt8](repeating: 0, count: 16)
    packet[0] = 8
    packet[4] = UInt8(id >> 8); packet[5] = UInt8(id & 0xff)
    packet[6] = UInt8(seq >> 8); packet[7] = UInt8(seq & 0xff)
    Array("quietlnk".utf8).enumerated().forEach { packet[8 + $0.offset] = $0.element }
    let ck = checksum(packet)
    packet[2] = UInt8(ck >> 8); packet[3] = UInt8(ck & 0xff)
    let now = monotonicMs()
    let sent = withUnsafePointer(to: &addr) { p in
      p.withMemoryRebound(to: sockaddr.self, capacity: 1) { sendto(fd, packet, packet.count, 0, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
    }
    if sent == packet.count {
      pending[seq] = now
      emit(["type": "probe-sent", "target": target, "id": Int(id), "seq": Int(seq)])
    } else {
      let e = errno
      if e == EHOSTUNREACH, !deniedReported, let cb = onLocalNetworkDenied {
        deniedReported = true
        DispatchQueue.main.async { cb() }
        return
      }
      emit(["type": "probe-send-failed", "target": target, "error": "errno-\(e)"])
    }
  }

  private func drain() {
    var buf = [UInt8](repeating: 0, count: 512)
    var from = sockaddr_in()
    var fromLen = socklen_t(MemoryLayout<sockaddr_in>.size)
    while true {
      let n = withUnsafeMutablePointer(to: &from) { p in
        p.withMemoryRebound(to: sockaddr.self, capacity: 1) { recvfrom(fd, &buf, buf.count, 0, $0, &fromLen) }
      }
      if n <= 0 { return }
      let now = monotonicMs()
      guard from.sin_addr.s_addr == addr.sin_addr.s_addr else { continue }
      let ihl = Int(buf[0] & 0x0f) * 4
      guard n >= ihl + 8 else { continue }
      let type = buf[ihl]
      if type == 3 {
        // Destination unreachable: embedded original header carries our id/seq.
        let inner = ihl + 8
        guard n >= inner + 28 else { continue }
        let innerIhl = Int(buf[inner] & 0x0f) * 4
        let o = inner + innerIhl
        guard n >= o + 8 else { continue }
        let rid = UInt16(buf[o + 4]) << 8 | UInt16(buf[o + 5])
        let rseq = UInt16(buf[o + 6]) << 8 | UInt16(buf[o + 7])
        guard rid == id, pending.removeValue(forKey: rseq) != nil else { continue }
        emit(["type": "probe-result", "target": target, "id": Int(id), "seq": Int(rseq), "outcome": "error", "error": "unreachable-\(buf[ihl + 1])"])
        continue
      }
      guard type == 0 else { continue }
      let rid = UInt16(buf[ihl + 4]) << 8 | UInt16(buf[ihl + 5])
      let rseq = UInt16(buf[ihl + 6]) << 8 | UInt16(buf[ihl + 7])
      guard rid == id else { continue }
      if let t = pending.removeValue(forKey: rseq) {
        let rtt = ((now - t) * 1000).rounded() / 1000
        switch classifyReply(rttMs: now - t, deadlineMs: deadlineMs) {
        case .reply:
          emit(["type": "probe-result", "target": target, "id": Int(id), "seq": Int(rseq), "outcome": "reply", "rttMs": rtt])
        case .lateAfterLoss:
          // The deadline passed before this reply was read: loss is final, the reply is a late observation.
          emit(["type": "probe-result", "target": target, "id": Int(id), "seq": Int(rseq), "outcome": "lost"])
          emit(["type": "probe-late", "target": target, "id": Int(id), "seq": Int(rseq), "rttMs": rtt])
        }
      } else if let t = lost.removeValue(forKey: rseq) {
        emit(["type": "probe-late", "target": target, "id": Int(id), "seq": Int(rseq), "rttMs": ((now - t) * 1000).rounded() / 1000])
      }
    }
  }

  private func expire() {
    drain()  // replies already in the socket buffer are not losses
    let now = monotonicMs()
    for (s, t) in pending where now - t >= deadlineMs {
      pending.removeValue(forKey: s)
      lost[s] = t
      emit(["type": "probe-result", "target": target, "id": Int(id), "seq": Int(s), "outcome": "lost"])
    }
    for (s, t) in lost where now - t > 10_000 { lost.removeValue(forKey: s) }
  }
}

enum ReplyClass: Equatable { case reply, lateAfterLoss }

/// A reply read at or after the deadline counts as a loss plus a late observation.
func classifyReply(rttMs: Double, deadlineMs: Double) -> ReplyClass {
  rttMs < deadlineMs ? .reply : .lateAfterLoss
}

func checksum(_ b: [UInt8]) -> UInt16 {
  var sum: UInt32 = 0
  var i = 0
  while i + 1 < b.count { sum += UInt32(b[i]) << 8 | UInt32(b[i + 1]); i += 2 }
  if i < b.count { sum += UInt32(b[i]) << 8 }
  while sum >> 16 != 0 { sum = (sum & 0xffff) + (sum >> 16) }
  return ~UInt16(sum)
}

/// Probers keyed by target, driven by stdin commands.
final class ProberSet {
  private var probers: [String: Prober] = [:]
  private var pingers: [String: PingProber] = [:]
  private var ifaces: [String: String] = [:]
  private var intervals: [String: Int] = [:]
  /// Targets macOS refused to our socket; they use /sbin/ping from then on.
  private var denied = Set<String>()

  func handle(_ name: String, _ cmd: [String: Any]) {
    guard let target = cmd["target"] as? String else { return }
    if name == "probe-start", let iface = cmd["iface"] as? String, let interval = cmd["intervalMs"] as? Int {
      let ms = max(100, interval)
      if denied.contains(target) {
        if pingers[target] != nil, ifaces[target] == iface, intervals[target] == ms { return }
        startPinger(target, iface, ms)
        return
      }
      if let p = probers[target], ifaces[target] == iface {
        p.setInterval(ms)
        intervals[target] = ms
        return
      }
      probers.removeValue(forKey: target)?.stop()
      let p = Prober(target: target)
      p.onLocalNetworkDenied = { [weak self] in
        guard let self else { return }
        self.denied.insert(target)
        self.probers.removeValue(forKey: target)?.stop()
        self.startPinger(target, self.ifaces[target] ?? iface, self.intervals[target] ?? ms)
      }
      if p.start(iface: iface, intervalMs: ms) { probers[target] = p; ifaces[target] = iface; intervals[target] = ms }
    } else if name == "probe-stop" {
      probers.removeValue(forKey: target)?.stop()
      pingers.removeValue(forKey: target)?.stop()
      ifaces.removeValue(forKey: target)
      intervals.removeValue(forKey: target)
    }
  }

  private func startPinger(_ target: String, _ iface: String, _ ms: Int) {
    pingers.removeValue(forKey: target)?.stop()
    let p = PingProber(target: target)
    if p.start(iface: iface, intervalMs: ms) {
      pingers[target] = p; ifaces[target] = iface; intervals[target] = ms
      emit(["type": "probe-mode", "target": target, "mode": "system-ping"])
    } else {
      emit(["type": "probe-send-failed", "target": target, "error": "errno-65"])
    }
  }
}
