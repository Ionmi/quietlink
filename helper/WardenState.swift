import Foundation

enum Paths {
  static let support: URL = {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return URL(fileURLWithPath: ProcessInfo.processInfo.environment["QUIETLINK_SUPPORT_DIR"] ?? base.appendingPathComponent("Quietlink").path)
  }()
  static var wardenSocket: String { support.appendingPathComponent("warden.sock").path }
  static var wardenState: URL { support.appendingPathComponent("warden-state.json") }
  static var wardenLock: String { support.appendingPathComponent("warden.lock").path }

  static func ensureSupportDir() throws {
    try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: support.path)
  }
}

enum WardenStateStore {
  static func load() -> WardenPersisted {
    guard let data = try? Data(contentsOf: Paths.wardenState),
          let s = try? JSONDecoder().decode(WardenPersisted.self, from: data) else {
      return WardenPersisted(bootId: "", tookDown: false, pendingWifiOn: nil)
    }
    return s
  }

  /// fsync + atomic rename so a crash never leaves a half-written record.
  static func save(_ s: WardenPersisted) {
    guard let data = try? JSONEncoder().encode(s) else { return }
    let tmp = Paths.wardenState.path + ".tmp"
    let fd = open(tmp, O_WRONLY | O_CREAT | O_TRUNC, 0o600)
    guard fd >= 0 else { return }
    _ = data.withUnsafeBytes { write(fd, $0.baseAddress, data.count) }
    fsync(fd)
    close(fd)
    rename(tmp, Paths.wardenState.path)
  }
}

func bootSessionId() -> String {
  var size = 0
  sysctlbyname("kern.bootsessionuuid", nil, &size, nil, 0)
  var buf = [CChar](repeating: 0, count: max(size, 1))
  sysctlbyname("kern.bootsessionuuid", &buf, &size, nil, 0)
  return String(cString: buf)
}
