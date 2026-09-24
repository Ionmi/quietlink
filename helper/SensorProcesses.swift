import AppKit
import Darwin

/// Process identity is PID + start time, so a reused PID is never the same process.
/// Only processes inside .app bundles are listed.
func listProcs() -> [[String: Any]] {
  let n = proc_listallpids(nil, 0)
  guard n > 0 else { return [] }
  var pids = [pid_t](repeating: 0, count: Int(n) * 2)
  let got = pids.withUnsafeMutableBufferPointer { proc_listallpids($0.baseAddress, Int32($0.count * MemoryLayout<pid_t>.size)) }
  guard got > 0 else { return [] }
  var out: [[String: Any]] = []
  var pathBuf = [CChar](repeating: 0, count: Int(4 * MAXPATHLEN))
  for pid in pids.prefix(Int(got)) where pid > 0 {
    guard let info = procInfo(pid) else { continue }
    let len = proc_pidpath(pid, &pathBuf, UInt32(pathBuf.count))
    guard len > 0 else { continue }
    let path = String(cString: pathBuf)
    // Triggers only match app bundles; skipping daemons keeps each snapshot small.
    guard path.contains(".app/") else { continue }
    out.append(["pid": Int(pid), "start": info.start, "path": path, "bundleId": orNull(bundleId(pid))])
  }
  return out
}

private func procInfo(_ pid: pid_t) -> (start: Double, Void)? {
  var info = proc_bsdinfo()
  let size = Int32(MemoryLayout<proc_bsdinfo>.size)
  guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else { return nil }
  return (Double(info.pbi_start_tvsec) * 1000 + Double(info.pbi_start_tvusec) / 1000, ())
}

private func bundleId(_ pid: pid_t) -> String? {
  NSRunningApplication(processIdentifier: pid)?.bundleIdentifier
}

final class ProcessSensor {
  private var timer: Timer?

  func start() {
    publish()
    timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.publish() }
    let nc = NSWorkspace.shared.notificationCenter
    for (name, type) in [(NSWorkspace.didLaunchApplicationNotification, "proc-launch"), (NSWorkspace.didTerminateApplicationNotification, "proc-exit")] {
      nc.addObserver(forName: name, object: nil, queue: .main) { note in
        guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
        let pid = app.processIdentifier
        emit(["type": type, "pid": Int(pid), "start": procInfo(pid)?.start ?? 0,
              "path": app.executableURL?.path ?? "", "bundleId": orNull(app.bundleIdentifier)])
      }
    }
  }

  func publish() {
    emit(["type": "procs", "procs": listProcs()])
  }
}
