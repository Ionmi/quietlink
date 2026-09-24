import Foundation

let protocolVersion = 1
private let outputLock = NSLock()

/// Monotonic milliseconds (continues during sleep? no: CLOCK_UPTIME_RAW pauses in sleep).
func monotonicMs() -> Double {
  Double(clock_gettime_nsec_np(CLOCK_UPTIME_RAW)) / 1_000_000
}

/// Wall-clock milliseconds; the app correlates helper events with log timestamps.
func wallMs() -> Double {
  Date().timeIntervalSince1970 * 1000
}

/// Writes one JSON Lines event to stdout. Adds protocol version and timestamp.
func emit(_ dict: [String: Any]) {
  var d = dict
  d["v"] = protocolVersion
  if d["ts"] == nil { d["ts"] = wallMs() }
  guard let data = try? JSONSerialization.data(withJSONObject: d, options: [.sortedKeys]) else { return }
  outputLock.lock()
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([0x0A]))
  outputLock.unlock()
}

func orNull<T>(_ v: T?) -> Any { v.map { $0 as Any } ?? NSNull() }

func logError(_ s: String) {
  FileHandle.standardError.write((s + "\n").data(using: .utf8)!)
}
