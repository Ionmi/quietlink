import Foundation

let protocolVersion = 1
/// Output goes through its own serial queue so a slow reader (backpressure on the
/// pipe) never stalls sensors or probers; their timing stays independent.
private let outputQueue = DispatchQueue(label: "quietlink.output")

/// Monotonic milliseconds (continues during sleep? no: CLOCK_UPTIME_RAW pauses in sleep).
func monotonicMs() -> Double {
  Double(clock_gettime_nsec_np(CLOCK_UPTIME_RAW)) / 1_000_000
}

/// Wall-clock milliseconds; the app correlates helper events with log timestamps.
func wallMs() -> Double {
  Date().timeIntervalSince1970 * 1000
}

/// Test hook: when set, events go here instead of stdout.
nonisolated(unsafe) var emitHook: (([String: Any]) -> Void)?

/// Writes one JSON Lines event to stdout. Adds protocol version and timestamp.
func emit(_ dict: [String: Any]) {
  if let hook = emitHook { hook(dict); return }
  var d = dict
  d["v"] = protocolVersion
  if d["ts"] == nil { d["ts"] = wallMs() }
  guard var data = try? JSONSerialization.data(withJSONObject: d, options: [.sortedKeys]) else { return }
  data.append(0x0A)
  outputQueue.async { FileHandle.standardOutput.write(data) }
}

func orNull<T>(_ v: T?) -> Any { v.map { $0 as Any } ?? NSNull() }

func logError(_ s: String) {
  FileHandle.standardError.write((s + "\n").data(using: .utf8)!)
}

/// Blocks until queued output is written (one-shot modes exit right after emitting).
func flushOutput() {
  outputQueue.sync {}
}
