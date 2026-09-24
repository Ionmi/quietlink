import AppKit
import SystemConfiguration

/// Sleep/wake and network-change notifications.
final class PowerSensor {
  private var store: SCDynamicStore?
  var onNetChange: (() -> Void)?

  func start() {
    let nc = NSWorkspace.shared.notificationCenter
    nc.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { _ in
      emit(["type": "power", "state": "will-sleep"])
    }
    nc.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { _ in
      emit(["type": "power", "state": "did-wake"])
    }
    var ctx = SCDynamicStoreContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: nil, release: nil, copyDescription: nil)
    store = SCDynamicStoreCreate(nil, "quietlink-net" as CFString, { _, _, info in
      guard let info else { return }
      let me = Unmanaged<PowerSensor>.fromOpaque(info).takeUnretainedValue()
      emit(["type": "net-change"])
      me.onNetChange?()
    }, &ctx)
    guard let store else { return }
    SCDynamicStoreSetNotificationKeys(store, ["State:/Network/Global/IPv4"] as CFArray, ["State:/Network/Service/[^/]+/IPv4"] as CFArray)
    if let src = SCDynamicStoreCreateRunLoopSource(nil, store, 0) {
      CFRunLoopAddSource(CFRunLoopGetMain(), src, .defaultMode)
    }
  }
}
